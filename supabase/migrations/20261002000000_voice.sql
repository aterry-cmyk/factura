
-- Voice: the owner's country sets the Spanish the app listens for and speaks in. Idempotent.
alter table settings add column if not exists country text not null default 'US';
alter table settings add column if not exists voice_on boolean not null default true;
