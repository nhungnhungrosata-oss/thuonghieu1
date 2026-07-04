create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  plan text not null default 'trial' check (plan in ('trial', 'starter', 'pro', 'business')),
  credits integer not null default 12 check (credits >= 0),
  hourly_scene_limit integer not null default 12 check (hourly_scene_limit > 0),
  max_active_scenes integer not null default 2 check (max_active_scenes > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.saas_settings (
  singleton boolean primary key default true check (singleton),
  global_active_limit integer not null default 40 check (global_active_limit > 0),
  scene_credit_cost integer not null default 1 check (scene_credit_cost > 0),
  updated_at timestamptz not null default now()
);

insert into public.saas_settings (singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists public.generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null,
  kind text not null default 'video_scene' check (kind in ('video_scene')),
  prompt text not null,
  model text not null,
  status text not null default 'reserved' check (status in ('reserved', 'submitted', 'processing', 'succeeded', 'failed', 'cancelled')),
  provider_status text,
  provider_job_id text unique,
  provider_asset_id text,
  output_url text,
  error_message text,
  cost_credits integer not null default 1 check (cost_credits > 0),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create index if not exists generations_user_created_idx
  on public.generations (user_id, created_at desc);
create index if not exists generations_active_idx
  on public.generations (status, updated_at desc)
  where status in ('reserved', 'submitted', 'processing');

alter table public.profiles enable row level security;
alter table public.generations enable row level security;
alter table public.saas_settings enable row level security;

drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

drop policy if exists "Users read own generations" on public.generations;
create policy "Users read own generations"
  on public.generations for select
  to authenticated
  using (user_id = auth.uid());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of email on auth.users
for each row execute procedure public.handle_new_user();

insert into public.profiles (id, email)
select id, coalesce(email, '') from auth.users
on conflict (id) do update set email = excluded.email, updated_at = now();

create or replace function public.reserve_video_generation(
  p_idempotency_key text,
  p_prompt text,
  p_model text,
  p_cost_credits integer default 1
)
returns table (
  generation_id uuid,
  allowed boolean,
  reused boolean,
  reason text,
  provider_job_id text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_existing public.generations%rowtype;
  v_generation_id uuid;
  v_global_limit integer;
  v_global_active integer;
  v_user_active integer;
  v_hourly_count integer;
begin
  if v_user_id is null then
    raise exception 'authentication_required';
  end if;

  if length(coalesce(p_idempotency_key, '')) < 32 then
    raise exception 'invalid_idempotency_key';
  end if;

  select * into v_existing
  from public.generations
  where user_id = v_user_id and idempotency_key = p_idempotency_key
  limit 1;

  if found then
    return query select v_existing.id, true, true, 'reused', coalesce(v_existing.provider_job_id, '');
    return;
  end if;

  select global_active_limit into v_global_limit
  from public.saas_settings
  where singleton = true
  for update;

  select * into v_profile
  from public.profiles
  where id = v_user_id
  for update;

  if not found then
    return query select null::uuid, false, false, 'profile_missing', ''::text;
    return;
  end if;

  if v_profile.credits < greatest(p_cost_credits, 1) then
    return query select null::uuid, false, false, 'no_credits', ''::text;
    return;
  end if;

  select count(*) into v_user_active
  from public.generations
  where user_id = v_user_id
    and status in ('reserved', 'submitted', 'processing')
    and updated_at > now() - interval '6 hours';

  if v_user_active >= v_profile.max_active_scenes then
    return query select null::uuid, false, false, 'user_busy', ''::text;
    return;
  end if;

  select count(*) into v_hourly_count
  from public.generations
  where user_id = v_user_id
    and created_at >= now() - interval '1 hour';

  if v_hourly_count >= v_profile.hourly_scene_limit then
    return query select null::uuid, false, false, 'hourly_limit', ''::text;
    return;
  end if;

  select count(*) into v_global_active
  from public.generations
  where status in ('reserved', 'submitted', 'processing')
    and updated_at > now() - interval '6 hours';

  if v_global_active >= coalesce(v_global_limit, 40) then
    return query select null::uuid, false, false, 'system_busy', ''::text;
    return;
  end if;

  update public.profiles
  set credits = credits - greatest(p_cost_credits, 1), updated_at = now()
  where id = v_user_id;

  insert into public.generations (
    user_id,
    idempotency_key,
    prompt,
    model,
    cost_credits,
    status
  ) values (
    v_user_id,
    p_idempotency_key,
    left(p_prompt, 20000),
    left(p_model, 100),
    greatest(p_cost_credits, 1),
    'reserved'
  ) returning id into v_generation_id;

  return query select v_generation_id, true, false, 'reserved', ''::text;
end;
$$;

revoke all on function public.reserve_video_generation(text, text, text, integer) from public;
grant execute on function public.reserve_video_generation(text, text, text, integer) to authenticated;

create or replace function public.fail_and_refund_generation(
  p_generation_id uuid,
  p_error_message text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_generation public.generations%rowtype;
begin
  select * into v_generation
  from public.generations
  where id = p_generation_id
  for update;

  if not found or v_generation.status in ('failed', 'succeeded', 'cancelled') then
    return;
  end if;

  update public.generations
  set
    status = 'failed',
    provider_status = coalesce(provider_status, 'failed'),
    error_message = left(coalesce(p_error_message, 'Tạo video thất bại.'), 2000),
    completed_at = now(),
    updated_at = now()
  where id = p_generation_id;

  update public.profiles
  set credits = credits + v_generation.cost_credits, updated_at = now()
  where id = v_generation.user_id;
end;
$$;

revoke all on function public.fail_and_refund_generation(uuid, text) from public;
grant execute on function public.fail_and_refund_generation(uuid, text) to service_role;

revoke all on public.saas_settings from anon, authenticated;
revoke insert, update, delete on public.profiles from anon, authenticated;
revoke insert, update, delete on public.generations from anon, authenticated;
