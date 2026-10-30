// Knowledge library ingest (11_SCORA_Knowledge_Library_Spec_v0_1.md §2.3).
//
// FieldCopy JSON export -> sources + chunks -> embeddings -> knowledge tables.
// Parsing, chunking and citation mapping are pure. Embedding and storage are
// injected, so tests run with no network and the real OpenAI and Supabase
// calls only happen from the admin script.

import { z } from 'zod';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMS = 1536;

// Chunk size in characters. Roughly 300 to 400 tokens, small enough that one
// chunk is one idea, large enough to keep the author's argument intact.
export const CHUNK_MAX_CHARS = 1500;
export const CHUNK_OVERLAP_CHARS = 200;
// Entry ids per delete during a sync prune. 100 UUIDs keep a PostgREST
// `in.(...)` filter near 4 KB, well under URL limits.
export const PRUNE_BATCH = 100;
// Rows per page when listing stored entry ids (PostgREST caps at 1000).
const LIST_PAGE = 1000;
const EMBED_BATCH = 64;

// One FieldCopy export entry (spec §3).
const EntrySchema = z.object({
  id: z.string().min(1),
  source_title: z.string().min(1),
  source_author: z.string().nullish(),
  page: z.union([z.string(), z.number()]).nullish(),
  passage: z.string().min(1),
  take: z.string().nullish(),
  summary: z.string().nullish(),
  tags: z.array(z.string()).nullish(),
  captured_at: z.string().nullish(),
});
export type ExportEntry = z.infer<typeof EntrySchema>;

export class IngestError extends Error {}

// Accepts an array, or an object with an `entries` array. Every entry must be
// valid; a bad export fails whole rather than ingesting half a book.
export function parseExport(json: unknown): ExportEntry[] {
  const raw = Array.isArray(json) ? json : (json as any)?.entries;
  if (!Array.isArray(raw)) throw new IngestError('Export must be an array of entries or { entries: [...] }');
  return raw.map((e, i) => {
    const r = EntrySchema.safeParse(e);
    if (!r.success) {
      const issue = r.error.issues[0];
      throw new IngestError(`Entry ${i}: ${issue.path.join('.') || '(root)'} ${issue.message}`);
    }
    return r.data;
  });
}

// Split a passage into chunks no longer than maxChars, breaking at paragraph,
// then sentence, then word boundaries. Consecutive chunks share up to
// `overlap` characters of trailing context so an idea split across a boundary
// is still retrievable from either side.
export function chunkPassage(text: string, maxChars = CHUNK_MAX_CHARS, overlap = CHUNK_OVERLAP_CHARS): string[] {
  const clean = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  if (clean.length === 0) return [];
  if (clean.length <= maxChars) return [clean];

  // Units: sentences within paragraphs. A sentence longer than maxChars is
  // split on words.
  const units: string[] = [];
  for (const para of clean.split(/\n\s*\n/)) {
    // Split only where sentence punctuation is followed by whitespace, so
    // "2.5", "42.2 km" and "e.g." survive. Rejoining with one space gives
    // back the (whitespace-normalized) text exactly.
    const sentences = para.replace(/\n/g, ' ').split(/(?<=[.!?]["')\]]*)\s+/);
    for (const s of sentences) {
      const t = s.trim();
      if (!t) continue;
      if (t.length <= maxChars) { units.push(t); continue; }
      let cur = '';
      for (const w of t.split(' ')) {
        if (cur && cur.length + 1 + w.length > maxChars) { units.push(cur); cur = w; }
        else cur = cur ? `${cur} ${w}` : w;
      }
      if (cur) units.push(cur);
    }
  }

  const chunks: string[] = [];
  let cur = '';
  for (const u of units) {
    if (cur && cur.length + 1 + u.length > maxChars) {
      chunks.push(cur);
      // Carry the tail of the previous chunk, on a word boundary.
      let tail = cur.length > overlap ? cur.slice(cur.length - overlap) : cur;
      const sp = tail.indexOf(' ');
      if (cur.length > overlap && sp >= 0) tail = tail.slice(sp + 1);
      cur = tail && tail.length + 1 + u.length <= maxChars ? `${tail} ${u}` : u;
    } else {
      cur = cur ? `${cur} ${u}` : u;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export interface PlannedSource {
  key: string; // title + author, lowercased
  title: string;
  author: string | null;
}

export interface PlannedChunk {
  sourceKey: string;
  fieldcopy_entry_id: string;
  chunk_index: number;
  page: string | null;
  text: string;
  take: string | null;
  tags: string[];
  // What gets embedded: the passage chunk plus Evan's take, when there is one.
  embedText: string;
}

export interface IngestPlan {
  sources: PlannedSource[];
  chunks: PlannedChunk[];
}

const sourceKey = (title: string, author: string | null) =>
  `${title.trim().toLowerCase()}\u0000${(author ?? '').trim().toLowerCase()}`;

const normTags = (tags: string[] | null | undefined): string[] =>
  [...new Set((tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))];

export function planIngest(entries: ExportEntry[]): IngestPlan {
  const sources = new Map<string, PlannedSource>();
  const chunks: PlannedChunk[] = [];
  const seen = new Set<string>();

  for (const e of entries) {
    if (seen.has(e.id)) throw new IngestError(`Duplicate entry id ${e.id}`);
    seen.add(e.id);

    const title = e.source_title.trim();
    const author = e.source_author?.trim() || null;
    const key = sourceKey(title, author);
    if (!sources.has(key)) sources.set(key, { key, title, author });

    const take = e.take?.trim() || null;
    const page = e.page == null ? null : String(e.page);
    chunkPassage(e.passage).forEach((text, i) => {
      chunks.push({
        sourceKey: key,
        fieldcopy_entry_id: e.id,
        chunk_index: i,
        page,
        text,
        take,
        tags: normTags(e.tags),
        embedText: take ? `${text}\n\nTake: ${take}` : text,
      });
    });
  }
  return { sources: [...sources.values()], chunks };
}

// ---- injected dependencies ----------------------------------------------

export type Embedder = (texts: string[]) => Promise<number[][]>;

export interface KnowledgeStore {
  // Returns the source id, creating the row if needed.
  upsertSource(s: PlannedSource): Promise<string>;
  // Insert or replace by (fieldcopy_entry_id, chunk_index).
  upsertChunk(sourceId: string, c: PlannedChunk, embedding: number[]): Promise<void>;
  // Delete an entry's chunks with chunk_index >= keep (left over when an
  // edited passage now splits into fewer chunks).
  pruneEntry(fieldcopyEntryId: string, keep: number): Promise<void>;
  // Full sync: delete every FieldCopy-sourced chunk whose entry is not in
  // `keepEntryIds` (entries removed from the export). Lists the stored ids
  // and deletes the missing ones in batches of PRUNE_BATCH. Refuses an empty
  // keep list, which would wipe the library.
  pruneMissing(keepEntryIds: string[]): Promise<void>;
}

export interface IngestResult {
  sources: number;
  chunks: number;
  embedCalls: number;
}

export async function ingest(
  entries: ExportEntry[],
  // sync: the export is the whole library, so entries missing from it are
  // removed too. Off by default (a partial export must not wipe the rest).
  deps: { embed: Embedder; store: KnowledgeStore; batchSize?: number; sync?: boolean }
): Promise<IngestResult> {
  // Checked before any embedding is paid for: an empty export under sync
  // would delete every FieldCopy chunk.
  if (deps.sync && entries.length === 0) {
    throw new IngestError('Refusing to sync an empty export: it would delete the whole library');
  }
  const plan = planIngest(entries);
  const batch = deps.batchSize ?? EMBED_BATCH;

  const ids = new Map<string, string>();
  for (const s of plan.sources) ids.set(s.key, await deps.store.upsertSource(s));

  let embedCalls = 0;
  for (let i = 0; i < plan.chunks.length; i += batch) {
    const slice = plan.chunks.slice(i, i + batch);
    const vectors = await deps.embed(slice.map((c) => c.embedText));
    embedCalls++;
    if (vectors.length !== slice.length) {
      throw new IngestError(`Embedder returned ${vectors.length} vectors for ${slice.length} texts`);
    }
    for (let j = 0; j < slice.length; j++) {
      if (vectors[j].length !== EMBEDDING_DIMS) {
        throw new IngestError(`Embedding has ${vectors[j].length} dims, expected ${EMBEDDING_DIMS}`);
      }
      await deps.store.upsertChunk(ids.get(slice[j].sourceKey)!, slice[j], vectors[j]);
    }
  }
  const perEntry = new Map<string, number>();
  for (const c of plan.chunks) perEntry.set(c.fieldcopy_entry_id, (perEntry.get(c.fieldcopy_entry_id) ?? 0) + 1);
  // Every entry in the export, including ones that now produce no chunks
  // (edited down to nothing), keeps only its current chunks.
  for (const e of entries) await deps.store.pruneEntry(e.id, perEntry.get(e.id) ?? 0);
  if (deps.sync) await deps.store.pruneMissing(entries.map((e) => e.id));

  return { sources: plan.sources.length, chunks: plan.chunks.length, embedCalls };
}

function refuseEmptyKeep(keepEntryIds: string[]): void {
  if (keepEntryIds.length === 0) {
    throw new IngestError('Refusing to sync with no entries: it would delete the whole library');
  }
}

// Stored ids not in the keep list, split into delete batches.
function missingBatches(stored: Iterable<string>, keepEntryIds: string[]): string[][] {
  const keep = new Set(keepEntryIds);
  const missing = [...new Set(stored)].filter((id) => !keep.has(id));
  const out: string[][] = [];
  for (let i = 0; i < missing.length; i += PRUNE_BATCH) out.push(missing.slice(i, i + PRUNE_BATCH));
  return out;
}

// OpenAI embeddings over fetch, matching how the API already calls OpenAI.
// `fetchImpl` is injectable for tests.
export function openAiEmbedder(apiKey: string, fetchImpl: typeof fetch = fetch): Embedder {
  return async (texts) => {
    const res = await fetchImpl('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
    });
    if (!res.ok) throw new IngestError(`OpenAI embeddings failed: ${res.status} ${await res.text()}`);
    const json: any = await res.json();
    return (json.data as any[])
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding as number[]);
  };
}

// A store over any SQL client with a `query(sql, params)` that returns
// `{ rows }` (pg, PGlite). Used by tests and by the admin script.
export function sqlStore(db: { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> }): KnowledgeStore {
  return {
    async upsertSource(s) {
      // Look up first: a null author never conflicts on unique (title, author).
      const found = await db.query(
        'select id from knowledge_sources where title = $1 and author is not distinct from $2 limit 1',
        [s.title, s.author]
      );
      if (found.rows[0]) return found.rows[0].id;
      const r = await db.query(
        'insert into knowledge_sources (title, author) values ($1, $2) returning id',
        [s.title, s.author]
      );
      return r.rows[0].id;
    },
    async upsertChunk(sourceId, c, embedding) {
      await db.query(
        `insert into knowledge_chunks
           (source_id, page, text, take, tags, embedding, embedding_model, fieldcopy_entry_id, chunk_index)
         values ($1, $2, $3, $4, $5, $6::vector, $7, $8, $9)
         on conflict (fieldcopy_entry_id, chunk_index) do update set
           source_id = excluded.source_id, page = excluded.page, text = excluded.text,
           take = excluded.take, tags = excluded.tags, embedding = excluded.embedding,
           embedding_model = excluded.embedding_model`,
        [sourceId, c.page, c.text, c.take, c.tags, `[${embedding.join(',')}]`, EMBEDDING_MODEL,
          c.fieldcopy_entry_id, c.chunk_index]
      );
    },
    async pruneEntry(entryId, keep) {
      await db.query('delete from knowledge_chunks where fieldcopy_entry_id = $1 and chunk_index >= $2', [entryId, keep]);
    },
    async pruneMissing(keepEntryIds) {
      refuseEmptyKeep(keepEntryIds);
      const stored = await db.query(
        'select distinct fieldcopy_entry_id as id from knowledge_chunks where fieldcopy_entry_id is not null'
      );
      for (const ids of missingBatches(stored.rows.map((r) => r.id as string), keepEntryIds)) {
        await db.query('delete from knowledge_chunks where fieldcopy_entry_id = any($1)', [ids]);
      }
    },
  };
}

// Minimal slice of the supabase-js client the store needs, so tests can fake it.
export interface SupabaseLike {
  from(table: string): any;
}

// The production store: supabase-js with the service role key. pgvector
// columns take the '[1,2,3]' text form through PostgREST.
export function supabaseStore(sb: SupabaseLike): KnowledgeStore {
  return {
    async upsertSource(s) {
      let q = sb.from('knowledge_sources').select('id').eq('title', s.title);
      q = s.author === null ? q.is('author', null) : q.eq('author', s.author);
      const found = await q.limit(1);
      if (found.error) throw new IngestError(`Source lookup failed: ${found.error.message}`);
      if (found.data?.[0]) return found.data[0].id;
      const ins = await sb.from('knowledge_sources').insert({ title: s.title, author: s.author }).select('id').single();
      if (ins.error) throw new IngestError(`Source insert failed: ${ins.error.message}`);
      return ins.data.id;
    },
    async upsertChunk(sourceId, c, embedding) {
      const r = await sb.from('knowledge_chunks').upsert(
        {
          source_id: sourceId,
          page: c.page,
          text: c.text,
          take: c.take,
          tags: c.tags,
          embedding: `[${embedding.join(',')}]`,
          embedding_model: EMBEDDING_MODEL,
          fieldcopy_entry_id: c.fieldcopy_entry_id,
          chunk_index: c.chunk_index,
        },
        { onConflict: 'fieldcopy_entry_id,chunk_index' }
      );
      if (r.error) throw new IngestError(`Chunk upsert failed: ${r.error.message}`);
    },
    async pruneEntry(entryId, keep) {
      const r = await sb.from('knowledge_chunks').delete().eq('fieldcopy_entry_id', entryId).gte('chunk_index', keep);
      if (r.error) throw new IngestError(`Chunk prune failed: ${r.error.message}`);
    },
    async pruneMissing(keepEntryIds) {
      refuseEmptyKeep(keepEntryIds);
      // List stored ids page by page (one row per chunk, so ids repeat), then
      // delete the missing ones in small batches: a single 'not in' over the
      // whole export overflows the URL once the library is large.
      const stored: string[] = [];
      for (let from = 0; ; from += LIST_PAGE) {
        const r = await sb.from('knowledge_chunks').select('fieldcopy_entry_id')
          .not('fieldcopy_entry_id', 'is', null)
          .order('fieldcopy_entry_id').order('chunk_index')
          .range(from, from + LIST_PAGE - 1);
        if (r.error) throw new IngestError(`Chunk sync listing failed: ${r.error.message}`);
        const rows = (r.data ?? []) as { fieldcopy_entry_id: string }[];
        stored.push(...rows.map((x) => x.fieldcopy_entry_id));
        if (rows.length < LIST_PAGE) break;
      }
      for (const ids of missingBatches(stored, keepEntryIds)) {
        const r = await sb.from('knowledge_chunks').delete().in('fieldcopy_entry_id', ids);
        if (r.error) throw new IngestError(`Chunk sync failed: ${r.error.message}`);
      }
    },
  };
}
