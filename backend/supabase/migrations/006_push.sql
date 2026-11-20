-- Phase 2c: Web Push subscriptions for smart reminders
create table if not exists push_subs (
  endpoint   text primary key,
  user_id    text not null,
  keys       jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subs_user on push_subs (user_id);
alter table push_subs enable row level security;
