-- =========================================================
-- 0001_init.sql — extensions, schema, indexes, RLS
-- =========================================================
create extension if not exists pgcrypto with schema extensions;

-- ---------- TABLES ----------
create table public.rooms (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  name              text not null,
  play_mode         text not null default 'order' check (play_mode in ('order','shuffle')),
  admin_member_id   uuid,
  dj_member_id      uuid,
  current_item_id   uuid,
  is_playing        boolean not null default false,
  started_at        timestamptz,
  paused_elapsed_ms integer not null default 0,
  created_at        timestamptz not null default now()
);

create table public.room_secrets (
  room_id       uuid primary key references public.rooms(id) on delete cascade,
  password_hash text not null
);

create table public.members (
  id        uuid primary key default gen_random_uuid(),
  room_id   uuid not null references public.rooms(id) on delete cascade,
  name      text not null,
  joined_at timestamptz not null default now()
);

-- Token hashes are isolated like room_secrets: never selectable, never in realtime.
create table public.member_secrets (
  member_id  uuid primary key references public.members(id) on delete cascade,
  token_hash text not null
);

create table public.queue_items (
  id                 uuid primary key default gen_random_uuid(),
  room_id            uuid not null references public.rooms(id) on delete cascade,
  youtube_video_id   text not null,
  title              text not null,
  thumbnail_url      text,
  duration_seconds   integer,
  added_by_member_id uuid references public.members(id) on delete set null,
  added_by_name      text not null,
  position           double precision not null,
  created_at         timestamptz not null default now()
);

create table public.play_history (
  id               uuid primary key default gen_random_uuid(),
  room_id          uuid not null references public.rooms(id) on delete cascade,
  youtube_video_id text not null,
  title            text not null,
  added_by_name    text,
  played_at        timestamptz not null default now()
);

-- Pointer FKs on rooms (now that members/queue_items exist).
alter table public.rooms
  add constraint rooms_admin_member_fk foreign key (admin_member_id) references public.members(id) on delete set null,
  add constraint rooms_dj_member_fk    foreign key (dj_member_id)    references public.members(id) on delete set null,
  add constraint rooms_current_item_fk foreign key (current_item_id) references public.queue_items(id) on delete set null;

-- ---------- INDEXES ----------
create index idx_queue_items_room_position on public.queue_items (room_id, position);
create index idx_members_room              on public.members (room_id);
create index idx_play_history_room_played  on public.play_history (room_id, played_at desc);

-- ---------- ROW LEVEL SECURITY ----------
alter table public.rooms          enable row level security;
alter table public.room_secrets   enable row level security;
alter table public.members        enable row level security;
alter table public.member_secrets enable row level security;
alter table public.queue_items    enable row level security;
alter table public.play_history   enable row level security;

-- Public, per-room, non-sensitive data: anon may SELECT (needed for Realtime).
create policy rooms_select        on public.rooms        for select to anon using (true);
create policy members_select      on public.members      for select to anon using (true);
create policy queue_items_select  on public.queue_items  for select to anon using (true);
create policy play_history_select on public.play_history for select to anon using (true);

-- room_secrets & member_secrets: RLS enabled, NO policies -> never readable by clients.
-- No INSERT/UPDATE/DELETE policies anywhere -> all direct writes denied; writes go via RPCs.
