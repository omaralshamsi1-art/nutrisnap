-- Phase 2b: cached AI coach outputs (suggestions, weekly reports) to save tokens / free-tier quota
create table if not exists coach_cache (
  user_id    text not null,
  key        text not null,
  payload    jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table coach_cache enable row level security;
