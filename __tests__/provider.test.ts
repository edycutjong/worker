import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startWorkerProvider } from '../src/provider.js';
import * as core from '@edycutjong/croo-core';
import * as researcher from '../src/researcher.js';

vi.mock('@edycutjong/croo-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@edycutjong/croo-core')>();
  return {
    ...actual,
    runProvider: vi.fn(),
  };
});

/** SDK-shaped Order (camelCase, no inline requirement). */
function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    orderId: 'o1',
    negotiationId: 'n1',
    serviceId: 'research-service',
    price: '1.0',
    slaDeadline: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

/** Client whose negotiation carries the given requirement payload. */
function makeClient(requirement: unknown) {
  return {
    id: 'client-id',
    getNegotiation: vi.fn().mockResolvedValue({
      negotiationId: 'n1',
      requirements: typeof requirement === 'string' ? requirement : JSON.stringify(requirement),
    }),
  };
}

describe('Worker Provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers the provider with the correct service ID', async () => {
    const mockClient = makeClient({ topic: 'x' });
    await startWorkerProvider(mockClient as any, 'research-service');

    expect(core.runProvider).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({
        slaGuardMs: 60_000,
        serviceMatch: expect.any(Function),
        work: expect.any(Function),
      }),
    );

    const config = vi.mocked(core.runProvider).mock.calls[0][1];
    expect(config.serviceMatch({ service_id: 'research-service' } as any)).toBe(true);
    expect(config.serviceMatch({ service_id: 'other' } as any)).toBe(false);
  });

  it('throws if the topic is missing from the negotiation requirements', async () => {
    const mockClient = makeClient({ depth: 'comprehensive' });
    await startWorkerProvider(mockClient as any, 'research-service');
    const config = vi.mocked(core.runProvider).mock.calls[0][1];

    await expect(config.work(makeOrder() as any)).rejects.toThrow('Invalid requirement: "topic"');
  });

  it('throws if the negotiation requirements are not valid JSON', async () => {
    const mockClient = makeClient('not-json');
    await startWorkerProvider(mockClient as any, 'research-service');
    const config = vi.mocked(core.runProvider).mock.calls[0][1];

    await expect(config.work(makeOrder() as any)).rejects.toThrow('Invalid requirement: "topic"');
  });

  it('throws when requirements parse to null', async () => {
    const mockClient = makeClient('null');
    await startWorkerProvider(mockClient as any, 'research-service');
    const config = vi.mocked(core.runProvider).mock.calls[0][1];
    await expect(config.work(makeOrder() as any)).rejects.toThrow('Invalid requirement: "topic"');
  });

  it('throws when requirements parse to a non-object', async () => {
    const mockClient = makeClient('"just a string"');
    await startWorkerProvider(mockClient as any, 'research-service');
    const config = vi.mocked(core.runProvider).mock.calls[0][1];
    await expect(config.work(makeOrder() as any)).rejects.toThrow('Invalid requirement: "topic"');
  });

  it('throws when the topic is only whitespace', async () => {
    const mockClient = makeClient({ topic: '   ' });
    await startWorkerProvider(mockClient as any, 'research-service');
    const config = vi.mocked(core.runProvider).mock.calls[0][1];
    await expect(config.work(makeOrder() as any)).rejects.toThrow('Invalid requirement: "topic"');
  });

  it('throws if the negotiation cannot be loaded', async () => {
    const mockClient = { id: 'c', getNegotiation: vi.fn().mockRejectedValue(new Error('boom')) };
    await startWorkerProvider(mockClient as any, 'research-service');
    const config = vi.mocked(core.runProvider).mock.calls[0][1];

    await expect(config.work(makeOrder() as any)).rejects.toThrow('Failed to load negotiation');
  });

  it('produces research and returns a schema deliverable', async () => {
    const mockClient = makeClient({ topic: 'ZK proofs', depth: 'comprehensive' });

    vi.spyOn(researcher, 'produceResearch').mockResolvedValueOnce({
      draft: 'A thorough draft',
      sources: ['https://a.com'],
    });

    await startWorkerProvider(mockClient as any, 'research-service');
    const config = vi.mocked(core.runProvider).mock.calls[0][1];

    const result = await config.work(makeOrder({ orderId: 'o2' }) as any);

    expect(researcher.produceResearch).toHaveBeenCalledWith({ topic: 'ZK proofs', depth: 'comprehensive' });
    expect(result).toEqual({
      type: 'schema',
      data: { draft: 'A thorough draft', sources: ['https://a.com'] },
    });
  });

  it('handles SLA_TIMEOUT errors specially', async () => {
    const mockClient = makeClient({ topic: 'text' });

    vi.spyOn(researcher, 'produceResearch').mockRejectedValueOnce(new Error('SLA_TIMEOUT'));

    await startWorkerProvider(mockClient as any, 'research-service');
    const config = vi.mocked(core.runProvider).mock.calls[0][1];

    await expect(config.work(makeOrder({ orderId: 'o4' }) as any)).rejects.toThrow('SLA_TIMEOUT');
  });

  it('throws non-SLA errors transparently', async () => {
    const mockClient = makeClient({ topic: 'text' });

    vi.spyOn(researcher, 'produceResearch').mockRejectedValueOnce(new Error('INTERNAL_ERROR'));

    await startWorkerProvider(mockClient as any, 'research-service');
    const config = vi.mocked(core.runProvider).mock.calls[0][1];

    await expect(config.work(makeOrder({ orderId: 'o5' }) as any)).rejects.toThrow('INTERNAL_ERROR');
  });
});
