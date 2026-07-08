create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
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

insert into public.saas_settings (singleton) values (true)
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
  storage_status text not null default 'none' check (storage_status in ('none', 'pending', 'archived', 'failed')),
  storage_bucket text,
  storage_path text,
  output_size_bytes bigint,
  storage_error text,
  archived_at timestamptz,
  last_archive_attempt_at timestamptz,
  archive_attempt_count integer not null default 0,
  reconcile_locked_until timestamptz,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create table if not exists public.video_outputs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Video đã ghép',
  aspect_ratio text not null default '9:16',
  status text not null default 'processing' check (status in ('processing', 'succeeded', 'failed')),
  storage_bucket text,
  storage_path text,
  size_bytes bigint,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.api_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operation text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_idempotency_key text not null,
  pack_id text not null,
  target_plan text not null check (target_plan in ('trial', 'starter', 'pro', 'business')),
  credits integer not null check (credits > 0),
  amount integer not null check (amount >= 0),
  currency text not null default 'usd',
  status text not null default 'created' check (status in ('created', 'checkout_created', 'paid', 'expired', 'failed', 'refunded')),
  provider text not null default 'stripe',
  provider_session_id text,
  provider_payment_intent_id text,
  checkout_url text,
  failure_reason text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, client_idempotency_key)
);

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  payload_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists generations_user_created_idx on public.generations (user_id, created_at desc);
create index if not exists generations_job_idx on public.generations (provider_job_id);
create index if not exists generations_active_idx on public.generations (status, updated_at desc) where status in ('reserved', 'submitted', 'processing');
create index if not exists video_outputs_user_created_idx on public.video_outputs (user_id, created_at desc);
create index if not exists api_usage_user_operation_idx on public.api_usage_events (user_id, operation, created_at desc);
create index if not exists payment_orders_user_created_idx on public.payment_orders (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.generations enable row level security;
alter table public.video_outputs enable row level security;
alter table public.payment_orders enable row level security;
alter table public.api_usage_events enable row level security;
alter table public.saas_settings enable row level security;

drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile" on public.profiles for select to authenticated using (id = auth.uid());

drop policy if exists "Users read own generations" on public.generations;
create policy "Users read own generations" on public.generations for select to authenticated using (user_id = auth.uid());

drop policy if exists "Users read own video outputs" on public.video_outputs;
create policy "Users read own video outputs" on public.video_outputs for select to authenticated using (user_id = auth.uid());

drop policy if exists "Users read own payment orders" on public.payment_orders;
create policy "Users read own payment orders" on public.payment_orders for select to authenticated using (user_id = auth.uid());

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
returns table (generation_id uuid, allowed boolean, reused boolean, reason text, provider_job_id text)
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
  v_cost integer := greatest(coalesce(p_cost_credits, 1), 1);
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;

  select * into v_existing from public.generations where user_id = v_user_id and idempotency_key = p_idempotency_key limit 1;
  if found then
    return query select v_existing.id, true, true, 'reused', coalesce(v_existing.provider_job_id, '');
    return;
  end if;

  select global_active_limit into v_global_limit from public.saas_settings where singleton = true for update;
  select * into v_profile from public.profiles where id = v_user_id for update;
  if not found then return query select null::uuid, false, false, 'profile_missing', ''::text; return; end if;
  if v_profile.credits < v_cost then return query select null::uuid, false, false, 'no_credits', ''::text; return; end if;

  select count(*) into v_user_active from public.generations
  where user_id = v_user_id and status in ('reserved', 'submitted', 'processing') and updated_at > now() - interval '6 hours';
  if v_user_active >= v_profile.max_active_scenes then return query select null::uuid, false, false, 'user_busy', ''::text; return; end if;

  select count(*) into v_hourly_count from public.generations where user_id = v_user_id and created_at >= now() - interval '1 hour';
  if v_hourly_count >= v_profile.hourly_scene_limit then return query select null::uuid, false, false, 'hourly_limit', ''::text; return; end if;

  select count(*) into v_global_active from public.generations
  where status in ('reserved', 'submitted', 'processing') and updated_at > now() - interval '6 hours';
  if v_global_active >= coalesce(v_global_limit, 40) then return query select null::uuid, false, false, 'system_busy', ''::text; return; end if;

  update public.profiles set credits = credits - v_cost, updated_at = now() where id = v_user_id;
  insert into public.generations (user_id, idempotency_key, prompt, model, cost_credits, status)
  values (v_user_id, p_idempotency_key, left(coalesce(p_prompt, ''), 20000), left(coalesce(p_model, ''), 100), v_cost, 'reserved')
  returning id into v_generation_id;

  return query select v_generation_id, true, false, 'reserved', ''::text;
end;
$$;

create or replace function public.fail_and_refund_generation(p_generation_id uuid, p_error_message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.generations%rowtype;
begin
  select * into v from public.generations where id = p_generation_id for update;
  if not found then return; end if;
  if v.status not in ('failed', 'cancelled', 'succeeded') then
    update public.generations set status = 'failed', error_message = left(coalesce(p_error_message, ''), 2000), updated_at = now(), completed_at = now()
    where id = p_generation_id;
    update public.profiles set credits = credits + v.cost_credits, updated_at = now() where id = v.user_id;
  end if;
end;
$$;

create or replace function public.consume_api_quota(p_operation text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  delete from public.api_usage_events where created_at < now() - interval '2 days';
  select count(*) into v_count from public.api_usage_events
  where user_id = v_user_id and operation = p_operation and created_at >= now() - make_interval(secs => greatest(p_window_seconds, 60));
  if v_count >= p_limit then return false; end if;
  insert into public.api_usage_events (user_id, operation) values (v_user_id, left(p_operation, 100));
  return true;
end;
$$;

create or replace function public.create_payment_order(
  p_client_idempotency_key text,
  p_pack_id text,
  p_target_plan text,
  p_credits integer,
  p_amount integer,
  p_currency text
)
returns table (order_id uuid, reused boolean, order_status text, checkout_url text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.payment_orders%rowtype;
  v_order_id uuid;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  select * into v_existing from public.payment_orders where user_id = v_user_id and client_idempotency_key = p_client_idempotency_key limit 1;
  if found then
    return query select v_existing.id, true, v_existing.status, coalesce(v_existing.checkout_url, '');
    return;
  end if;
  insert into public.payment_orders (user_id, client_idempotency_key, pack_id, target_plan, credits, amount, currency)
  values (v_user_id, p_client_idempotency_key, p_pack_id, p_target_plan, p_credits, p_amount, lower(coalesce(p_currency, 'usd')))
  returning id into v_order_id;
  return query select v_order_id, false, 'created', ''::text;
end;
$$;

create or replace function public.complete_stripe_payment(
  p_event_id text,
  p_event_type text,
  p_payload_hash text,
  p_order_id uuid,
  p_session_id text,
  p_payment_intent_id text,
  p_amount_total integer,
  p_currency text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.payment_orders%rowtype;
begin
  insert into public.stripe_webhook_events (event_id, event_type, payload_hash) values (p_event_id, p_event_type, p_payload_hash)
  on conflict (event_id) do nothing;
  if not found then return; end if;

  select * into v_order from public.payment_orders where id = p_order_id for update;
  if not found then return; end if;
  if v_order.status = 'paid' then return; end if;

  update public.payment_orders
  set status = 'paid', provider_session_id = p_session_id, provider_payment_intent_id = p_payment_intent_id,
      paid_at = now(), updated_at = now(), failure_reason = null
  where id = p_order_id;
  update public.profiles
  set credits = credits + v_order.credits, plan = v_order.target_plan, updated_at = now()
  where id = v_order.user_id;
end;
$$;

create or replace function public.mark_stripe_payment_status(
  p_event_id text,
  p_event_type text,
  p_payload_hash text,
  p_order_id uuid,
  p_session_id text,
  p_status text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.stripe_webhook_events (event_id, event_type, payload_hash) values (p_event_id, p_event_type, p_payload_hash)
  on conflict (event_id) do nothing;
  if not found then return; end if;
  update public.payment_orders
  set status = case when p_status in ('expired', 'failed') then p_status else 'failed' end,
      provider_session_id = p_session_id,
      failure_reason = left(coalesce(p_reason, ''), 500),
      updated_at = now()
  where id = p_order_id and status <> 'paid';
end;
$$;

create or replace function public.refund_stripe_payment(
  p_event_id text,
  p_event_type text,
  p_payload_hash text,
  p_payment_intent_id text,
  p_reason text,
  p_amount_refunded integer,
  p_charge_amount integer,
  p_currency text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.stripe_webhook_events (event_id, event_type, payload_hash) values (p_event_id, p_event_type, p_payload_hash)
  on conflict (event_id) do nothing;
  if not found then return; end if;
  update public.payment_orders
  set status = 'refunded', failure_reason = left(coalesce(p_reason, ''), 500), updated_at = now()
  where provider_payment_intent_id = p_payment_intent_id;
end;
$$;

revoke all on function public.reserve_video_generation(text, text, text, integer) from public;
revoke all on function public.fail_and_refund_generation(uuid, text) from public;
revoke all on function public.consume_api_quota(text, integer, integer) from public;
revoke all on function public.create_payment_order(text, text, text, integer, integer, text) from public;
grant execute on function public.reserve_video_generation(text, text, text, integer) to authenticated;
grant execute on function public.consume_api_quota(text, integer, integer) to authenticated;
grant execute on function public.create_payment_order(text, text, text, integer, integer, text) to authenticated;
