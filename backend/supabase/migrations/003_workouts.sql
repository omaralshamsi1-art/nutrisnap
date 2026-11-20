-- Workouts / activity type from WHOOP, Apple Health (iOS app) or other sources
create table if not exists workouts (
  user_id      text not null,
  id           text not null,           -- "<source>:<external id>"
  source       text not null,
  sport        text not null,
  start_at     timestamptz not null,
  end_at       timestamptz not null,
  date         date not null,
  duration_min numeric not null,
  kcal         numeric,
  strain       numeric,
  avg_hr       numeric,
  max_hr       numeric,
  distance_m   numeric,
  zones_min    jsonb,
  updated_at   timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists workouts_user_date on workouts (user_id, date);
alter table workouts enable row level security;
