// Route tests import index.ts, whose dotenv call fills only variables that
// are unset. Blank (not delete) every secret and feature flag first, so a
// local .env can never put a real key back or turn a flag on.

const BLANK = [
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY', 'STRAVA_CLIENT_SECRET',
  'OURA_CLIENT_ID', 'OURA_CLIENT_SECRET', 'APNS_KEY', 'APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_BUNDLE_ID', 'APNS_TEST_HOST',
  'PLAN_ADAPTATIONS', 'PLAN_GENERATION', 'RACE_PREDICTIONS', 'CALORIE_ENGINE', 'ICAL_IMPORT',
  'INLINE_CHARTS', 'KNOWLEDGE_RETRIEVAL', 'ADAPTATION_REASON_LLM',
];

export function blankEnv(): void {
  process.env.SCORA_NO_LISTEN = '1';
  process.env.NODE_ENV = 'test';
  for (const k of BLANK) process.env[k] = '';
}
