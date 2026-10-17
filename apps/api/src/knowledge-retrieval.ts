// Knowledge retrieval for the daily read (11_SCORA_Knowledge_Library_Spec_v0_1.md
// §2.4 to §2.6).
//
// Posture + drivers -> a search query -> top library chunks -> a prompt block
// the LLM reads for substance. Behind KNOWLEDGE_RETRIEVAL=on, off by default.
// When retrieval is off, fails, or finds nothing close enough, the curated
// pattern library is the fallback, then nothing. Validators downstream are
// unchanged: every number in the read still has to be a real driver.

import type { PostureDrivers, Posture } from '../../../packages/posture/src/index';
import { getPatterns, selectPattern } from '../../../packages/voice/src/index';
import type { PatternEntry, ScheduledWorkout } from '../../../packages/voice/src/index';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { openAiEmbedder } from './knowledge-ingest';
import type { Embedder } from './knowledge-ingest';

export const RETRIEVAL_TOP_K = 4;
// Cosine similarity below this is noise for text-embedding-3-small.
export const RETRIEVAL_MIN_SIMILARITY = 0.3;

export const knowledgeRetrievalEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.KNOWLEDGE_RETRIEVAL === 'on';

export interface RetrievedChunk {
  id: string;
  source_title: string;
  source_author: string | null;
  page: string | null;
  text: string;
  take: string | null;
  similarity: number;
}

export type ChunkMatcher = (embedding: number[], count: number, tags: string[]) => Promise<RetrievedChunk[]>;

export interface RetrievalQuery {
  text: string;
  tags: string[];
}

// Plain-language description of the athlete's situation, built only from
// drivers that exist. Tags narrow retrieval to the topics in play; an empty
// tag list searches the whole library.
export function buildRetrievalQuery(
  posture: Posture,
  d: PostureDrivers,
  scheduled?: ScheduledWorkout | null
): RetrievalQuery {
  const parts: string[] = [`Endurance athlete, body state reads ${posture}.`];
  const tags = new Set<string>();

  if (d.acwr != null) {
    if (d.acwr > 1.3) { parts.push('Training load has spiked well above the recent norm.'); tags.add('load'); }
    else if (d.acwr < 0.8) { parts.push('Training load is well below the recent norm.'); tags.add('load'); }
  }
  if (d.consecutive_hard_days != null && d.consecutive_hard_days >= 2) {
    parts.push(`${d.consecutive_hard_days} hard days in a row.`);
    tags.add('intensity');
    tags.add('recovery');
  }
  if ((d.sleep_7d_avg_delta != null && d.sleep_7d_avg_delta < -3)
    || (d.consecutive_low_sleep_nights != null && d.consecutive_low_sleep_nights >= 2)) {
    parts.push('Sleep has been short or poor compared with usual.');
    tags.add('sleep');
  }
  if (d.hrv_7d_avg_delta != null && Math.abs(d.hrv_7d_avg_delta) >= 5) {
    parts.push(d.hrv_7d_avg_delta < 0 ? 'HRV is down against the weekly baseline.' : 'HRV is up against the weekly baseline.');
    tags.add('recovery');
    tags.add('hrv');
  }
  if (d.rhr_7d_avg_delta != null && d.rhr_7d_avg_delta > 2) {
    parts.push('Resting heart rate is elevated.');
    tags.add('recovery');
  }
  if (d.race_in_next_7d) { parts.push('Race within a week.'); tags.add('taper'); }
  if (posture === 'taper') tags.add('taper');
  if (scheduled?.planned_intensity) parts.push(`The plan has a ${scheduled.planned_intensity} session today.`);

  return { text: parts.join(' '), tags: [...tags] };
}

export type KnowledgeMode = 'library' | 'pattern' | 'none';

export interface ReadKnowledge {
  mode: KnowledgeMode;
  chunks: RetrievedChunk[];
  pattern: PatternEntry | null;
  // Goes in the user prompt as is; empty when mode is 'none'.
  promptBlock: string;
}

export function libraryPromptBlock(chunks: RetrievedChunk[]): string {
  const items = chunks.map((c, i) => {
    const cite = [c.source_title, c.source_author, c.page ? `p. ${c.page}` : null].filter(Boolean).join(', ');
    return `[${i + 1}] (${cite}) ${c.text}${c.take ? `\n    Reader's take: ${c.take}` : ''}`;
  });
  return `LIBRARY (fundamentals from trusted sources, for substance only):
${items.join('\n')}
Use the library to explain what the athlete's numbers mean. Paraphrase; never quote more than a short phrase. Never take a number from the library: every number must come from DRIVERS. The library may describe workouts; the read still never tells the athlete what to do.`;
}

export function patternPromptBlock(p: PatternEntry): string {
  const lines = [`PATTERN (curated read for this situation, ${p.id}):`, `Shape: ${p.template.trim()}`];
  if (p.tone_notes) lines.push(`Tone: ${p.tone_notes.trim().replace(/\s+/g, ' ')}`);
  if (p.llm_hint) lines.push(`Hint: ${p.llm_hint.trim().replace(/\s+/g, ' ')}`);
  lines.push('Fill the shape only with values from DRIVERS. If a slot has no driver, leave that clause out.');
  return lines.join('\n');
}

export interface KnowledgeDeps {
  enabled: boolean;
  embed?: Embedder;
  match?: ChunkMatcher;
  patterns?: PatternEntry[];
  log?: { warn: (msg: string) => void };
}

export async function knowledgeForRead(
  input: { posture: Posture; drivers: PostureDrivers; completeness: number; scheduled?: ScheduledWorkout | null },
  deps: KnowledgeDeps
): Promise<ReadKnowledge> {
  if (deps.enabled && deps.embed && deps.match) {
    try {
      const q = buildRetrievalQuery(input.posture, input.drivers, input.scheduled);
      const [embedding] = await deps.embed([q.text]);
      let chunks = await deps.match(embedding, RETRIEVAL_TOP_K, q.tags);
      // Tags can be too narrow for a young library: retry unfiltered.
      if (chunks.length === 0 && q.tags.length > 0) chunks = await deps.match(embedding, RETRIEVAL_TOP_K, []);
      chunks = chunks.filter((c) => c.similarity >= RETRIEVAL_MIN_SIMILARITY);
      if (chunks.length > 0) {
        return { mode: 'library', chunks, pattern: null, promptBlock: libraryPromptBlock(chunks) };
      }
    } catch (e) {
      deps.log?.warn(`Knowledge retrieval failed, falling back to patterns: ${e instanceof Error ? e.message : e}`);
    }
  }

  const pattern = selectPattern(
    {
      posture: input.posture,
      drivers: input.drivers as Record<string, number | boolean | null | undefined>,
      scheduledWorkout: input.scheduled ?? null,
      dataCompleteness: input.completeness,
    },
    deps.patterns ?? getPatterns()
  );
  if (pattern) return { mode: 'pattern', chunks: [], pattern, promptBlock: patternPromptBlock(pattern) };
  return { mode: 'none', chunks: [], pattern: null, promptBlock: '' };
}

// supabase-js rpc over match_knowledge_chunks (migration 20261017000000).
export function supabaseChunkMatcher(sb: { rpc: (fn: string, args: any) => any }): ChunkMatcher {
  return async (embedding, count, tags) => {
    const { data, error } = await sb.rpc('match_knowledge_chunks', {
      query_embedding: `[${embedding.join(',')}]`,
      match_count: count,
      filter_tags: tags,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as RetrievedChunk[];
  };
}

// Best-effort audit trail: which chunks a read used (spec §3, read_citations).
export async function recordCitations(
  sb: { from: (t: string) => any },
  athleteId: string,
  generatedAt: string,
  chunks: RetrievedChunk[]
): Promise<void> {
  if (chunks.length === 0) return;
  const { error } = await sb.from('read_citations').insert(
    chunks.map((c, rank) => ({
      athlete_id: athleteId,
      read_kind: 'daily',
      read_generated_at: generatedAt,
      chunk_id: c.id,
      rank,
      similarity: c.similarity,
    }))
  );
  if (error) throw new Error(error.message);
}

let _sb: SupabaseClient | null = null;

// Live wiring for the read route. Builds the OpenAI and Supabase clients only
// when the flag is on, so a default deploy makes no extra calls.
export function knowledgeDepsFromEnv(log?: KnowledgeDeps['log']): KnowledgeDeps & { sb: SupabaseClient | null } {
  const enabled = knowledgeRetrievalEnabled();
  const { OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!enabled || !OPENAI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { enabled: false, log, sb: null };
  }
  _sb = _sb ?? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  return { enabled: true, embed: openAiEmbedder(OPENAI_API_KEY), match: supabaseChunkMatcher(_sb), log, sb: _sb };
}
