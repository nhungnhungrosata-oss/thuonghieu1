create table if not exists public.api_usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  operation text not null,
  created_at timestamptz not null default now()
);

create index if not exists api_usage_events_user_operation_created_idx
  on public.api_usage_events (user_id, operation, created_at desc);

alter table public.api_usage_events enable row level security;
revoke all on public.api_usage_events from anon, authenticated;

create or replace function public.consume_api_quota(
  p_operation text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'authentication_required';
  end if;

  if p_limit < 1 or p_window_seconds < 1 or length(coalesce(p_operation, '')) < 1 then
    raise exception 'invalid_quota_arguments';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text || ':' || p_operation));

  select count(*) into v_count
  from public.api_usage_events
  where user_id = v_user_id
    and operation = p_operation
    and created_at >= now() - make_interval(secs => p_window_seconds);

  if v_count >= p_limit then
    return false;
  end if;

  insert into public.api_usage_events (user_id, operation)
  values (v_user_id, left(p_operation, 100));

  return true;
end;
$$;

revoke all on function public.consume_api_quota(text, integer, integer) from public;
grant execute on function public.consume_api_quota(text, integer, integer) to authenticated;
