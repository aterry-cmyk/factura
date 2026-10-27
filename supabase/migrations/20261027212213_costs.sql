
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
