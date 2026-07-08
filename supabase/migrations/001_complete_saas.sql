-- Run this file once in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  plan text not null default 'trial' check (plan in ('trial','starter','pro','business')),
  credits integer not null default 12 check (credits >= 0),
  credit_debt integer not null default 0 check (credit_debt >= 0),
  hourly_scene_limit integer not null default 12 check (hourly_scene_limit > 0),
  max_active_scenes integer not null default 2 check (max_active_scenes > 0),
  video_retention_days integer not null default 3 check (video_retention_days between 1 and 3650),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.saas_settings (
  singleton boolean primary key default true check (singleton),
  global_active_limit integer not null default 40 check (global_active_limit > 0),
  updated_at timestamptz not null default now()
);
insert into public.saas_settings(singleton) values (true) on conflict(singleton) do nothing;

create table if not exists public.generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null,
  prompt text not null,
  model text not null,
  status text not null default 'reserved' check (status in ('reserved','submitted','processing','succeeded','failed','cancelled')),
  provider_status text,
  provider_job_id text unique,
  provider_asset_id text,
  output_url text,
  error_message text,
  cost_credits integer not null default 1 check (cost_credits > 0),
  storage_status text not null default 'pending' check (storage_status in ('pending','archiving','archived','failed','deleted')),
  storage_bucket text,
  storage_path text,
  storage_error text,
  output_size_bytes bigint,
  archive_attempt_count integer not null default 0,
  last_archive_attempt_at timestamptz,
  archived_at timestamptz,
  storage_deleted_at timestamptz,
  reconcile_locked_until timestamptz,
  reconcile_attempt_count integer not null default 0,
  last_reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(user_id,idempotency_key)
);
create index if not exists generations_user_created_idx on public.generations(user_id,created_at desc);
create index if not exists generations_active_idx on public.generations(status,updated_at) where status in ('reserved','submitted','processing');

create table if not exists public.video_outputs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Video thương hiệu cá nhân',
  aspect_ratio text not null default '9:16' check (aspect_ratio in ('9:16','16:9')),
  status text not null default 'processing' check (status in ('processing','succeeded','failed','expired')),
  storage_bucket text,
  storage_path text,
  size_bytes bigint,
  error_message text,
  cleanup_locked_until timestamptz,
  storage_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists video_outputs_user_created_idx on public.video_outputs(user_id,created_at desc);

create table if not exists public.api_usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  operation text not null,
  created_at timestamptz not null default now()
);
create index if not exists api_usage_events_lookup_idx on public.api_usage_events(user_id,operation,created_at desc);

create table if not exists public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'stripe' check (provider='stripe'),
  pack_id text not null,
  target_plan text not null check (target_plan in ('starter','pro','business')),
  credits integer not null check (credits > 0),
  amount integer not null check (amount > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  status text not null default 'pending' check (status in ('pending','paid','failed','expired','partially_refunded','refunded')),
  client_idempotency_key text not null,
  provider_session_id text unique,
  provider_payment_intent_id text,
  provider_event_id text,
  checkout_url text,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  refunded_amount integer not null default 0 check (refunded_amount >= 0),
  revoked_credits integer not null default 0 check (revoked_credits >= 0),
  unique(user_id,client_idempotency_key)
);
create index if not exists payment_orders_user_created_idx on public.payment_orders(user_id,created_at desc);


-- Upgrade-safe additions when an earlier SaaS migration was already applied.
alter table public.profiles
  add column if not exists credit_debt integer not null default 0 check (credit_debt >= 0),
  add column if not exists video_retention_days integer not null default 3 check (video_retention_days between 1 and 3650);

alter table public.generations
  add column if not exists storage_status text not null default 'pending',
  add column if not exists storage_bucket text,
  add column if not exists storage_path text,
  add column if not exists storage_error text,
  add column if not exists output_size_bytes bigint,
  add column if not exists archive_attempt_count integer not null default 0,
  add column if not exists last_archive_attempt_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists storage_deleted_at timestamptz,
  add column if not exists reconcile_locked_until timestamptz,
  add column if not exists reconcile_attempt_count integer not null default 0,
  add column if not exists last_reconciled_at timestamptz;

alter table public.payment_orders
  add column if not exists refunded_amount integer not null default 0 check (refunded_amount >= 0),
  add column if not exists revoked_credits integer not null default 0 check (revoked_credits >= 0);

alter table public.payment_orders drop constraint if exists payment_orders_status_check;
alter table public.payment_orders add constraint payment_orders_status_check
  check (status in ('pending','paid','failed','expired','partially_refunded','refunded'));

alter table public.generations drop constraint if exists generations_storage_status_check;
alter table public.generations add constraint generations_storage_status_check
  check (storage_status in ('pending','archiving','archived','failed','deleted'));

create table if not exists public.payment_events (
  event_id text primary key,
  event_type text not null,
  object_id text,
  payload_hash text not null,
  processed_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.generations enable row level security;
alter table public.video_outputs enable row level security;
alter table public.api_usage_events enable row level security;
alter table public.payment_orders enable row level security;
alter table public.payment_events enable row level security;
alter table public.saas_settings enable row level security;

drop policy if exists profiles_read_own on public.profiles;
create policy profiles_read_own on public.profiles for select to authenticated using(id=auth.uid());
drop policy if exists generations_read_own on public.generations;
create policy generations_read_own on public.generations for select to authenticated using(user_id=auth.uid());
drop policy if exists outputs_read_own on public.video_outputs;
create policy outputs_read_own on public.video_outputs for select to authenticated using(user_id=auth.uid());
drop policy if exists payments_read_own on public.payment_orders;
create policy payments_read_own on public.payment_orders for select to authenticated using(user_id=auth.uid());

revoke all on public.saas_settings, public.api_usage_events, public.payment_events from anon, authenticated;
revoke insert,update,delete on public.profiles, public.generations, public.video_outputs, public.payment_orders from anon, authenticated;
grant select on public.profiles, public.generations, public.video_outputs, public.payment_orders to authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,email) values(new.id,coalesce(new.email,''))
  on conflict(id) do update set email=excluded.email, updated_at=now();
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert or update of email on auth.users
for each row execute procedure public.handle_new_user();
insert into public.profiles(id,email) select id,coalesce(email,'') from auth.users
on conflict(id) do update set email=excluded.email,updated_at=now();

create or replace function public.consume_api_quota(p_operation text,p_limit integer,p_window_seconds integer)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_count integer;
begin
  if v_uid is null then raise exception 'authentication_required'; end if;
  if p_limit<1 or p_window_seconds<1 or length(coalesce(p_operation,''))<1 then raise exception 'invalid_quota'; end if;
  perform pg_advisory_xact_lock(hashtext(v_uid::text||':'||p_operation));
  select count(*) into v_count from public.api_usage_events
  where user_id=v_uid and operation=p_operation and created_at>=now()-make_interval(secs=>p_window_seconds);
  if v_count>=p_limit then return false; end if;
  insert into public.api_usage_events(user_id,operation) values(v_uid,left(p_operation,100));
  return true;
end; $$;
revoke all on function public.consume_api_quota(text,integer,integer) from public;
grant execute on function public.consume_api_quota(text,integer,integer) to authenticated;

create or replace function public.reserve_video_generation(
  p_idempotency_key text,p_prompt text,p_model text,p_cost_credits integer default 1)
returns table(generation_id uuid,allowed boolean,reused boolean,reason text,provider_job_id text)
language plpgsql security definer set search_path=public as $$
declare
  v_uid uuid:=auth.uid(); v_profile public.profiles%rowtype; v_existing public.generations%rowtype;
  v_id uuid; v_global_limit integer; v_global_active integer; v_user_active integer; v_hourly integer;
begin
  if v_uid is null then raise exception 'authentication_required'; end if;
  if length(coalesce(p_idempotency_key,''))<32 then raise exception 'invalid_idempotency_key'; end if;
  select * into v_existing from public.generations where user_id=v_uid and idempotency_key=p_idempotency_key limit 1;
  if found then
    return query select v_existing.id,true,true,'reused',coalesce(v_existing.provider_job_id,''); return;
  end if;

  perform pg_advisory_xact_lock(hashtext('global_generation_limit'));
  select * into v_profile from public.profiles where id=v_uid for update;
  if not found then return query select null::uuid,false,false,'profile_missing',''; return; end if;
  if v_profile.credit_debt>0 or v_profile.credits<greatest(p_cost_credits,1) then
    return query select null::uuid,false,false,'no_credits',''; return;
  end if;
  select count(*) into v_user_active from public.generations
  where user_id=v_uid and status in('reserved','submitted','processing') and updated_at>now()-interval '6 hours';
  if v_user_active>=v_profile.max_active_scenes then return query select null::uuid,false,false,'user_busy',''; return; end if;
  select count(*) into v_hourly from public.generations where user_id=v_uid and created_at>=now()-interval '1 hour';
  if v_hourly>=v_profile.hourly_scene_limit then return query select null::uuid,false,false,'hourly_limit',''; return; end if;
  select global_active_limit into v_global_limit from public.saas_settings where singleton=true;
  select count(*) into v_global_active from public.generations
  where status in('reserved','submitted','processing') and updated_at>now()-interval '6 hours';
  if v_global_active>=coalesce(v_global_limit,40) then return query select null::uuid,false,false,'system_busy',''; return; end if;

  update public.profiles set credits=credits-greatest(p_cost_credits,1),updated_at=now() where id=v_uid;
  insert into public.generations(user_id,idempotency_key,prompt,model,cost_credits)
  values(v_uid,p_idempotency_key,left(p_prompt,20000),left(p_model,100),greatest(p_cost_credits,1)) returning id into v_id;
  return query select v_id,true,false,'reserved','';
end; $$;
revoke all on function public.reserve_video_generation(text,text,text,integer) from public;
grant execute on function public.reserve_video_generation(text,text,text,integer) to authenticated;

create or replace function public.fail_and_refund_generation(p_generation_id uuid,p_error_message text)
returns void language plpgsql security definer set search_path=public as $$
declare v_row public.generations%rowtype;
begin
  select * into v_row from public.generations where id=p_generation_id for update;
  if not found or v_row.status in('failed','succeeded','cancelled') then return; end if;
  update public.generations set status='failed',provider_status=coalesce(provider_status,'failed'),
    error_message=left(coalesce(p_error_message,'Tạo video thất bại.'),2000),completed_at=now(),updated_at=now(),reconcile_locked_until=null
  where id=p_generation_id;
  update public.profiles set credits=credits+v_row.cost_credits,updated_at=now() where id=v_row.user_id;
end; $$;
revoke all on function public.fail_and_refund_generation(uuid,text) from public;
grant execute on function public.fail_and_refund_generation(uuid,text) to service_role;

create or replace function public.create_payment_order(
  p_client_idempotency_key text,p_pack_id text,p_target_plan text,p_credits integer,p_amount integer,p_currency text)
returns table(order_id uuid,reused boolean,order_status text,checkout_url text)
language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_order public.payment_orders%rowtype;
begin
  if v_uid is null then raise exception 'authentication_required'; end if;
  if length(coalesce(p_client_idempotency_key,''))<16 or p_credits<1 or p_amount<1
     or lower(p_currency)!~'^[a-z]{3}$' or p_target_plan not in('starter','pro','business') then
    raise exception 'invalid_payment_order';
  end if;
  select * into v_order from public.payment_orders
  where user_id=v_uid and client_idempotency_key=p_client_idempotency_key limit 1;
  if found then return query select v_order.id,true,v_order.status,coalesce(v_order.checkout_url,''); return; end if;
  insert into public.payment_orders(user_id,pack_id,target_plan,credits,amount,currency,client_idempotency_key)
  values(v_uid,left(p_pack_id,100),p_target_plan,p_credits,p_amount,lower(p_currency),p_client_idempotency_key)
  returning * into v_order;
  return query select v_order.id,false,v_order.status,'';
end; $$;
revoke all on function public.create_payment_order(text,text,text,integer,integer,text) from public;
grant execute on function public.create_payment_order(text,text,text,integer,integer,text) to authenticated;

create or replace function public.complete_stripe_payment(
  p_event_id text,p_event_type text,p_payload_hash text,p_order_id uuid,p_session_id text,
  p_payment_intent_id text,p_amount_total integer,p_currency text)
returns table(granted boolean,already_processed boolean,granted_credits integer)
language plpgsql security definer set search_path=public as $$
declare v_order public.payment_orders%rowtype; v_debt integer; v_net integer;
begin
  insert into public.payment_events(event_id,event_type,object_id,payload_hash)
  values(p_event_id,left(p_event_type,100),left(coalesce(p_session_id,''),255),p_payload_hash)
  on conflict(event_id) do nothing;
  if not found then return query select false,true,0; return; end if;
  select * into v_order from public.payment_orders where id=p_order_id for update;
  if not found then raise exception 'payment_order_not_found'; end if;
  if v_order.status='paid' then return query select false,true,0; return; end if;
  if v_order.amount<>p_amount_total or v_order.currency<>lower(p_currency) then raise exception 'payment_amount_mismatch'; end if;
  if v_order.provider_session_id is not null and v_order.provider_session_id<>p_session_id then raise exception 'payment_session_mismatch'; end if;

  update public.payment_orders set status='paid',provider_session_id=p_session_id,
    provider_payment_intent_id=nullif(p_payment_intent_id,''),provider_event_id=p_event_id,
    paid_at=now(),updated_at=now(),failure_reason=null where id=v_order.id;
  select credit_debt into v_debt from public.profiles where id=v_order.user_id for update;
  v_net:=greatest(0,v_order.credits-coalesce(v_debt,0));
  update public.profiles set
    credit_debt=greatest(0,credit_debt-v_order.credits), credits=credits+v_net,
    plan=case when v_order.target_plan='business' then 'business'
              when v_order.target_plan='pro' and plan not in('business') then 'pro'
              when v_order.target_plan='starter' and plan='trial' then 'starter' else plan end,
    hourly_scene_limit=greatest(hourly_scene_limit,case v_order.target_plan when 'business' then 180 when 'pro' then 60 else 30 end),
    max_active_scenes=greatest(max_active_scenes,case v_order.target_plan when 'business' then 8 when 'pro' then 4 else 3 end),
    video_retention_days=greatest(video_retention_days,case v_order.target_plan when 'business' then 365 when 'pro' then 90 else 30 end),
    updated_at=now() where id=v_order.user_id;
  return query select true,false,v_net;
end; $$;
revoke all on function public.complete_stripe_payment(text,text,text,uuid,text,text,integer,text) from public;
grant execute on function public.complete_stripe_payment(text,text,text,uuid,text,text,integer,text) to service_role;

create or replace function public.mark_stripe_payment_status(
  p_event_id text,p_event_type text,p_payload_hash text,p_order_id uuid,p_session_id text,p_status text,p_reason text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if p_status not in('failed','expired') then raise exception 'invalid_payment_status'; end if;
  insert into public.payment_events(event_id,event_type,object_id,payload_hash)
  values(p_event_id,left(p_event_type,100),left(coalesce(p_session_id,''),255),p_payload_hash)
  on conflict(event_id) do nothing;
  if not found then return false; end if;
  update public.payment_orders set status=p_status,provider_session_id=coalesce(provider_session_id,nullif(p_session_id,'')),
    provider_event_id=p_event_id,failure_reason=left(coalesce(p_reason,''),1000),updated_at=now()
  where id=p_order_id and status='pending';
  return true;
end; $$;
revoke all on function public.mark_stripe_payment_status(text,text,text,uuid,text,text,text) from public;
grant execute on function public.mark_stripe_payment_status(text,text,text,uuid,text,text,text) to service_role;

create or replace function public.refund_stripe_payment(
  p_event_id text,p_event_type text,p_payload_hash text,p_payment_intent_id text,p_reason text,
  p_amount_refunded integer,p_charge_amount integer,p_currency text)
returns boolean language plpgsql security definer set search_path=public as $$
declare
  v_order public.payment_orders%rowtype; v_available integer; v_shortfall integer;
  v_target_revoked integer; v_delta integer; v_full boolean;
begin
  insert into public.payment_events(event_id,event_type,object_id,payload_hash)
  values(p_event_id,left(p_event_type,100),left(coalesce(p_payment_intent_id,''),255),p_payload_hash)
  on conflict(event_id) do nothing;
  if not found then return false; end if;

  select * into v_order from public.payment_orders where provider_payment_intent_id=p_payment_intent_id for update;
  if not found or v_order.status='refunded' then return false; end if;
  if v_order.status not in('paid','partially_refunded') then return false; end if;
  if p_charge_amount<>v_order.amount or lower(p_currency)<>v_order.currency then
    raise exception 'refund_amount_mismatch';
  end if;

  v_target_revoked:=least(v_order.credits,
    greatest(0,floor((v_order.credits::numeric*least(p_amount_refunded,p_charge_amount))/greatest(p_charge_amount,1))::integer));
  v_delta:=greatest(0,v_target_revoked-v_order.revoked_credits);
  v_full:=p_amount_refunded>=p_charge_amount;

  select credits into v_available from public.profiles where id=v_order.user_id for update;
  v_shortfall:=greatest(0,v_delta-coalesce(v_available,0));
  update public.payment_orders set
    status=case when v_full then 'refunded' else 'partially_refunded' end,
    refunded_amount=greatest(refunded_amount,p_amount_refunded),
    revoked_credits=v_target_revoked,
    failure_reason=left(coalesce(p_reason,''),1000),updated_at=now()
  where id=v_order.id;
  update public.profiles set
    credits=greatest(0,credits-v_delta),credit_debt=credit_debt+v_shortfall,updated_at=now()
  where id=v_order.user_id;

  if v_full then
    update public.profiles p set
      plan=case coalesce(x.max_rank,1) when 4 then 'business' when 3 then 'pro' when 2 then 'starter' else 'trial' end,
      hourly_scene_limit=case coalesce(x.max_rank,1) when 4 then 180 when 3 then 60 when 2 then 30 else 12 end,
      max_active_scenes=case coalesce(x.max_rank,1) when 4 then 8 when 3 then 4 when 2 then 3 else 2 end,
      video_retention_days=case coalesce(x.max_rank,1) when 4 then 365 when 3 then 90 when 2 then 30 else 3 end,
      updated_at=now()
    from (
      select max(case target_plan when 'business' then 4 when 'pro' then 3 when 'starter' then 2 else 1 end) as max_rank
      from public.payment_orders where user_id=v_order.user_id and status in('paid','partially_refunded')
    ) x where p.id=v_order.user_id;
  end if;
  return true;
end; $$;
revoke all on function public.refund_stripe_payment(text,text,text,text,text,integer,integer,text) from public;
grant execute on function public.refund_stripe_payment(text,text,text,text,text,integer,integer,text) to service_role;

create or replace function public.claim_generation_reconciliation_batch(p_limit integer default 20)
returns setof public.generations language plpgsql security definer set search_path=public as $$
begin
  return query
  with candidates as (
    select id from public.generations
    where (reconcile_locked_until is null or reconcile_locked_until<now()) and (
      (status='reserved' and created_at<now()-interval '10 minutes') or
      (status in('submitted','processing') and updated_at<now()-interval '5 minutes') or
      (status='succeeded' and storage_status in('pending','failed') and output_url is not null
       and completed_at>now()-interval '36 hours' and (last_archive_attempt_at is null or last_archive_attempt_at<now()-interval '5 minutes'))
    ) order by created_at for update skip locked limit greatest(1,least(coalesce(p_limit,20),50))
  )
  update public.generations g set reconcile_locked_until=now()+interval '10 minutes',
    reconcile_attempt_count=reconcile_attempt_count+1,last_reconciled_at=now()
  from candidates c where g.id=c.id returning g.*;
end; $$;
revoke all on function public.claim_generation_reconciliation_batch(integer) from public;
grant execute on function public.claim_generation_reconciliation_batch(integer) to service_role;

create or replace function public.claim_expired_storage_batch(p_limit integer default 20)
returns table(record_type text,id uuid,user_id uuid,storage_bucket text,storage_path text)
language plpgsql security definer set search_path=public as $$
begin
  return query
  with c as (
    select g.id from public.generations g join public.profiles p on p.id=g.user_id
    where g.storage_status='archived' and g.storage_path is not null
      and g.archived_at<now()-make_interval(days=>p.video_retention_days)
      and (g.reconcile_locked_until is null or g.reconcile_locked_until<now())
    order by g.archived_at for update of g skip locked limit greatest(1,least(coalesce(p_limit,20),50))
  ), u as (
    update public.generations g set reconcile_locked_until=now()+interval '10 minutes'
    from c where g.id=c.id returning g.id,g.user_id,g.storage_bucket,g.storage_path
  ) select 'generation'::text,u.id,u.user_id,u.storage_bucket,u.storage_path from u;

  return query
  with c as (
    select o.id from public.video_outputs o join public.profiles p on p.id=o.user_id
    where o.status='succeeded' and o.storage_path is not null
      and o.completed_at<now()-make_interval(days=>p.video_retention_days)
      and (o.cleanup_locked_until is null or o.cleanup_locked_until<now())
    order by o.completed_at for update of o skip locked limit greatest(1,least(coalesce(p_limit,20),50))
  ), u as (
    update public.video_outputs o set cleanup_locked_until=now()+interval '10 minutes'
    from c where o.id=c.id returning o.id,o.user_id,o.storage_bucket,o.storage_path
  ) select 'output'::text,u.id,u.user_id,u.storage_bucket,u.storage_path from u;
end; $$;
revoke all on function public.claim_expired_storage_batch(integer) from public;
grant execute on function public.claim_expired_storage_batch(integer) to service_role;

do $$ begin
  if exists(select 1 from information_schema.tables where table_schema='storage' and table_name='buckets') then
    insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
    values('generated-videos','generated-videos',false,262144000,array['video/mp4'])
    on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
  end if;
end $$;
