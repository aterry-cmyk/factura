
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
