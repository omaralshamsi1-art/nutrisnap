-- StrainEat schema (Supabase / Postgres 15+)
create extension if not exists pg_trgm;

create table if not exists meals (
  id          uuid primary key,
  user_id     text not null,
  eaten_at    timestamptz not null,
  date        date not null,
  status      text not null check (status in ('draft','confirmed')),
  estimate    jsonb not null,
  final       jsonb not null,
  edited      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists meals_user_date on meals (user_id, date);

-- The agent's "experience": user-confirmed meals (user_id set) and verified published meals (user_id null)
create table if not exists known_meals (
  key           text not null,          -- normalized "restaurant|meal name"
  user_id       text,                   -- null = global
  restaurant    text,
  meal_name     text not null,
  meal_name_ar  text not null,
  source        text not null,
  items         jsonb not null,
  totals        jsonb not null,
  sources       jsonb not null default '[]',
  times_logged  int not null default 1,
  updated_at    timestamptz not null default now()
);
create unique index if not exists known_meals_owner_key on known_meals (coalesce(user_id, '*'), key);
create index if not exists known_meals_key_trgm on known_meals using gin (key gin_trgm_ops);

create table if not exists energy_days (
  user_id     text not null,
  date        date not null,
  source      text not null,
  active_kcal numeric,
  basal_kcal  numeric,
  total_kcal  numeric not null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, date, source)
);

create table if not exists profiles (
  user_id    text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists oauth_tokens (
  user_id       text not null,
  provider      text not null,
  access_token  text not null,
  refresh_token text,
  expires_at    timestamptz not null,
  scope         text not null default '',
  primary key (user_id, provider)
);

-- The backend connects with the service role; block direct client access.
alter table meals        enable row level security;
alter table known_meals  enable row level security;
alter table energy_days  enable row level security;
alter table profiles     enable row level security;
alter table oauth_tokens enable row level security;
