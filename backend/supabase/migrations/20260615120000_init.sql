-- Wisopen initial schema (spec §6.1). All user tables are RLS-scoped to auth.uid().

-- ---------- tables ----------
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  plan          text not null default 'beta',
  ui_language   text not null default 'en',
  settings      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create table public.snippets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  trigger     text not null,
  expansion   text not null,
  enabled     boolean not null default true,
  match_mode  text not null default 'phrase' check (match_mode in ('phrase','exact','regex')),
  created_at  timestamptz not null default now(),
  unique (user_id, trigger)
);

create table public.dictionary_terms (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  term        text not null,
  sounds_like text[] not null default '{}',
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (user_id, term)
);

create table public.modes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) on delete cascade,  -- null = system mode
  name            text not null,
  description     text,
  prompt_template text not null,
  is_system       boolean not null default false,
  is_default      boolean not null default false,
  created_at      timestamptz not null default now()
);

create table public.dictations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  raw_transcript  text not null,
  final_text      text not null,
  mode_id         uuid references public.modes(id) on delete set null,
  app_context     text,
  lang            text,
  audio_seconds   numeric(10,2),
  tokens_in       integer,
  tokens_out      integer,
  created_at      timestamptz not null default now()
);

create table public.usage_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null check (kind in ('stt','llm')),
  provider      text not null,
  model         text,
  audio_seconds numeric(10,2),
  tokens_in     integer,
  tokens_out    integer,
  cost_estimate numeric(12,6),
  created_at    timestamptz not null default now()
);

create table public.devices (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  platform    text not null check (platform in ('mac','win')),
  app_version text,
  last_seen   timestamptz not null default now()
);

create index on public.snippets (user_id);
create index on public.dictionary_terms (user_id);
create index on public.dictations (user_id, created_at desc);
create index on public.usage_events (user_id, created_at desc);

-- ---------- RLS ----------
alter table public.profiles          enable row level security;
alter table public.snippets          enable row level security;
alter table public.dictionary_terms  enable row level security;
alter table public.modes             enable row level security;
alter table public.dictations        enable row level security;
alter table public.usage_events      enable row level security;
alter table public.devices           enable row level security;

-- profiles: read/update own (insert done by trigger, security definer)
create policy "profiles_select_own" on public.profiles for select
  using ( (select auth.uid()) = id );
create policy "profiles_update_own" on public.profiles for update
  using ( (select auth.uid()) = id ) with check ( (select auth.uid()) = id );

-- generic owner-scoped CRUD macro, applied per table
create policy "snippets_all_own" on public.snippets for all
  using ( (select auth.uid()) = user_id ) with check ( (select auth.uid()) = user_id );

create policy "dict_all_own" on public.dictionary_terms for all
  using ( (select auth.uid()) = user_id ) with check ( (select auth.uid()) = user_id );

create policy "dictations_all_own" on public.dictations for all
  using ( (select auth.uid()) = user_id ) with check ( (select auth.uid()) = user_id );

create policy "usage_select_own" on public.usage_events for select
  using ( (select auth.uid()) = user_id );
create policy "usage_insert_own" on public.usage_events for insert
  with check ( (select auth.uid()) = user_id );

create policy "devices_all_own" on public.devices for all
  using ( (select auth.uid()) = user_id ) with check ( (select auth.uid()) = user_id );

-- modes: everyone reads system modes + their own; can only mutate their own (not system)
create policy "modes_select_visible" on public.modes for select
  using ( is_system or (select auth.uid()) = user_id );
create policy "modes_insert_own" on public.modes for insert
  with check ( (select auth.uid()) = user_id and is_system = false );
create policy "modes_update_own" on public.modes for update
  using ( (select auth.uid()) = user_id and is_system = false )
  with check ( (select auth.uid()) = user_id and is_system = false );
create policy "modes_delete_own" on public.modes for delete
  using ( (select auth.uid()) = user_id and is_system = false );

-- ---------- new-user trigger: seed a profile row ----------
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'display_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
