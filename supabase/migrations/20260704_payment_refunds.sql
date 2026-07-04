create or replace function public.refund_stripe_payment(
  p_event_id text,
  p_event_type text,
  p_payload_hash text,
  p_payment_intent_id text,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.payment_orders%rowtype;
begin
  insert into public.payment_events (event_id, event_type, object_id, payload_hash)
  values (p_event_id, left(p_event_type, 100), left(coalesce(p_payment_intent_id, ''), 255), p_payload_hash)
  on conflict (event_id) do nothing;

  if not found then
    return false;
  end if;

  select * into v_order
  from public.payment_orders
  where provider_payment_intent_id = p_payment_intent_id
  for update;

  if not found or v_order.status = 'refunded' then
    return false;
  end if;

  update public.payment_orders
  set status = 'refunded', failure_reason = left(coalesce(p_reason, ''), 1000), updated_at = now()
  where id = v_order.id;

  update public.profiles
  set credits = greatest(0, credits - v_order.credits), updated_at = now()
  where id = v_order.user_id;

  return true;
end;
$$;

revoke all on function public.refund_stripe_payment(text, text, text, text, text) from public;
grant execute on function public.refund_stripe_payment(text, text, text, text, text) to service_role;
