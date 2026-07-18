-- Clan live locations: one upserted row per pilot (live presence).
-- Run once in the Supabase SQL editor.

create table if not exists public.locations (
  pilot_id   text primary key,        -- Discord user id (stable per pilot)
  pilot      text,                     -- display name
  x          double precision not null,
  y          double precision not null,
  z          double precision not null,
  updated_at timestamptz not null default now()
);

alter table public.locations enable row level security;

-- Prototype policies: any anon-key client may read + upsert its row.
-- HARDEN LATER — restrict writes to the authenticated pilot's own id.
drop policy if exists "locations_read" on public.locations;
create policy "locations_read" on public.locations for select using (true);

drop policy if exists "locations_insert" on public.locations;
create policy "locations_insert" on public.locations for insert with check (true);

drop policy if exists "locations_update" on public.locations;
create policy "locations_update" on public.locations for update using (true) with check (true);

-- Realtime: stream position changes to subscribed apps (map presence, etc.).
alter publication supabase_realtime add table public.locations;
