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

-- Customers accept estimates from their link, and pay invoices online through Stripe Connect.
-- Idempotent.
alter table documents add column if not exists accepted_at timestamptz;
alter table documents add column if not exists accepted_by text check (accepted_by is null or char_length(accepted_by) <= 120);
alter table documents add column if not exists paid_via text check (paid_via is null or paid_via in ('manual','online'));
alter table documents add column if not exists paid_amount_cents bigint;
alter table documents add column if not exists stripe_session_id text;
alter table documents add column if not exists stripe_payment_intent text;

-- Each business connects its own Stripe account (Express); money goes to them, Loro keeps a fee.
alter table settings add column if not exists stripe_account_id text;
alter table settings add column if not exists stripe_charges_enabled boolean not null default false;
alter table settings add column if not exists stripe_details_submitted boolean not null default false;

-- Online payments count as usage, with the amount and Loro's fee, for the admin's view.
alter table usage_events add column if not exists amount_cents bigint not null default 0;
alter table usage_events add column if not exists fee_cents bigint not null default 0;
alter table usage_events drop constraint if exists usage_events_kind_check;
alter table usage_events add constraint usage_events_kind_check
  check (kind in ('ai_request','document','voice_chars','email','sms','payment'));

-- Stripe can send the same event more than once; each is handled once.
create table if not exists stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);
alter table stripe_events enable row level security;

-- Projects: the job between the estimate and the invoices. A project belongs to a customer, is
-- paid in milestones (each one becomes an invoice when its work is marked done), and carries a
-- checklist whose photos the customer sees on their progress link. Idempotent.

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  customer jsonb not null default '{}',
  name text not null check (char_length(name) between 1 and 160),
  description text not null default '' check (char_length(description) <= 4000),
  status text not null default 'active' check (status in ('active','done','cancelled')),
  total_cents bigint not null check (total_cents >= 0 and total_cents <= 100000000000),
  lang text not null default 'es' check (lang in ('es','en')),
  estimate_id uuid references documents(id) on delete set null,
  public_token text not null unique,
  plan_source text not null default 'template' check (plan_source in ('ai','template','owner')),
  ai_model text,
  prompt_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_account_idx on projects (account_id, created_at desc);

create table if not exists milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  position int not null check (position between 0 and 99),
  name text not null check (char_length(name) between 1 and 160),
  amount_cents bigint not null check (amount_cents >= 0),
  status text not null default 'pending' check (status in ('pending','invoiced','paid')),
  invoice_id uuid references documents(id) on delete set null,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, position)
);
create index if not exists milestones_invoice_idx on milestones (invoice_id);

create table if not exists checklist_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  milestone_id uuid references milestones(id) on delete set null,
  account_id uuid not null references accounts(id) on delete cascade,
  position int not null check (position between 0 and 999),
  text text not null check (char_length(text) between 1 and 200),
  done_at timestamptz,
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists checklist_project_idx on checklist_items (project_id, position);

-- Progress photos: the owner's own pictures, stored as the shrunk JPEG the browser sends.
create table if not exists project_photos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  item_id uuid references checklist_items(id) on delete set null,
  account_id uuid not null references accounts(id) on delete cascade,
  data bytea not null,
  type text not null check (type in ('image/jpeg','image/png','image/webp')),
  bytes int not null check (bytes between 1 and 2500000),
  created_at timestamptz not null default now()
);
create index if not exists project_photos_project_idx on project_photos (project_id, created_at desc);

create table if not exists project_events (
  id bigserial primary key,
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists project_events_idx on project_events (project_id, created_at desc);

alter table projects enable row level security;
alter table milestones enable row level security;
alter table checklist_items enable row level security;
alter table project_photos enable row level security;
alter table project_events enable row level security;

-- The P&L side of a project: what was spent (by cost code), the budget per code, the crew with its
-- wages and burden, and the prices looked up online. Idempotent.

create table if not exists workers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  role text not null default 'other' check (role in ('foreman','journeyman','laborer','other')),
  hourly_cents int not null default 0 check (hourly_cents between 0 and 100000),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists workers_account_idx on workers (account_id, active, lower(name));

-- The owner's own burden on wages, in percent: workers' comp, liability, payroll taxes.
alter table settings add column if not exists labor_burden jsonb not null default '{"workersComp":0,"liability":0,"payrollTax":0}';

create table if not exists project_budgets (
  project_id uuid not null references projects(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  code text not null check (code in ('labor','materials','subs','other')),
  estimated_cents bigint not null default 0 check (estimated_cents >= 0),
  primary key (project_id, code)
);

create table if not exists project_costs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  code text not null check (code in ('labor','materials','subs','other')),
  amount_cents bigint not null check (amount_cents >= 0 and amount_cents <= 100000000000),
  description text not null default '' check (char_length(description) <= 300),
  vendor text not null default '' check (char_length(vendor) <= 120),
  spent_on date not null,
  source text not null default 'typed' check (source in ('typed','voice','receipt')),
  receipt_photo_id uuid references project_photos(id) on delete set null,
  worker_id uuid references workers(id) on delete set null,
  hours numeric(7,2) check (hours is null or (hours >= 0 and hours <= 1000)),
  created_at timestamptz not null default now()
);
create index if not exists project_costs_project_idx on project_costs (project_id, spent_on desc);
create index if not exists project_costs_account_idx on project_costs (account_id, spent_on desc);

-- Prices looked up online, with where each one was found and when.
create table if not exists price_lookups (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  query text not null check (char_length(query) between 1 and 200),
  results jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index if not exists price_lookups_account_idx on price_lookups (account_id, created_at desc);

alter table workers enable row level security;
alter table project_budgets enable row level security;
alter table project_costs enable row level security;
alter table price_lookups enable row level security;

-- The control center: clients with an address and notes, a project's schedule (start date, days
-- and dates per milestone), the proposal Loro builds with the owner, and the owner's markup
-- and contingency rules. Idempotent.

alter table customers add column if not exists address text not null default '' check (char_length(address) <= 300);
alter table customers add column if not exists notes text not null default '' check (char_length(notes) <= 2000);

alter table projects add column if not exists starts_on date;
alter table projects add column if not exists proposal jsonb;
alter table milestones add column if not exists days int check (days is null or (days between 1 and 365));
alter table milestones add column if not exists starts_on date;
alter table milestones add column if not exists ends_on date;

alter table settings add column if not exists markup_percent numeric(6,2) not null default 0 check (markup_percent >= 0 and markup_percent <= 300);
alter table settings add column if not exists contingency_percent numeric(6,2) not null default 0 check (contingency_percent >= 0 and contingency_percent <= 100);
