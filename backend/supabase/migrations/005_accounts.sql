-- Phase 2c: user accounts (email + password) and invite codes
create table if not exists users (
  id            text primary key,
  email         text not null unique,
  name          text not null,
  password_hash text not null,
  role          text not null check (role in ('owner','user')),
  created_at    timestamptz not null default now()
);
create table if not exists invites (
  code       text primary key,
  created_by text not null,
  used_by    text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table users   enable row level security;
alter table invites enable row level security;
