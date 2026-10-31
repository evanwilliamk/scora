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
import { openAiEmbedder, EMBEDDING_DIMS } from './knowledge-ingest';
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
// A null posture is one no rule backed: the query then says nothing about it.
export function buildRetrievalQuery(
  posture: Posture | null,
  d: PostureDrivers,
  scheduled?: ScheduledWorkout | null
): RetrievalQuery {
  const parts: string[] = [posture ? `Endurance athlete, body state reads ${posture}.` : 'Endurance athlete.'];
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
  // postureBacked false: the posture is the engine's default with no evidence.
  // Nothing downstream may lean on it (no posture in the query, no pattern,
  // since every pattern is keyed to a posture).
  // sleepSeconds: last night's sleep duration (Oura or HealthKit). It backs the
  // patterns' sleep-hours slot; it is not a posture driver.
  input: { posture: Posture; postureBacked?: boolean; drivers: PostureDrivers; completeness: number; scheduled?: ScheduledWorkout | null; sleepSeconds?: number | null },
  deps: KnowledgeDeps
): Promise<ReadKnowledge> {
  if (deps.enabled && deps.embed && deps.match) {
    try {
      const q = buildRetrievalQuery(input.postureBacked === false ? null : input.posture, input.drivers, input.scheduled);
      const [embedding] = await deps.embed([q.text]);
      if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMS) {
        throw new Error(`Query embedding has ${Array.isArray(embedding) ? embedding.length : 'no'} dims, expected ${EMBEDDING_DIMS}`);
      }
      const close = (cs: RetrievedChunk[]) => cs.filter((c) => c.similarity >= RETRIEVAL_MIN_SIMILARITY);
      let chunks = close(await deps.match(embedding, RETRIEVAL_TOP_K, q.tags));
      // Tags can be too narrow for a young library: retry unfiltered when the
      // tagged search found nothing close enough (not just nothing at all).
      if (chunks.length === 0 && q.tags.length > 0) chunks = close(await deps.match(embedding, RETRIEVAL_TOP_K, []));
      if (chunks.length > 0) {
        return { mode: 'library', chunks, pattern: null, promptBlock: libraryPromptBlock(chunks) };
      }
    } catch (e) {
      deps.log?.warn(`Knowledge retrieval failed, falling back to patterns: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (input.postureBacked === false) return { mode: 'none', chunks: [], pattern: null, promptBlock: '' };
  const pattern = selectPattern(
    {
      posture: input.posture,
      drivers: {
        ...(input.drivers as Record<string, number | boolean | null | undefined>),
        sleep_last_night_seconds:
          typeof input.sleepSeconds === 'number' && Number.isFinite(input.sleepSeconds) && input.sleepSeconds > 0 ? input.sleepSeconds : null,
      },
      scheduledWorkout: input.scheduled ?? null,
      dataCompleteness: input.completeness,
    },
    deps.patterns ?? getPatterns()
  );
  if (pattern) return { mode: 'pattern', chunks: [], pattern, promptBlock: patternPromptBlock(pattern) };
  return { mode: 'none', chunks: [], pattern: null, promptBlock: '' };
}

// The chunks a finished read actually drew on. The deterministic fallback is
// built from drivers alone, so it cites nothing (spec §3: citations say why
// SCORA said something, and must not point at passages it did not use).
export function citedChunks(k: ReadKnowledge, voice: { usedFallback: boolean }): RetrievedChunk[] {
  return k.mode === 'library' && !voice.usedFallback ? k.chunks : [];
}

// Library-mode checks on top of the validators (spec §5). A passage may
// describe workouts; the read may relay its substance, never its advice, and
// never its numbers. Labels only, no passage text or athlete values, so the
// hits are safe to log. Fed to generateValidatedVoice as an extra check.
const LIBRARY_ADVICE = new RegExp(
  String.raw`\b(?:worth (?:backing|easing|cutting|holding|taking|skipping|resting|keeping|dropping|shortening)` +
  String.raw`|the (?:right|smart|safe|wise) (?:call|move|choice|play)` +
  String.raw`|(?:recommends?|suggests?|advises?|urges?) (?:cutting|easing|skipping|resting|backing|holding|taking|dropping|shortening|keeping|an? (?:easy|rest|recovery|light|short))` +
  String.raw`|would (?:cut|skip|drop|shorten|rest|back off|ease off|hold back|pull back|swap)` +
  String.raw`|(?:better|safer|wiser) to (?:ease|rest|skip|back|hold|cut|wait|take|keep|go))\b`,
  'i'
);
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90,
};
const numbersIn = (t: string): Set<number> => {
  const out = new Set<number>();
  for (const m of t.toLowerCase().matchAll(/\b(\d+(?:\.\d+)?|[a-z]+)\b/g)) {
    const n = /^\d/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
    if (n !== undefined) out.add(n);
  }
  return out;
};

export function libraryClaimHits(voice: string, chunks: RetrievedChunk[], driverValues: string[]): string[] {
  const hits: string[] = [];
  if (LIBRARY_ADVICE.test(voice)) hits.push('library advice');
  // Digits are the validator's job. Number words it lets through ("three hard
  // days") are caught here when a passage carries that number and no driver does.
  const fromLibrary = numbersIn(chunks.map((c) => `${c.text} ${c.take ?? ''}`).join(' '));
  const backed = numbersIn(driverValues.join(' '));
  for (const m of voice.toLowerCase().matchAll(/\b([a-z]+)\b/g)) {
    const n = NUMBER_WORDS[m[1]];
    if (n !== undefined && fromLibrary.has(n) && !backed.has(n)) hits.push(`library number ${m[1]}`);
  }
  return [...new Set(hits)];
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
