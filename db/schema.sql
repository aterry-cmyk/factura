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

-- Loro AI accounts: every business is an account with its own settings, customers and documents.
-- People sign in with an email and a password (scrypt hash). The data that existed before this
-- migration becomes one account with no owner yet; the original owner claims it once with the old
-- OWNER_PASSWORD (app/claim) and becomes the platform admin. Idempotent.

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null default '' check (char_length(name) <= 120),
  plan text not null default 'trial' check (plan in ('trial','pro','comped')),
  status text not null default 'active' check (status in ('active','suspended')),
  trial_ends_at timestamptz not null default now() + interval '14 days',
  monthly_fee_cents int not null default 0 check (monthly_fee_cents between 0 and 10000000),
  billing_email text not null default '' check (char_length(billing_email) <= 254),
  billing_notes text not null default '' check (char_length(billing_notes) <= 2000),
  created_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email) and char_length(email) between 3 and 254),
  name text not null default '' check (char_length(name) <= 120),
  password_hash text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists memberships (
  account_id uuid not null references accounts(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','member')),
  created_at timestamptz not null default now(),
  primary key (account_id, user_id)
);
create index if not exists memberships_user_idx on memberships (user_id);

-- The cookie holds a random token; only its SHA-256 is stored.
create table if not exists sessions (
  id text primary key,
  user_id uuid not null references users(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now()
);
create index if not exists sessions_user_idx on sessions (user_id);

-- One-time links: password resets (made by an admin until email is connected) and invitations.
create table if not exists auth_tokens (
  id text primary key,
  purpose text not null check (purpose in ('reset','invite')),
  user_id uuid references users(id) on delete cascade,
  email text not null default '',
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

-- Failed sign-ins and sign-ups, to slow down guessing.
create table if not exists auth_attempts (
  id bigserial primary key,
  key text not null,
  created_at timestamptz not null default now()
);
create index if not exists auth_attempts_key_idx on auth_attempts (key, created_at desc);

-- What each account used, for plans and for the admin's billing view.
create table if not exists usage_events (
  id bigserial primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  kind text not null check (kind in ('ai_request','document','voice_chars','email','sms')),
  quantity int not null default 1 check (quantity >= 0),
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists usage_events_account_idx on usage_events (account_id, created_at desc);

-- Platform switches the admin changes from the app.
create table if not exists platform (
  id int primary key default 1 check (id = 1),
  signups_open boolean not null default false
);
insert into platform (id) values (1) on conflict (id) do nothing;

-- Settings: one row per account instead of the single row with id 1.
alter table settings add column if not exists account_id uuid references accounts(id) on delete cascade;
alter table settings drop constraint if exists settings_id_check;
create sequence if not exists settings_id_seq owned by settings.id;
select setval('settings_id_seq', greatest((select coalesce(max(id), 1) from settings), 1));
alter table settings alter column id set default nextval('settings_id_seq');
alter table settings add column if not exists trade text not null default '' check (char_length(trade) <= 60);

alter table customers add column if not exists account_id uuid references accounts(id) on delete cascade;
alter table documents add column if not exists account_id uuid references accounts(id) on delete cascade;

-- Everything that existed before becomes one unclaimed account.
do $$
declare acct uuid;
begin
  if exists (select 1 from settings where account_id is null)
     or exists (select 1 from documents where account_id is null)
     or exists (select 1 from customers where account_id is null) then
    insert into accounts (name, plan)
      select coalesce(nullif((select business_name from settings order by id limit 1), ''), 'Mi negocio'), 'comped'
      returning id into acct;
    update settings set account_id = acct where account_id is null;
    update customers set account_id = acct where account_id is null;
    update documents set account_id = acct where account_id is null;
  end if;
end $$;

-- settings.account_id stays nullable: the first migration re-inserts row 1 when the schema is
-- re-applied (tests do that), and Postgres checks NOT NULL before ON CONFLICT. The app always sets it.
alter table customers alter column account_id set not null;
alter table documents alter column account_id set not null;
create unique index if not exists settings_account_idx on settings (account_id);
create index if not exists customers_account_idx on customers (account_id, lower(name));
create index if not exists documents_account_idx on documents (account_id, created_at desc);

-- Numbers are unique inside an account; two businesses both have an F-0001.
alter table documents drop constraint if exists documents_number_key;
create unique index if not exists documents_account_number_idx on documents (account_id, number);

alter table accounts enable row level security;
alter table users enable row level security;
alter table memberships enable row level security;
alter table sessions enable row level security;
alter table auth_tokens enable row level security;
alter table auth_attempts enable row level security;
alter table usage_events enable row level security;
alter table platform enable row level security;
