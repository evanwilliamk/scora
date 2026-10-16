# SCORA Knowledge Library Spec v0.1

Version: 0.1 (2026-10-13). Status: DRAFT, direction approved by Evan, details open for review.
Owner: Evan Kosowski. Drafted by Claude Code from Evan's direction on 2026-10-13.
Relates to: `02_SCORA_PRD_v1_4.md`, `06_SCORA_Pattern_Library_v0_3.md`, `07_SCORA_Architecture_Data_Model_v2.md`, `08_SCORA_LLM_Prompt_Spec_v2.md`. Where this doc and those disagree, this doc wins for the knowledge layer; everything else in them stands.

---

## 0. What this changes

SCORA's interpretations come from a **fixed library of trusted sources** (books and credible coaches that Evan selects), not from the open internet and not only from a hand-written list of canned patterns.

Think NotebookLM: the model reasons over a closed set of sources. For SCORA that means every morning read is written fresh from (a) the athlete's real numbers and (b) the fundamentals in the library that apply to those numbers. Messages adapt to the athlete; they are not picked from a fixed set.

## 1. Two separate verticals

| Vertical | Question it answers | How it is built |
|---|---|---|
| **Knowledge** | What do the best sources say about this athlete's situation? | Retrieval over the source library (RAG). This doc. |
| **Voice** | Does it sound like a person, not a dashboard? | Prompt instructions plus example messages now (`08_SCORA_LLM_Prompt_Spec_v2.md`). Fine-tuning later, once there are enough approved messages to train on. |

Whose words end up in the message (Evan's, the author's, or the model's) does not matter. What matters: the substance comes from the library, the numbers come from the athlete's data, and it sounds human.

## 2. Pipeline

1. **Capture (FieldCopy).** Evan scans pages from a source, extracts passages, optionally writes a take. FieldCopy already stores source (author, title, page), passage, take and summary as separate fields.
2. **Export (FieldCopy, small addition).** User-initiated export of entries as JSON (one object per entry, fields in §3). Runs on Evan's device; FieldCopy stays private and offline for every other user.
3. **Ingest (SCORA API, new).** An admin-only endpoint or script reads the export, splits long passages into chunks, creates an embedding per chunk, and stores chunk text, embedding and citation in Postgres (pgvector on Supabase).
4. **Retrieve (at message time).** The posture engine runs exactly as today. Its output (posture, key drivers and their values, scheduled workout) becomes a search query. Top matching chunks are pulled from the library, filtered by tags (sport, topic) where present.
5. **Generate.** The LLM gets the athlete's driver values, the retrieved chunks with citations, and the voice instructions, and writes the message.
6. **Validate (unchanged, still required).** Driver-existence validator, banned-phrase validator and the non-prescriptive check all run on the output. A message that fails is regenerated or falls back to a pattern-library entry.

Existing pattern library entries (`packages/voice/patterns`) are kept as (a) the fallback when retrieval finds nothing useful and (b) worked examples of the voice inside the prompt. They are no longer the only source of interpretations.

## 3. Data shapes

FieldCopy export entry (JSON):

```
{ "id": "uuid", "source_title": "...", "source_author": "...", "page": "112",
  "passage": "...", "take": "... or null", "summary": "... or null",
  "tags": ["sleep", "taper"], "captured_at": "2026-10-13T08:00:00Z" }
```

New tables (sketch; final schema goes in the next `07_SCORA_Architecture_Data_Model` revision):

- `knowledge_sources`: id, title, author, kind (book, coach, paper), added_by, added_at, active.
- `knowledge_chunks`: id, source_id, page, text, take, tags, embedding `vector(1536)`, fieldcopy_entry_id, created_at.
- `read_citations`: read_id, chunk_id. Records which chunks each message used, so Evan can audit why SCORA said something and retire bad sources.

## 4. Cost (approved by Evan 2026-10-13)

- **Embeddings:** OpenAI `text-embedding-3-small`. Order of magnitude: a full book is roughly 100k to 150k tokens, so embedding even hundreds of books is cents to a few dollars, once. Re-embedding only happens on model change. Verify the current price before the first ingest.
- **Storage:** pgvector inside the existing Supabase project; fits the free tier at this scale.
- **Per message:** one query embedding (negligible) plus a slightly longer prompt (retrieved chunks). Track prompt size in the read pipeline.

Anything beyond this (a paid vector database, a hosted fine-tune, a larger model tier) is a separate decision for Evan.

## 5. Guardrails

- Library only. The prompt forbids claims that are not supported by the athlete's data or a retrieved chunk. No open web lookups.
- Every claim about the athlete still needs a real driver value (unchanged rule).
- Citations are stored for every message (`read_citations`), shown to the athlete only if Evan decides to (open question).
- Phase 1 voice stays non-prescriptive (CLAUDE.md §1). Prescriptive coaching is a later phase, see §7.

## 6. Open questions for Evan

1. Show sources to athletes ("based on Daniels' Running Formula") or keep them internal?
2. Which sources go in first? A starter list of 5 to 10 lets the first ingest run end to end.
3. Long verbatim quotes in athlete-facing messages: allow, or keep to paraphrase? Paraphrase is the safer default until a legal read before public launch.
4. Fine-tuning for voice: when there are a few hundred approved messages, revisit.

## 7. Future phase: SCORA as a coaching app (direction, not Phase 1)

Evan, 2026-10-13: SCORA ultimately needs to be a coaching app to monetize. Not Phase 1, but documented now so nothing built today blocks it.

What that means for the knowledge library:
- The same library becomes the basis for prescriptive guidance (what to do today, how to adjust the week), grounded in the sources and the athlete's data rather than invented by the model.
- The non-prescriptive voice rules (CLAUDE.md §1, §2.2, §11) hold until Evan starts the coaching phase. They are no longer permanent.
- Still to decide when that phase starts: how AI coaching relates to the Plan tier's deterministic templates and to the human coach marketplace, pricing, and the safety and liability position (medical disclaimers, injury handling).

## 8. Build order (proposed)

1. FieldCopy: JSON export of entries (FieldCopy repo).
2. SCORA: pgvector migration plus `knowledge_sources` and `knowledge_chunks` tables (local Supabase or mocks only for agents).
3. SCORA: ingest script with unit tests (chunking, citation mapping; embedding call mocked).
4. SCORA: retrieval step in the read pipeline behind a feature flag, with the pattern library as fallback.
5. Dogfood on Evan's own data with a starter library; compare against pattern-only reads.
