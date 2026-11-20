-- Phase 2a: body-weight log (one value per day per source)
create table if not exists weights (
  user_id    text not null,
  date       date not null,
  source     text not null check (source in ('manual','apple_health','whoop')),
  kg         numeric(5,2) not null check (kg > 20 and kg < 400),
  updated_at timestamptz not null default now(),
  primary key (user_id, date, source)
);
alter table weights enable row level security;
