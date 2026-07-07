import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { produceResearch, fallbackResearch } from '../src/researcher.js';

describe('Worker Researcher', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('throws if the topic is missing or blank', async () => {
    await expect(produceResearch({ topic: '' })).rejects.toThrow('Missing required field: topic');
    await expect(produceResearch({ topic: '   ' })).rejects.toThrow('Missing required field: topic');
    // topic undefined → the `?? ''` nullish path
    await expect(produceResearch({} as any)).rejects.toThrow('Missing required field: topic');
  });

  it('uses the deterministic offline draft when no API key is set', async () => {
    const result = await produceResearch({ topic: 'Base L2 TVL' });
    expect(result.draft).toContain('Research Brief: Base L2 TVL');
    expect(result.draft).toContain('standard');
    expect(result.sources).toHaveLength(2);
  });

  it('honors the requested depth in the offline draft', async () => {
    const result = await produceResearch({ topic: 'ZK proofs', depth: 'comprehensive' });
    expect(result.draft).toContain('comprehensive');
  });

  it('fallbackResearch defaults the depth label when omitted', () => {
    expect(fallbackResearch('X').draft).toContain('standard');
  });

  describe('LLM mode (ANTHROPIC_API_KEY set)', () => {
    beforeEach(() => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    });

    it('parses a valid fenced JSON response and clamps sources', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{
            text: '```json\n{"draft":"# Draft\\nFindings.","sources":["https://a.com","https://b.com",1,null]}\n```',
          }],
        }),
      } as Response);

      const result = await produceResearch({ topic: 'AI agents', depth: 'comprehensive', context: 'fix the gaps' });

      expect(result.draft).toBe('# Draft\nFindings.');
      expect(result.sources).toEqual(['https://a.com', 'https://b.com']); // non-strings filtered
      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.messages[0].content).toContain('Reviewer feedback to address: fix the gaps');
      expect(global.fetch).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.any(Object));
    });

    it('parses a bare (unfenced) JSON object', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ text: '{"draft":"Bare draft","sources":["https://x.com"]}' }] }),
      } as Response);

      const result = await produceResearch({ topic: 'DAOs' });
      expect(result.draft).toBe('Bare draft');
      expect(result.sources).toEqual(['https://x.com']);
    });

    it('defaults sources to [] when the field is not an array', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ text: '{"draft":"Draft only"}' }] }),
      } as Response);

      const result = await produceResearch({ topic: 'DeFi' });
      expect(result.draft).toBe('Draft only');
      expect(result.sources).toEqual([]);
    });

    it('falls back when the JSON omits the draft field entirely', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ text: '{"sources":["https://x.com"]}' }] }),
      } as Response);

      const result = await produceResearch({ topic: 'NoDraft' });
      expect(result.draft).toContain('Research Brief: NoDraft');
    });

    it('falls back when the JSON has an empty draft', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ text: '{"draft":"   ","sources":[]}' }] }),
      } as Response);

      const result = await produceResearch({ topic: 'Rollups' });
      expect(result.draft).toContain('Research Brief: Rollups');
    });

    it('falls back when the response has no JSON at all', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ text: 'no json here' }] }),
      } as Response);

      const result = await produceResearch({ topic: 'Sequencers' });
      expect(result.draft).toContain('Research Brief: Sequencers');
    });

    it('falls back when the JSON braces contain invalid JSON', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ text: '{ "draft": "x", bad }' }] }),
      } as Response);

      const result = await produceResearch({ topic: 'Bridges' });
      expect(result.draft).toContain('Research Brief: Bridges');
    });

    it('falls back when content is empty (text defaults to "")', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ content: [] }),
      } as Response);

      const result = await produceResearch({ topic: 'Restaking' });
      expect(result.draft).toContain('Research Brief: Restaking');
    });

    it('falls back when the Anthropic API returns an error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Error',
      } as Response);

      const result = await produceResearch({ topic: 'MEV' });
      expect(result.draft).toContain('Research Brief: MEV');
    });
  });
});
