-- Row level security on every table (doc 10 §6.5, "RLS enforced"). The
-- init tables never had it, so with Supabase's public anon key the REST API
-- could read athletes (OAuth tokens), device_tokens and health rows. The API
-- uses the service role key everywhere, which bypasses RLS, so turning it on
-- with no policies changes nothing for the app and closes the anon path.
alter table users enable row level security;
alter table athletes enable row level security;
alter table activities enable row level security;
alter table workouts enable row level security;
alter table health_data enable row level security;
alter table device_tokens enable row level security;
