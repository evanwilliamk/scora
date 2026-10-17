-- Knowledge library (11_SCORA_Knowledge_Library_Spec_v0_1.md §3).
-- A fixed set of trusted sources, chunked and embedded, that the read pipeline
-- retrieves from. Admin content: only the API (service role) touches these
-- tables, so RLS is on with no policies.

create extension if not exists vector;

-- One book, coach or paper Evan has added to the library.
create table if not exists knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  author text,
  kind text not null default 'book' check (kind in ('book', 'coach', 'paper')),
  added_by text,
  added_at timestamptz not null default now(),
  -- Retiring a source hides its chunks from retrieval without deleting them.
  active boolean not null default true,
  unique (title, author)
);

-- One retrievable passage. Embedding is OpenAI text-embedding-3-small (1536 dims).
create table if not exists knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references knowledge_sources(id) on delete cascade,
  page text,
  text text not null,
  take text,
  tags text[] not null default '{}',
  embedding vector(1536),
  embedding_model text not null default 'text-embedding-3-small',
  -- FieldCopy entry this chunk came from; with chunk_index it makes re-ingest
  -- of the same export idempotent.
  fieldcopy_entry_id text,
  chunk_index int not null default 0,
  created_at timestamptz not null default now(),
  unique (fieldcopy_entry_id, chunk_index)
);

create index if not exists knowledge_chunks_source_idx on knowledge_chunks(source_id);
create index if not exists knowledge_chunks_tags_idx on knowledge_chunks using gin(tags);
create index if not exists knowledge_chunks_embedding_idx
  on knowledge_chunks using hnsw (embedding vector_cosine_ops);

-- Which chunks each read used, so a read can be audited and a bad source
-- retired. Reads are generated on request and not stored yet, so a read is
-- identified by athlete + kind + generation time.
create table if not exists read_citations (
  id uuid primary key default gen_random_uuid(),
  athlete_id text not null, -- strava_id, same key as device_tokens
  read_kind text not null default 'daily' check (read_kind in ('daily', 'weekly', 'cdv')),
  read_generated_at timestamptz not null,
  chunk_id uuid not null references knowledge_chunks(id) on delete cascade,
  rank int not null default 0, -- position in the retrieved set, 0 = best
  similarity real,
  created_at timestamptz not null default now()
);

create index if not exists read_citations_athlete_idx on read_citations(athlete_id, read_generated_at);
create index if not exists read_citations_chunk_idx on read_citations(chunk_id);

alter table knowledge_sources enable row level security;
alter table knowledge_chunks enable row level security;
alter table read_citations enable row level security;

-- Top-k retrieval for supabase-js rpc('match_knowledge_chunks', ...).
-- Active sources only; when filter_tags is non-empty, a chunk must share at
-- least one tag. Similarity is cosine (1 = identical).
--
-- Unfiltered queries use the HNSW index. Tagged queries search the tagged
-- rows exactly (GIN on tags, then distance), because HNSW returns its ~40
-- nearest neighbours before any WHERE runs and would drop closer tagged
-- chunks in a large library.
create or replace function match_knowledge_chunks(
  query_embedding vector(1536),
  match_count int default 5,
  filter_tags text[] default '{}'
)
returns table (
  id uuid,
  source_id uuid,
  source_title text,
  source_author text,
  page text,
  text text,
  take text,
  tags text[],
  similarity real
)
language plpgsql stable
as $$
begin
  if cardinality(filter_tags) = 0 then
    return query
      select c.id, c.source_id, s.title, s.author, c.page, c.text, c.take, c.tags,
        (1 - (c.embedding <=> query_embedding))::real
      from knowledge_chunks c
      join knowledge_sources s on s.id = c.source_id
      where s.active and c.embedding is not null
      order by c.embedding <=> query_embedding
      limit greatest(match_count, 0);
  else
    return query
      with tagged as materialized (
        select c.id, c.source_id, c.page, c.text, c.take, c.tags, c.embedding
        from knowledge_chunks c
        where c.tags && filter_tags and c.embedding is not null
      )
      select t.id, t.source_id, s.title, s.author, t.page, t.text, t.take, t.tags,
        (1 - (t.embedding <=> query_embedding))::real
      from tagged t
      join knowledge_sources s on s.id = t.source_id
      where s.active
      order by t.embedding <=> query_embedding
      limit greatest(match_count, 0);
  end if;
end;
$$;
