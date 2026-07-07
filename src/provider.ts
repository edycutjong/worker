/**
 * Worker — Provider module.
 *
 * Accepts "research" orders, produces a sourced draft, and delivers it on-chain.
 */

import { runProvider } from '@edycutjong/croo-core';
import type { Deliverable, Event, Order } from '@edycutjong/croo-core';
import { produceResearch } from './researcher.js';
import type { ResearchRequest, ResearchResult } from './researcher.js';

/**
 * Start the Worker provider loop.
 *
 * @param client - An initialized CROO AgentClient
 * @param serviceId - The registered service ID for "Research"
 */
export async function startWorkerProvider(
  client: any,
  serviceId: string,
): Promise<any> {
  return runProvider<ResearchResult>(client, {
    serviceMatch: (event: Event) => {
      return event.service_id === serviceId;
    },

    work: async (order: Order): Promise<Deliverable<ResearchResult>> => {
      // The buyer's input lives on the negotiation as a JSON `requirements`
      // string — the Order itself does not carry it. Fetch and parse it.
      const input = await loadRequest(client, order);

      console.log(
        `[worker] Order ${order.orderId}: researching "${input.topic}" (depth: ${input.depth ?? 'standard'})...`,
      );

      try {
        const result = await produceResearch(input);

        console.log(
          `[worker] Order ${order.orderId}: draft ready (${result.draft.length} chars, ${result.sources.length} sources)`,
        );

        return {
          type: 'schema',
          data: result,
        };
      } catch (err) {
        if (err instanceof Error && err.message === 'SLA_TIMEOUT') {
          console.warn(`[worker] Order ${order.orderId} aborted locally due to SLA timeout.`);
        }
        throw err;
      }
    },

    slaGuardMs: 60_000,
  });
}

/**
 * Load and validate the buyer's ResearchRequest from the order's negotiation.
 * Throws if the payload is missing, malformed, or lacks a topic.
 */
async function loadRequest(client: any, order: Order): Promise<ResearchRequest> {
  let raw: string;
  try {
    const negotiation = await client.getNegotiation(order.negotiationId);
    raw = negotiation?.requirements ?? '';
  } catch (err) {
    throw new Error(`Failed to load negotiation ${order.negotiationId}: ${String(err)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid requirement: "topic" must be a valid string');
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as ResearchRequest).topic !== 'string' ||
    (parsed as ResearchRequest).topic.trim() === ''
  ) {
    throw new Error('Invalid requirement: "topic" must be a valid string');
  }

  return parsed as ResearchRequest;
}
