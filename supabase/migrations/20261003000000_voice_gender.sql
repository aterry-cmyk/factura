
-- Azure voices come as a woman's and a man's for each country; the owner picks one. Idempotent.
alter table settings add column if not exists voice_gender text not null default 'female';
alter table settings drop constraint if exists settings_voice_gender_check;
alter table settings add constraint settings_voice_gender_check check (voice_gender in ('female','male'));
