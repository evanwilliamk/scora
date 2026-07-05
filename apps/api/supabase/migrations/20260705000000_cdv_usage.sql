-- Per-day CDV (chat-driven viz) usage counter for free-tier rate limiting.
-- Free tier gets 3 queries/day (CLAUDE.md §5.1). Reset is by calendar day:
-- when cdv_count_date != today, the count is treated as 0.
alter table athletes
  add column if not exists cdv_count int not null default 0,
  add column if not exists cdv_count_date date;
