/**
 * Worker — Research engine.
 *
 * Produces a sourced research draft for a topic. Uses an LLM (Anthropic) when
 * ANTHROPIC_API_KEY is set; otherwise falls back to a deterministic offline
 * draft so the agent works in mock mode and CI without a key.
 */

// ─── Types ─────────────────────────────────────────────────────────

export interface ResearchRequest {
  topic: string;
  depth?: string;
  context?: string;
}

export interface ResearchResult {
  draft: string;
  sources: string[];
}

// ─── Research Function ─────────────────────────────────────────────

/**
 * Produce a research draft for the given request.
 *
 * @param request - The topic, optional depth, and optional reviewer context
 * @returns A draft + sources
 */
export async function produceResearch(request: ResearchRequest): Promise<ResearchResult> {
  const topic = (request.topic ?? '').trim();
  if (!topic) {
    throw new Error('Missing required field: topic');
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[worker/research] No ANTHROPIC_API_KEY — using deterministic offline draft.');
    return fallbackResearch(topic, request.depth);
  }

  try {
    const response = await callAnthropic(buildPrompt(request), apiKey);
    return parseResearch(response, topic, request.depth);
  } catch (err) {
    console.warn(
      '[worker/research] ⚠️ LLM research failed, falling back to offline draft:',
      err instanceof Error ? err.message : String(err),
    );
    return fallbackResearch(topic, request.depth);
  }
}

// ─── Prompt Construction ───────────────────────────────────────────

function buildPrompt(request: ResearchRequest): string {
  const depth = request.depth ?? 'standard';
  return `You are an expert research analyst. Produce a concise, well-structured research brief.

Topic: ${request.topic}
Depth: ${depth}
${request.context ? `Reviewer feedback to address: ${request.context}\n` : ''}
Return ONLY a JSON object in this exact shape:
\`\`\`json
{
  "draft": "<markdown research brief, 150-400 words: a short overview, key findings, and risks>",
  "sources": ["<source url or citation>", "..."]
}
\`\`\``;
}

async function callAnthropic(prompt: string, apiKey: string): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 1200,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(25000), // Architecture: Prevent event-loop hangs
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as { content: Array<{ text: string }> };
  return data.content[0]?.text ?? '';
}

// ─── Response Parsing ──────────────────────────────────────────────

function parseResearch(response: string, topic: string, depth?: string): ResearchResult {
  const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) ?? response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn('[worker/research] Failed to parse LLM response, using fallback');
    return fallbackResearch(topic, depth);
  }

  try {
    const parsed = JSON.parse(jsonMatch[1] ?? jsonMatch[0]) as Partial<ResearchResult>;
    const draft = typeof parsed.draft === 'string' ? parsed.draft.trim() : '';
    if (!draft) {
      return fallbackResearch(topic, depth);
    }
    const sources = Array.isArray(parsed.sources)
      ? parsed.sources.filter((s): s is string => typeof s === 'string').slice(0, 10)
      : [];
    return { draft, sources };
  } catch {
    console.warn('[worker/research] JSON parse failed, using fallback');
    return fallbackResearch(topic, depth);
  }
}

// ─── Deterministic Offline Draft ───────────────────────────────────

/**
 * A deterministic, LLM-free research brief. Used when no API key is set or the
 * LLM call fails — keeps the agent functional in mock mode and CI.
 */
export function fallbackResearch(topic: string, depth?: string): ResearchResult {
  const draft = [
    `# Research Brief: ${topic}`,
    '',
    '## Overview',
    `${topic} is analyzed here at "${depth ?? 'standard'}" depth. This deterministic offline brief is generated without an LLM (no ANTHROPIC_API_KEY set), so the agent stays fully functional in mock mode and CI.`,
    '',
    '## Key Findings',
    `- Current state and primary considerations for ${topic}.`,
    '- Notable trade-offs, adoption signals, and open questions.',
    '',
    '## Risks',
    '- Evidence is limited in offline mode; verify against primary sources before acting.',
  ].join('\n');

  return {
    draft,
    sources: [
      'https://example.com/primary-source',
      'https://example.com/secondary-source',
    ],
  };
}
