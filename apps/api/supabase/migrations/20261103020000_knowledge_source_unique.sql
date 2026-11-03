-- One knowledge_sources row per (title, author), with no author counted as one
-- value: unique (title, author) treats nulls as distinct, so two ingest runs
-- of an authorless source each inserted a row. Additive: an index only.
-- If the library was already ingested, check first that this finds nothing:
--   select title, count(*) from knowledge_sources where author is null group by title having count(*) > 1;
create unique index if not exists knowledge_sources_title_author_one
  on knowledge_sources (title, author) nulls not distinct;
