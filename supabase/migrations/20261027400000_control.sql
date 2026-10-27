
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
