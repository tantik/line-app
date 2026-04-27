-- Drop existing function if it exists
DROP FUNCTION IF EXISTS public.available_slots_v2(uuid, uuid, uuid, date);

-- Add available_slots_v2 function
create or replace function public.available_slots_v2(
  p_salon_id uuid,
  p_staff_id uuid,
  p_service_id uuid,
  p_date date
)
returns table(slot_time text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_salon public.salons%rowtype;
  v_staff public.staff%rowtype;
  v_service public.services%rowtype;
  v_bh public.business_hours%rowtype;
  v_cursor timestamp;
  v_end_limit timestamp;
  v_timezone text;
  v_slot_minutes integer;
  v_duration integer;
begin
  select * into v_salon from public.salons where id = p_salon_id and status in ('active','trial');
  if not found then
    return;
  end if;

  select * into v_staff from public.staff where id = p_staff_id and salon_id = v_salon.id and is_active = true;
  select * into v_service from public.services where id = p_service_id and salon_id = v_salon.id and is_active = true;
  if not found then
    return;
  end if;

  if not exists (
    select 1 from public.staff_service_map
    where staff_id = p_staff_id and service_id = p_service_id and salon_id = v_salon.id
  ) then
    return;
  end if;

  select * into v_bh from public.business_hours where salon_id = v_salon.id and day_of_week = extract(dow from p_date)::int;
  if not found or v_bh.is_closed = true then
    return;
  end if;

  v_timezone := v_salon.timezone;
  v_slot_minutes := greatest(v_staff.slot_minutes, 5);
  v_duration := v_service.duration_minutes;
  v_cursor := (p_date::text || ' ' || v_staff.start_time::text)::timestamp;
  v_end_limit := (p_date::text || ' ' || v_staff.end_time::text)::timestamp;

  while v_cursor + make_interval(mins => v_duration) <= v_end_limit loop
    if v_cursor::time >= coalesce(v_bh.open_time, v_staff.start_time)
      and (v_cursor + make_interval(mins => v_duration))::time <= coalesce(v_bh.close_time, v_staff.end_time)
      and not exists (
        select 1
        from public.bookings b
        where b.salon_id = v_salon.id
          and b.staff_id = p_staff_id
          and b.status not in ('cancelled','completed','no_show')
          and tstzrange(b.starts_at, b.ends_at, '[)') &&
              tstzrange(
                (v_cursor at time zone v_timezone),
                ((v_cursor + make_interval(mins => v_duration)) at time zone v_timezone),
                '[)'
              )
      )
      and not exists (
        select 1
        from public.blocked_slots bs
        where bs.salon_id = v_salon.id
          and (bs.staff_id is null or bs.staff_id = p_staff_id)
          and tstzrange(bs.starts_at, bs.ends_at, '[)') &&
              tstzrange(
                (v_cursor at time zone v_timezone),
                ((v_cursor + make_interval(mins => v_duration)) at time zone v_timezone),
                '[)'
              )
      )
    then
      slot_time := to_char(v_cursor, 'HH24:MI');
      return next;
    end if;

    v_cursor := v_cursor + make_interval(mins => v_slot_minutes);
  end loop;
end;
$$;