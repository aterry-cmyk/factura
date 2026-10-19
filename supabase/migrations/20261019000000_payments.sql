
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
