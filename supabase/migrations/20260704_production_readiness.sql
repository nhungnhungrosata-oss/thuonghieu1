alter table public.profiles
  add column if not exists video_retention_days integer not null default 3
  check (video_retention_days between 1 and 3650);

alter table public.generations
  add column if not exists storage_bucket text,
  add column if not exists storage_path text,
  add column if not exists storage_status text not null default 'pending'
    check (storage_status in ('pending', 'archiving', 'archived', 'failed', 'deleted')),
  add column if not exists storage_error text,
  add column if not exists output_size_bytes bigint,
  add column if not exists archive_attempt_count integer not null default 0,
  add column if not exists last_archive_attempt_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists storage_deleted_at timestamptz,
  add column if not exists reconcile_locked_until timestamptz,
  add column if not exists reconcile_attempt_count integer not null default 0,
  add column if not exists last_reconciled_at timestamptz;

create index if not exists generations_reconcile_idx
  on public.generations (status, storage_status, updated_at)
  where status in ('reserved', 'submitted', 'processing', 'succeeded');

create table if not exists public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'stripe' check (provider in ('stripe')),
  pack_id text not null,
  target_plan text not null check (target_plan in ('starter', 'pro', 'business')),
  credits integer not null check (credits > 0),
  amount integer not null check (amount > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'expired', 'refunded')),
  client_idempotency_key text not null,
  provider_session_id text unique,
  provider_payment_intent_id text,
  provider_event_id text,
  checkout_url text,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  unique (user_id, client_idempotency_key)
);

create index if not exists payment_orders_user_created_idx
  on public.payment_orders (user_id, created_at desc);

create table if not exists public.payment_events (
  event_id text primary key,
  event_type text not null,
  object_id text,
  payload_hash text not null,
  processed_at timestamptz not null default now()
);

alter table public.payment_orders enable row level security;
alter table public.payment_events enable row level security;

drop policy if exists "Users read own payment orders" on public.payment_orders;
create policy "Users read own payment orders"
  on public.payment_orders for select
  to authenticated
  using (user_id = auth.uid());

revoke insert, update, delete on public.payment_orders from anon, authenticated;
revoke all on public.payment_events from anon, authenticated;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'buckets'
  ) then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('generated-videos', 'generated-videos', false, 209715200, array['video/mp4'])
    on conflict (id) do update set
      public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
  end if;
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
returns table (
  order_id uuid,
  reused boolean,
  order_status text,
  checkout_url text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_order public.payment_orders%rowtype;
begin
  if v_user_id is null then
    raise exception 'authentication_required';
  end if;

  if length(coalesce(p_client_idempotency_key, '')) < 16
     or p_credits < 1
     or p_amount < 1
     or lower(p_currency) !~ '^[a-z]{3}$'
     or p_target_plan not in ('starter', 'pro', 'business') then
    raise exception 'invalid_payment_order';
  end if;

  select * into v_order
  from public.payment_orders
  where user_id = v_user_id
    and client_idempotency_key = p_client_idempotency_key
  limit 1;

  if found then
    return query select v_order.id, true, v_order.status, coalesce(v_order.checkout_url, '');
    return;
  end if;

  insert into public.payment_orders (
    user_id,
    pack_id,
    target_plan,
    credits,
    amount,
    currency,
    client_idempotency_key
  ) values (
    v_user_id,
    left(p_pack_id, 100),
    p_target_plan,
    p_credits,
    p_amount,
    lower(p_currency),
    p_client_idempotency_key
  ) returning * into v_order;

  return query select v_order.id, false, v_order.status, ''::text;
end;
$$;

revoke all on function public.create_payment_order(text, text, text, integer, integer, text) from public;
grant execute on function public.create_payment_order(text, text, text, integer, integer, text) to authenticated;

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
returns table (
  granted boolean,
  already_processed boolean,
  granted_credits integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.payment_orders%rowtype;
  v_current_plan text;
  v_target_rank integer;
  v_current_rank integer;
begin
  if length(coalesce(p_event_id, '')) < 5 or length(coalesce(p_payload_hash, '')) < 32 then
    raise exception 'invalid_payment_event';
  end if;

  insert into public.payment_events (event_id, event_type, object_id, payload_hash)
  values (p_event_id, left(p_event_type, 100), left(coalesce(p_session_id, ''), 255), p_payload_hash)
  on conflict (event_id) do nothing;

  if not found then
    return query select false, true, 0;
    return;
  end if;

  select * into v_order
  from public.payment_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'payment_order_not_found';
  end if;

  if v_order.status = 'paid' then
    return query select false, true, 0;
    return;
  end if;

  if v_order.amount <> p_amount_total or v_order.currency <> lower(p_currency) then
    raise exception 'payment_amount_mismatch';
  end if;

  if v_order.provider_session_id is not null and v_order.provider_session_id <> p_session_id then
    raise exception 'payment_session_mismatch';
  end if;

  update public.payment_orders
  set
    status = 'paid',
    provider_session_id = p_session_id,
    provider_payment_intent_id = nullif(p_payment_intent_id, ''),
    provider_event_id = p_event_id,
    paid_at = now(),
    updated_at = now(),
    failure_reason = null
  where id = v_order.id;

  select plan into v_current_plan
  from public.profiles
  where id = v_order.user_id
  for update;

  v_current_rank := case v_current_plan
    when 'business' then 4
    when 'pro' then 3
    when 'starter' then 2
    else 1
  end;
  v_target_rank := case v_order.target_plan
    when 'business' then 4
    when 'pro' then 3
    else 2
  end;

  update public.profiles
  set
    credits = credits + v_order.credits,
    plan = case greatest(v_current_rank, v_target_rank)
      when 4 then 'business'
      when 3 then 'pro'
      when 2 then 'starter'
      else 'trial'
    end,
    hourly_scene_limit = greatest(hourly_scene_limit, case v_order.target_plan
      when 'business' then 180
      when 'pro' then 60
      else 30
    end),
    max_active_scenes = greatest(max_active_scenes, case v_order.target_plan
      when 'business' then 8
      when 'pro' then 4
      else 3
    end),
    video_retention_days = greatest(video_retention_days, case v_order.target_plan
      when 'business' then 365
      when 'pro' then 90
      else 30
    end),
    updated_at = now()
  where id = v_order.user_id;

  return query select true, false, v_order.credits;
end;
$$;

revoke all on function public.complete_stripe_payment(text, text, text, uuid, text, text, integer, text) from public;
grant execute on function public.complete_stripe_payment(text, text, text, uuid, text, text, integer, text) to service_role;

create or replace function public.mark_stripe_payment_status(
  p_event_id text,
  p_event_type text,
  p_payload_hash text,
  p_order_id uuid,
  p_session_id text,
  p_status text,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('failed', 'expired', 'refunded') then
    raise exception 'invalid_payment_status';
  end if;

  insert into public.payment_events (event_id, event_type, object_id, payload_hash)
  values (p_event_id, left(p_event_type, 100), left(coalesce(p_session_id, ''), 255), p_payload_hash)
  on conflict (event_id) do nothing;

  if not found then
    return false;
  end if;

  update public.payment_orders
  set
    status = p_status,
    provider_session_id = coalesce(provider_session_id, nullif(p_session_id, '')),
    provider_event_id = p_event_id,
    failure_reason = left(coalesce(p_reason, ''), 1000),
    updated_at = now()
  where id = p_order_id and status = 'pending';

  return true;
end;
$$;

revoke all on function public.mark_stripe_payment_status(text, text, text, uuid, text, text, text) from public;
grant execute on function public.mark_stripe_payment_status(text, text, text, uuid, text, text, text) to service_role;

create or replace function public.claim_generation_reconciliation_batch(p_limit integer default 20)
returns table (
  id uuid,
  user_id uuid,
  status text,
  provider_status text,
  provider_job_id text,
  provider_asset_id text,
  output_url text,
  storage_status text,
  storage_bucket text,
  storage_path text,
  created_at timestamptz,
  updated_at timestamptz,
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select g.id
    from public.generations g
    where (g.reconcile_locked_until is null or g.reconcile_locked_until < now())
      and (
        (g.status = 'reserved' and g.created_at < now() - interval '10 minutes')
        or (g.status in ('submitted', 'processing') and g.updated_at < now() - interval '5 minutes')
        or (
          g.status = 'succeeded'
          and g.storage_status in ('pending', 'failed')
          and g.output_url is not null
          and g.completed_at > now() - interval '36 hours'
          and (g.last_archive_attempt_at is null or g.last_archive_attempt_at < now() - interval '5 minutes')
        )
      )
    order by g.created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 50))
  )
  update public.generations g
  set
    reconcile_locked_until = now() + interval '10 minutes',
    reconcile_attempt_count = reconcile_attempt_count + 1,
    last_reconciled_at = now(),
    updated_at = now()
  from candidates c
  where g.id = c.id
  returning
    g.id,
    g.user_id,
    g.status,
    g.provider_status,
    g.provider_job_id,
    g.provider_asset_id,
    g.output_url,
    g.storage_status,
    g.storage_bucket,
    g.storage_path,
    g.created_at,
    g.updated_at,
    g.completed_at;
end;
$$;

revoke all on function public.claim_generation_reconciliation_batch(integer) from public;
grant execute on function public.claim_generation_reconciliation_batch(integer) to service_role;

create or replace function public.claim_expired_storage_batch(p_limit integer default 20)
returns table (
  id uuid,
  user_id uuid,
  storage_bucket text,
  storage_path text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select g.id
    from public.generations g
    join public.profiles p on p.id = g.user_id
    where g.storage_status = 'archived'
      and g.storage_path is not null
      and g.archived_at < now() - make_interval(days => p.video_retention_days)
      and (g.reconcile_locked_until is null or g.reconcile_locked_until < now())
    order by g.archived_at asc
    for update of g skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 50))
  )
  update public.generations g
  set reconcile_locked_until = now() + interval '10 minutes'
  from candidates c
  where g.id = c.id
  returning g.id, g.user_id, g.storage_bucket, g.storage_path;
end;
$$;

revoke all on function public.claim_expired_storage_batch(integer) from public;
grant execute on function public.claim_expired_storage_batch(integer) to service_role;
