// Admin-only: ingest a FieldCopy JSON export into the knowledge library.
//
//   npx tsx scripts/ingest-knowledge.ts <export.json> --dry-run
//   npx tsx scripts/ingest-knowledge.ts <export.json>
//   npx tsx scripts/ingest-knowledge.ts <export.json> --sync   (export is the whole library: delete entries not in it)
//
// --dry-run parses and chunks only: no OpenAI call, no database write. A real
// run embeds with OpenAI (costs money, approved scale in spec §4) and writes to
// the Supabase project in SUPABASE_URL. Evan runs it; agents only dry-run.

import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { parseExport, planIngest, ingest, openAiEmbedder, supabaseStore } from '../src/knowledge-ingest';

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const dryRun = args.includes('--dry-run');
  const sync = args.includes('--sync');
  if (!file) {
    console.error('Usage: ingest-knowledge.ts <export.json> [--dry-run] [--sync]');
    process.exit(2);
  }

  const entries = parseExport(JSON.parse(readFileSync(file, 'utf8')));
  if (sync && entries.length === 0) {
    console.error('Refusing --sync with an empty export: it would delete the whole library');
    process.exit(2);
  }
  const plan = planIngest(entries);
  const chars = plan.chunks.reduce((s, c) => s + c.embedText.length, 0);
  console.log(`${entries.length} entries, ${plan.sources.length} sources, ${plan.chunks.length} chunks, ~${Math.round(chars / 4)} tokens to embed`);
  for (const s of plan.sources) console.log(`  source: ${s.title}${s.author ? ` (${s.author})` : ''}`);
  if (dryRun) return;

  dotenv.config();
  const { OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!OPENAI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Needs OPENAI_API_KEY, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(2);
  }
  const result = await ingest(entries, {
    embed: openAiEmbedder(OPENAI_API_KEY),
    store: supabaseStore(createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)),
    sync,
  });
  console.log(`Ingested ${result.chunks} chunks from ${result.sources} sources in ${result.embedCalls} embedding calls`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
