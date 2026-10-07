-- Factura: one owner, one database. Idempotent: safe to run again.
create extension if not exists pgcrypto;

create table if not exists settings (
  id int primary key default 1 check (id = 1),
  business_name text not null default '',
  owner_name text not null default '',
  address text not null default '',
  phone text not null default '',
  email text not null default '',
  website text not null default '',
  logo bytea,
  logo_type text,
  lang text not null default 'es' check (lang in ('es','en')),
  state text not null default '',
  tax_enabled boolean not null default false,
  tax_rate numeric(6,3) not null default 0 check (tax_rate >= 0 and tax_rate <= 30),
  due_days int not null default 15 check (due_days between 0 and 120),
  reminder_days int not null default 7 check (reminder_days in (0,3,7,14,30)),
  late_fee jsonb not null default '{"type":"none"}',
  payment_methods jsonb not null default '{}',
  next_invoice_no int not null default 1,
  next_estimate_no int not null default 1,
  onboarded boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into settings (id) values (1) on conflict (id) do nothing;

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text not null default '',
  email text not null default '',
  phone text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists customers_name_idx on customers (lower(name));

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('invoice','estimate')),
  number text not null unique,
  status text not null default 'draft' check (status in ('draft','sent','paid','void','accepted')),
  customer_id uuid references customers(id) on delete set null,
  customer jsonb not null,
  business jsonb not null,
  lang text not null default 'es' check (lang in ('es','en')),
  items jsonb not null,
  state text not null default '',
  tax_rate numeric(6,3) not null default 0,
  subtotal_cents bigint not null,
  tax_cents bigint not null,
  total_cents bigint not null,
  issue_date date not null,
  due_date date not null,
  reminder_days int not null default 0,
  late_fee jsonb not null default '{"type":"none"}',
  payment_methods jsonb not null default '{}',
  notes text not null default '',
  transcript text not null default '',
  ai_model text,
  prompt_version text,
  public_token text not null unique,
  sent_at timestamptz,
  paid_at timestamptz,
  last_reminder_at timestamptz,
  reminder_count int not null default 0,
  converted_from uuid references documents(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists documents_created_idx on documents (created_at desc);
create index if not exists documents_status_idx on documents (status, kind);

create table if not exists events (
  id bigserial primary key,
  document_id uuid references documents(id) on delete cascade,
  kind text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists events_doc_idx on events (document_id, created_at desc);

-- Supabase exposes tables through its REST API; this app only talks to Postgres directly from
-- the server, so lock the REST side out completely: RLS on, no policies.
alter table settings enable row level security;
alter table customers enable row level security;
alter table documents enable row level security;
alter table events enable row level security;

-- Voice: the owner's country sets the Spanish the app listens for and speaks in. Idempotent.
alter table settings add column if not exists country text not null default 'US';
alter table settings add column if not exists voice_on boolean not null default true;

-- Azure voices come as a woman's and a man's for each country; the owner picks one. Idempotent.
alter table settings add column if not exists voice_gender text not null default 'female';
alter table settings drop constraint if exists settings_voice_gender_check;
alter table settings add constraint settings_voice_gender_check check (voice_gender in ('female','male'));

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
