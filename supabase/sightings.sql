-- Clan sync: shared sightings (loots, locations, waypoints).
-- Run once in the Supabase SQL editor (Dashboard → SQL → New query → Run).

create table if not exists public.sightings (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null,              -- 'loot' | 'location' | 'waypoint'
  name       text not null,              -- item name / place name
  x          double precision,           -- coordinates (nullable for pure loot)
  y          double precision,
  z          double precision,
  value      double precision,           -- PED value (loot)
  pilot      text,                        -- who shared it
  created_at timestamptz not null default now()
);

create index if not exists sightings_created_idx on public.sightings (created_at desc);

-- Row Level Security. Prototype policy: any client holding the anon key may read
-- and insert. HARDEN LATER — tie writes to an authenticated clan identity before
-- this leaves the clan. Reads/inserts are gated only by knowing the anon key.
alter table public.sightings enable row level security;

drop policy if exists "sightings_read" on public.sightings;
create policy "sightings_read" on public.sightings
  for select using (true);

drop policy if exists "sightings_insert" on public.sightings;
create policy "sightings_insert" on public.sightings
  for insert with check (true);

-- Realtime: stream inserts to every subscribed app.
alter publication supabase_realtime add table public.sightings;
