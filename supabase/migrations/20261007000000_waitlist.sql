
-- Waitlist from the public website (loro-ai). Written only by the site's server function with the
-- service key; RLS is on with no policies, so the public API keys can't read or write it.
create table if not exists waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (char_length(email) between 3 and 254),
  name text check (name is null or char_length(name) <= 120),
  trade text check (trade is null or char_length(trade) <= 60),
  lang text not null default 'es' check (lang in ('es','en')),
  created_at timestamptz not null default now()
);
alter table waitlist enable row level security;
