-- ============================================================================
-- TeamHue — Supabase schema
-- Run this once in the Supabase SQL Editor (Dashboard → SQL → New query).
-- Safe to re-run: everything is idempotent.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) between 1 and 60),
  join_code   text not null unique,
  created_by  uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.members (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 60),
  color        text not null default '#6366f1' check (color ~* '^#[0-9a-f]{6}$'),
  role         text not null default 'member' check (role in ('owner','admin','member')),
  created_at   timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index if not exists members_workspace_idx on public.members (workspace_id);
create index if not exists members_user_idx      on public.members (user_id);

create table if not exists public.assignments (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  platform     text not null check (platform in ('instagram','googlevoice','gmail','outlook')),
  -- Stable, non-sensitive identifier produced by the content-script adapters.
  thread_key   text not null check (char_length(thread_key) between 1 and 300),
  -- Display label only (a name or handle). NEVER message content.
  thread_label text check (char_length(thread_label) <= 200),
  color        text not null check (color ~* '^#[0-9a-f]{6}$'),
  note         text check (char_length(note) <= 500),
  member_id    uuid references public.members (id) on delete set null,
  updated_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (workspace_id, platform, thread_key)
);

create index if not exists assignments_workspace_idx on public.assignments (workspace_id);
create index if not exists assignments_lookup_idx
  on public.assignments (workspace_id, platform, thread_key);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists assignments_touch on public.assignments;
create trigger assignments_touch
  before update on public.assignments
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER to avoid RLS recursion on `members`)
-- ---------------------------------------------------------------------------

create or replace function public.is_workspace_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members m
    where m.workspace_id = ws and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_workspace_admin(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members m
    where m.workspace_id = ws
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  );
$$;

-- ---------------------------------------------------------------------------
-- RPC: create a workspace and enroll the caller as owner (atomic)
-- ---------------------------------------------------------------------------

create or replace function public.create_workspace(
  p_name text,
  p_display_name text,
  p_color text default '#6366f1'
)
returns public.workspaces
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws   public.workspaces;
  v_code text;
  v_try  int := 0;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  loop
    v_try := v_try + 1;
    v_code := upper(
      (array['BRIGHT','SWIFT','CALM','BOLD','CLEAR','WARM','KEEN','LUCID'])[floor(random()*8+1)]
      || '-' ||
      (array['OTTER','FALCON','CEDAR','RIVER','EMBER','ORBIT','MAPLE','DELTA'])[floor(random()*8+1)]
      || '-' || lpad(floor(random()*90+10)::text, 2, '0')
    );
    exit when not exists (select 1 from public.workspaces w where w.join_code = v_code);
    if v_try > 25 then
      v_code := v_code || '-' || substr(gen_random_uuid()::text, 1, 4);
      exit;
    end if;
  end loop;

  insert into public.workspaces (name, join_code, created_by)
  values (trim(p_name), v_code, auth.uid())
  returning * into v_ws;

  insert into public.members (workspace_id, user_id, display_name, color, role)
  values (v_ws.id, auth.uid(), trim(p_display_name), lower(p_color), 'owner');

  return v_ws;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: join an existing workspace by code
-- ---------------------------------------------------------------------------

create or replace function public.join_workspace(
  p_join_code text,
  p_display_name text,
  p_color text default null
)
returns public.workspaces
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws     public.workspaces;
  v_color  text;
  v_used   text[];
  v_pal    text[] := array[
    '#ff6b6b','#f59e0b','#10b981','#14b8a6','#0ea5e9',
    '#6366f1','#8b5cf6','#d946ef','#f43f5e','#64748b'
  ];
  c text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_ws
  from public.workspaces
  where upper(join_code) = upper(trim(p_join_code));

  if v_ws.id is null then
    raise exception 'No workspace found for that join code';
  end if;

  -- Already a member? Just return it (idempotent join).
  if exists (select 1 from public.members m
             where m.workspace_id = v_ws.id and m.user_id = auth.uid()) then
    return v_ws;
  end if;

  -- Auto-pick a color nobody on the team is using yet.
  v_color := lower(coalesce(p_color, ''));
  if v_color !~* '^#[0-9a-f]{6}$' then
    select array_agg(lower(m.color)) into v_used
    from public.members m where m.workspace_id = v_ws.id;
    v_used := coalesce(v_used, array[]::text[]);
    v_color := null;
    foreach c in array v_pal loop
      if not (c = any (v_used)) then
        v_color := c;
        exit;
      end if;
    end loop;
    v_color := coalesce(v_color, v_pal[floor(random()*array_length(v_pal,1)+1)]);
  end if;

  insert into public.members (workspace_id, user_id, display_name, color, role)
  values (v_ws.id, auth.uid(), trim(p_display_name), v_color, 'member');

  return v_ws;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.workspaces  enable row level security;
alter table public.members     enable row level security;
alter table public.assignments enable row level security;

-- workspaces -----------------------------------------------------------------
drop policy if exists "ws_select" on public.workspaces;
create policy "ws_select" on public.workspaces
  for select using (public.is_workspace_member(id));

drop policy if exists "ws_update" on public.workspaces;
create policy "ws_update" on public.workspaces
  for update using (public.is_workspace_admin(id))
  with check (public.is_workspace_admin(id));

drop policy if exists "ws_delete" on public.workspaces;
create policy "ws_delete" on public.workspaces
  for delete using (
    exists (select 1 from public.members m
            where m.workspace_id = id and m.user_id = auth.uid() and m.role = 'owner')
  );

-- members --------------------------------------------------------------------
drop policy if exists "m_select" on public.members;
create policy "m_select" on public.members
  for select using (public.is_workspace_member(workspace_id));

-- A user may edit their own profile; admins may edit anyone on the team.
drop policy if exists "m_update" on public.members;
create policy "m_update" on public.members
  for update using (
    user_id = auth.uid() or public.is_workspace_admin(workspace_id)
  ) with check (
    user_id = auth.uid() or public.is_workspace_admin(workspace_id)
  );

-- Leaving the team (self) or admin removal.
drop policy if exists "m_delete" on public.members;
create policy "m_delete" on public.members
  for delete using (
    user_id = auth.uid() or public.is_workspace_admin(workspace_id)
  );

-- assignments ----------------------------------------------------------------
drop policy if exists "a_select" on public.assignments;
create policy "a_select" on public.assignments
  for select using (public.is_workspace_member(workspace_id));

drop policy if exists "a_insert" on public.assignments;
create policy "a_insert" on public.assignments
  for insert with check (
    public.is_workspace_member(workspace_id) and updated_by = auth.uid()
  );

drop policy if exists "a_update" on public.assignments;
create policy "a_update" on public.assignments
  for update using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists "a_delete" on public.assignments;
create policy "a_delete" on public.assignments
  for delete using (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

alter table public.assignments replica identity full;
alter table public.members     replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'assignments'
  ) then
    alter publication supabase_realtime add table public.assignments;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'members'
  ) then
    alter publication supabase_realtime add table public.members;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.workspaces, public.members, public.assignments to authenticated;
grant execute on function public.create_workspace(text, text, text) to authenticated;
grant execute on function public.join_workspace(text, text, text)   to authenticated;
grant execute on function public.is_workspace_member(uuid)          to authenticated;
grant execute on function public.is_workspace_admin(uuid)           to authenticated;
