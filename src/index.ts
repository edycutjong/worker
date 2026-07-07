/**
 * Worker — Entry point.
 *
 * Required env vars:
 * - CROO_SDK_KEY — CROO API key
 * - WORKER_SERVICE_ID — registered service ID
 *
 * Optional:
 * - ANTHROPIC_API_KEY — enables LLM-written research (deterministic fallback otherwise)
 * - CROO_MOCK=true — offline mock mode
 */

import { makeClient, isMockMode } from '@edycutjong/croo-core';
import { startWorkerProvider } from './provider.js';

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  🛠️  Worker — Research Provider Agent     ║');
  console.log('║  Sourced research drafts on any topic     ║');
  console.log(`║  Mode: ${isMockMode() ? '🧪 MOCK' : '🔴 LIVE (Base Mainnet)'}              ║`);
  console.log('╚══════════════════════════════════════════╝');

  const sdkKey = process.env.CROO_SDK_KEY;
  const serviceId = process.env.WORKER_SERVICE_ID;

  if (!sdkKey && !isMockMode()) {
    console.error('Missing CROO_SDK_KEY. Set it or use CROO_MOCK=true.');
    process.exit(1);
  }

  if (!serviceId) {
    console.error('Missing WORKER_SERVICE_ID.');
    process.exit(1);
  }

  const client = isMockMode() ? {} : makeClient(sdkKey!);
  const stream = await startWorkerProvider(client, serviceId);

  const shutdown = () => {
    console.log('\n[worker] Shutting down...');
    if (stream && typeof stream.close === 'function') {
      stream.close();
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('[worker] Ready — waiting for orders...');
}

main().catch((err) => {
  console.error('[worker] Fatal error:', err);
  process.exit(1);
});
