
-- supabase/migrations/001_saas_foundation.sql
create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create type public.member_role as enum ('super_admin', 'salon_admin', 'manager', 'staff');
create type public.booking_status as enum ('pending', 'confirmed', 'risk', 'cancelled', 'completed', 'no_show');
create type public.lead_status as enum ('new', 'contacted', 'qualified', 'closed');
create type public.reminder_kind as enum ('confirmation_request', 'day_before', 'hours_before');
create type public.reminder_channel as enum ('line', 'email', 'sms');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.salons (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  country_code text not null default 'JP',
  timezone text not null default 'Asia/Tokyo',
  currency_code text not null default 'JPY',
  status text not null default 'active' check (status in ('active','trial','suspended')),
  brand_primary text not null default '#06C755',
  brand_secondary text not null default '#111827',
  line_channel_id text,
  line_basic_id text,
  booking_public_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.salon_members (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (salon_id, user_id)
);

create table if not exists public.salon_settings (
  salon_id uuid primary key references public.salons(id) on delete cascade,
  booking_notice text,
  cancellation_notice text,
  allow_guest_booking boolean not null default true,
  require_confirmation boolean not null default true,
  risk_threshold_minutes integer not null default 360 check (risk_threshold_minutes between 30 and 1440),
  duplicate_protection_minutes integer not null default 5 check (duplicate_protection_minutes between 1 and 120),
  booking_window_days integer not null default 30 check (booking_window_days between 1 and 180),
  max_bookings_per_day integer not null default 3 check (max_bookings_per_day between 1 and 20),
  lead_form_enabled boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  code text,
  name text not null,
  description text,
  duration_minutes integer not null check (duration_minutes between 5 and 600),
  price_jpy integer not null default 0 check (price_jpy >= 0),
  category text,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (salon_id, code)
);

create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  code text,
  name text not null,
  profile_note text,
  photo_url text,
  line_user_id text,
  slot_minutes integer not null default 30 check (slot_minutes between 5 and 120),
  start_time time not null default '10:00',
  end_time time not null default '19:00',
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (salon_id, code)
);

create table if not exists public.staff_service_map (
  staff_id uuid not null references public.staff(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  salon_id uuid not null references public.salons(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (staff_id, service_id)
);

create table if not exists public.business_hours (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  day_of_week integer not null check (day_of_week between 0 and 6),
  open_time time,
  close_time time,
  is_closed boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (salon_id, day_of_week)
);

create table if not exists public.blocked_slots (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (ends_at > starts_at)
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid references public.salons(id) on delete cascade,
  source text not null default 'mini_app',
  salon_name text,
  owner_name text,
  contact_line text,
  email text,
  phone text,
  business_type text,
  note text,
  line_user_id text,
  line_display_name text,
  payload jsonb not null default '{}'::jsonb,
  status public.lead_status not null default 'new',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  public_token uuid not null default gen_random_uuid(),
  source text not null default 'liff',
  customer_name text not null,
  customer_phone text,
  customer_email text,
  line_user_id text,
  line_display_name text,
  service_id uuid not null references public.services(id),
  staff_id uuid not null references public.staff(id),
  booking_date date not null,
  start_time time not null,
  end_time time not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.booking_status not null default 'pending',
  risk_score integer not null default 0 check (risk_score between 0 and 100),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by text,
  cancellation_reason text,
  admin_note text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (public_token),
  check (ends_at > starts_at)
);

create table if not exists public.booking_events (
  id bigserial primary key,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  salon_id uuid not null references public.salons(id) on delete cascade,
  event_type text not null,
  actor_type text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_label text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.reminder_rules (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  kind public.reminder_kind not null,
  channel public.reminder_channel not null default 'line',
  offset_minutes integer not null,
  is_enabled boolean not null default true,
  template_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (salon_id, kind, channel)
);

create table if not exists public.reminder_jobs (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  salon_id uuid not null references public.salons(id) on delete cascade,
  kind public.reminder_kind not null,
  channel public.reminder_channel not null,
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  delivery_status text not null default 'pending' check (delivery_status in ('pending','sent','failed','cancelled')),
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (booking_id, kind, channel)
);

create index if not exists idx_services_salon_active on public.services (salon_id, is_active, sort_order);
create index if not exists idx_staff_salon_active on public.staff (salon_id, is_active, name);
create index if not exists idx_booking_salon_date on public.bookings (salon_id, booking_date, start_time);
create index if not exists idx_booking_salon_staff_time on public.bookings (salon_id, staff_id, starts_at, ends_at);
create index if not exists idx_booking_line_user on public.bookings (line_user_id);
create index if not exists idx_leads_salon_status on public.leads (salon_id, status, created_at desc);
create index if not exists idx_reminder_jobs_due on public.reminder_jobs (delivery_status, scheduled_for);
create index if not exists idx_booking_events_booking on public.booking_events (booking_id, created_at desc);
create index if not exists idx_staff_service_map_salon on public.staff_service_map (salon_id, service_id, staff_id);

alter table public.salons add constraint salons_unique_booking_public_token unique (booking_public_token);

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
as $$
  select coalesce((select p.is_platform_admin from public.profiles p where p.id = auth.uid()), false);
$$;

create or replace function public.is_member_of_salon(target_salon_id uuid)
returns boolean
language sql
stable
as $$
  select public.is_platform_admin() or exists (
    select 1
    from public.salon_members sm
    where sm.salon_id = target_salon_id
      and sm.user_id = auth.uid()
      and sm.is_active = true
  );
$$;

create or replace function public.member_role_for_salon(target_salon_id uuid)
returns public.member_role
language sql
stable
as $$
  select sm.role
  from public.salon_members sm
  where sm.salon_id = target_salon_id
    and sm.user_id = auth.uid()
    and sm.is_active = true
  order by
    case sm.role
      when 'super_admin' then 1
      when 'salon_admin' then 2
      when 'manager' then 3
      else 4
    end
  limit 1;
$$;

create or replace function public.can_manage_salon(target_salon_id uuid)
returns boolean
language sql
stable
as $$
  select public.is_platform_admin()
    or exists (
      select 1
      from public.salon_members sm
      where sm.salon_id = target_salon_id
        and sm.user_id = auth.uid()
        and sm.is_active = true
        and sm.role in ('super_admin', 'salon_admin', 'manager')
    );
$$;

create or replace function public.compute_booking_datetimes(
  p_booking_date date,
  p_start_time time,
  p_duration_minutes integer,
  p_timezone text
)
returns table(starts_at timestamptz, ends_at timestamptz, end_time time)
language sql
immutable
as $$
  select
    ((p_booking_date::text || ' ' || p_start_time::text) :: timestamp at time zone p_timezone) as starts_at,
    (((p_booking_date::text || ' ' || p_start_time::text) :: timestamp + make_interval(mins => p_duration_minutes)) at time zone p_timezone) as ends_at,
    (p_start_time + make_interval(mins => p_duration_minutes))::time as end_time
$$;

create or replace function public.public_catalog(p_salon_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_salon public.salons%rowtype;
  v_result jsonb;
begin
  select * into v_salon from public.salons where slug = p_salon_slug and status in ('active','trial');
  if not found then
    raise exception 'salon_not_found';
  end if;

  v_result := jsonb_build_object(
    'salon', jsonb_build_object(
      'slug', v_salon.slug,
      'name', v_salon.name,
      'timezone', v_salon.timezone,
      'brandPrimary', v_salon.brand_primary,
      'brandSecondary', v_salon.brand_secondary
    ),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'description', s.description,
        'durationMinutes', s.duration_minutes,
        'priceJpy', s.price_jpy,
        'category', s.category
      ) order by s.sort_order, s.name)
      from public.services s
      where s.salon_id = v_salon.id and s.is_active = true
    ), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', st.id,
        'name', st.name,
        'photoUrl', st.photo_url,
        'slotMinutes', st.slot_minutes,
        'startTime', st.start_time,
        'endTime', st.end_time,
        'serviceIds', coalesce((
          select jsonb_agg(ssm.service_id)
          from public.staff_service_map ssm
          where ssm.staff_id = st.id
        ), '[]'::jsonb)
      ) order by st.name)
      from public.staff st
      where st.salon_id = v_salon.id and st.is_active = true
    ), '[]'::jsonb),
    'businessHours', coalesce((
      select jsonb_agg(jsonb_build_object(
        'dayOfWeek', bh.day_of_week,
        'openTime', bh.open_time,
        'closeTime', bh.close_time,
        'isClosed', bh.is_closed
      ) order by bh.day_of_week)
      from public.business_hours bh
      where bh.salon_id = v_salon.id
    ), '[]'::jsonb)
  );
  return v_result;
end;
$$;

create or replace function public.available_slots(
  p_salon_slug text,
  p_service_id uuid,
  p_staff_id uuid,
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
  select * into v_salon from public.salons where slug = p_salon_slug and status in ('active','trial');
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

create or replace function public.create_public_booking(
  p_salon_slug text,
  p_service_id uuid,
  p_staff_id uuid,
  p_booking_date date,
  p_start_time time,
  p_customer_name text,
  p_customer_phone text,
  p_line_user_id text default null,
  p_line_display_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_salon public.salons%rowtype;
  v_service public.services%rowtype;
  v_staff public.staff%rowtype;
  v_settings public.salon_settings%rowtype;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_end_time time;
  v_booking public.bookings%rowtype;
  v_existing_count integer;
begin
  select * into v_salon from public.salons where slug = p_salon_slug and status in ('active','trial');
  if not found then
    raise exception 'salon_not_found';
  end if;

  select * into v_settings from public.salon_settings where salon_id = v_salon.id;
  select * into v_service from public.services where id = p_service_id and salon_id = v_salon.id and is_active = true;
  select * into v_staff from public.staff where id = p_staff_id and salon_id = v_salon.id and is_active = true;

  if not found then
    raise exception 'invalid_service_or_staff';
  end if;

  if not exists (
    select 1 from public.staff_service_map
    where salon_id = v_salon.id and staff_id = p_staff_id and service_id = p_service_id
  ) then
    raise exception 'staff_cannot_do_service';
  end if;

  select starts_at, ends_at, end_time
  into v_starts_at, v_ends_at, v_end_time
  from public.compute_booking_datetimes(
    p_booking_date,
    p_start_time,
    v_service.duration_minutes,
    v_salon.timezone
  );

  if v_starts_at < timezone('utc', now()) then
    raise exception 'booking_in_past';
  end if;

  if p_booking_date > (current_date + make_interval(days => coalesce(v_settings.booking_window_days, 30)))::date then
    raise exception 'too_far_in_future';
  end if;

  select count(*)
  into v_existing_count
  from public.bookings b
  where b.salon_id = v_salon.id
    and coalesce(b.line_user_id, '') = coalesce(p_line_user_id, '')
    and coalesce(b.customer_phone, '') = coalesce(p_customer_phone, '')
    and b.booking_date = p_booking_date
    and abs(extract(epoch from (b.starts_at - v_starts_at))) <= coalesce(v_settings.duplicate_protection_minutes, 5) * 60
    and b.status not in ('cancelled');

  if v_existing_count > 0 then
    raise exception 'duplicate_booking';
  end if;

  if exists (
    select 1
    from public.bookings b
    where b.salon_id = v_salon.id
      and b.staff_id = p_staff_id
      and b.status not in ('cancelled','completed','no_show')
      and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(v_starts_at, v_ends_at, '[)')
  ) then
    raise exception 'slot_conflict';
  end if;

  if exists (
    select 1
    from public.blocked_slots bs
    where bs.salon_id = v_salon.id
      and (bs.staff_id is null or bs.staff_id = p_staff_id)
      and tstzrange(bs.starts_at, bs.ends_at, '[)') && tstzrange(v_starts_at, v_ends_at, '[)')
  ) then
    raise exception 'blocked_slot';
  end if;

  insert into public.bookings (
    salon_id, source, customer_name, customer_phone, line_user_id, line_display_name,
    service_id, staff_id, booking_date, start_time, end_time, starts_at, ends_at, status
  )
  values (
    v_salon.id, 'liff', p_customer_name, p_customer_phone, p_line_user_id, p_line_display_name,
    p_service_id, p_staff_id, p_booking_date, p_start_time, v_end_time, v_starts_at, v_ends_at,
    case when coalesce(v_settings.require_confirmation, true) then 'pending' else 'confirmed' end
  )
  returning * into v_booking;

  insert into public.booking_events (booking_id, salon_id, event_type, actor_type, actor_label, payload)
  values (
    v_booking.id, v_salon.id, 'booking_created', 'customer', coalesce(p_line_display_name, p_customer_name),
    jsonb_build_object('source', 'liff')
  );

  insert into public.reminder_jobs (booking_id, salon_id, kind, channel, scheduled_for)
  values
    (v_booking.id, v_salon.id, 'confirmation_request', 'line', timezone('utc', now())),
    (v_booking.id, v_salon.id, 'day_before', 'line', v_starts_at - interval '24 hours'),
    (v_booking.id, v_salon.id, 'hours_before', 'line', v_starts_at - interval '3 hours')
  on conflict do nothing;

  return jsonb_build_object(
    'bookingId', v_booking.id,
    'publicToken', v_booking.public_token,
    'status', v_booking.status
  );
end;
$$;

create or replace function public.public_change_booking_status(
  p_public_token uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
  v_next_status public.booking_status;
  v_event text;
begin
  select * into v_booking from public.bookings where public_token = p_public_token;
  if not found then
    raise exception 'booking_not_found';
  end if;

  if p_action = 'confirm' then
    if v_booking.status in ('cancelled','completed','no_show') then
      return jsonb_build_object('status', v_booking.status, 'changed', false);
    end if;
    v_next_status := 'confirmed';
    v_event := 'booking_confirmed';
    update public.bookings
      set status = v_next_status,
          confirmed_at = timezone('utc', now()),
          updated_at = timezone('utc', now())
      where id = v_booking.id;
  elsif p_action = 'cancel' then
    if v_booking.status in ('cancelled','completed','no_show') then
      return jsonb_build_object('status', v_booking.status, 'changed', false);
    end if;
    v_next_status := 'cancelled';
    v_event := 'booking_cancelled';
    update public.bookings
      set status = v_next_status,
          cancelled_at = timezone('utc', now()),
          cancelled_by = 'customer',
          updated_at = timezone('utc', now())
      where id = v_booking.id;
    update public.reminder_jobs
      set delivery_status = 'cancelled',
          updated_at = timezone('utc', now())
      where booking_id = v_booking.id and delivery_status = 'pending';
  else
    raise exception 'invalid_action';
  end if;

  insert into public.booking_events (booking_id, salon_id, event_type, actor_type, actor_label)
  values (v_booking.id, v_booking.salon_id, v_event, 'customer', coalesce(v_booking.line_display_name, v_booking.customer_name));

  return jsonb_build_object('status', v_next_status, 'changed', true);
end;
$$;

create or replace function public.create_public_lead(
  p_salon_slug text,
  p_salon_name text,
  p_owner_name text,
  p_contact_line text,
  p_business_type text,
  p_note text,
  p_line_user_id text default null,
  p_line_display_name text default null,
  p_source text default 'mini_app'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_salon public.salons%rowtype;
  v_lead public.leads%rowtype;
begin
  select * into v_salon from public.salons where slug = p_salon_slug and status in ('active','trial');
  if not found then
    raise exception 'salon_not_found';
  end if;

  insert into public.leads (
    salon_id, source, salon_name, owner_name, contact_line, business_type, note,
    line_user_id, line_display_name
  )
  values (
    v_salon.id, p_source, p_salon_name, p_owner_name, p_contact_line, p_business_type, p_note,
    p_line_user_id, p_line_display_name
  )
  returning * into v_lead;

  return jsonb_build_object('leadId', v_lead.id, 'status', v_lead.status);
end;
$$;

create or replace function public.mark_booking_risk()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.bookings b
    set status = 'risk',
        updated_at = timezone('utc', now()),
        risk_score = greatest(b.risk_score, 60)
  from public.salon_settings ss
  where b.salon_id = ss.salon_id
    and b.status = 'pending'
    and b.starts_at <= timezone('utc', now()) + make_interval(mins => ss.risk_threshold_minutes)
    and b.starts_at > timezone('utc', now());

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace view public.admin_booking_view as
select
  b.id,
  b.salon_id,
  b.public_token,
  b.customer_name,
  b.customer_phone,
  b.line_display_name,
  s.name as service_name,
  st.name as staff_name,
  b.booking_date,
  b.start_time,
  b.end_time,
  b.status,
  b.risk_score,
  b.confirmed_at,
  b.cancelled_at,
  b.cancelled_by,
  b.admin_note,
  b.created_at
from public.bookings b
join public.services s on s.id = b.service_id
join public.staff st on st.id = b.staff_id;

create trigger trg_salons_updated_at before update on public.salons for each row execute function public.set_updated_at();
create trigger trg_profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger trg_salon_members_updated_at before update on public.salon_members for each row execute function public.set_updated_at();
create trigger trg_salon_settings_updated_at before update on public.salon_settings for each row execute function public.set_updated_at();
create trigger trg_services_updated_at before update on public.services for each row execute function public.set_updated_at();
create trigger trg_staff_updated_at before update on public.staff for each row execute function public.set_updated_at();
create trigger trg_business_hours_updated_at before update on public.business_hours for each row execute function public.set_updated_at();
create trigger trg_blocked_slots_updated_at before update on public.blocked_slots for each row execute function public.set_updated_at();
create trigger trg_leads_updated_at before update on public.leads for each row execute function public.set_updated_at();
create trigger trg_bookings_updated_at before update on public.bookings for each row execute function public.set_updated_at();
create trigger trg_reminder_rules_updated_at before update on public.reminder_rules for each row execute function public.set_updated_at();
create trigger trg_reminder_jobs_updated_at before update on public.reminder_jobs for each row execute function public.set_updated_at();

alter table public.salons enable row level security;
alter table public.profiles enable row level security;
alter table public.salon_members enable row level security;
alter table public.salon_settings enable row level security;
alter table public.services enable row level security;
alter table public.staff enable row level security;
alter table public.staff_service_map enable row level security;
alter table public.business_hours enable row level security;
alter table public.blocked_slots enable row level security;
alter table public.leads enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_events enable row level security;
alter table public.reminder_rules enable row level security;
alter table public.reminder_jobs enable row level security;

create policy "profiles_self_select" on public.profiles
for select using (id = auth.uid() or public.is_platform_admin());

create policy "profiles_self_update" on public.profiles
for update using (id = auth.uid() or public.is_platform_admin());

create policy "salons_members_can_read" on public.salons
for select using (public.is_member_of_salon(id));

create policy "salons_admin_manage" on public.salons
for all using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "salon_members_member_read" on public.salon_members
for select using (public.is_member_of_salon(salon_id));

create policy "salon_members_admin_manage" on public.salon_members
for all using (public.can_manage_salon(salon_id)) with check (public.can_manage_salon(salon_id));

create policy "salon_settings_member_read" on public.salon_settings
for select using (public.is_member_of_salon(salon_id));

create policy "salon_settings_admin_manage" on public.salon_settings
for all using (public.can_manage_salon(salon_id)) with check (public.can_manage_salon(salon_id));

create policy "services_public_read_blocked_direct" on public.services
for select using (public.is_member_of_salon(salon_id));

create policy "services_admin_manage" on public.services
for all using (public.can_manage_salon(salon_id)) with check (public.can_manage_salon(salon_id));

create policy "staff_member_read" on public.staff
for select using (public.is_member_of_salon(salon_id));

create policy "staff_admin_manage" on public.staff
for all using (public.can_manage_salon(salon_id)) with check (public.can_manage_salon(salon_id));

create policy "staff_service_member_read" on public.staff_service_map
for select using (public.is_member_of_salon(salon_id));

create policy "staff_service_admin_manage" on public.staff_service_map
for all using (public.can_manage_salon(salon_id)) with check (public.can_manage_salon(salon_id));

create policy "business_hours_member_read" on public.business_hours
for select using (public.is_member_of_salon(salon_id));

create policy "business_hours_admin_manage" on public.business_hours
for all using (public.can_manage_salon(salon_id)) with check (public.can_manage_salon(salon_id));

create policy "blocked_slots_member_read" on public.blocked_slots
for select using (public.is_member_of_salon(salon_id));

create policy "blocked_slots_admin_manage" on public.blocked_slots
for all using (public.can_manage_salon(salon_id)) with check (public.can_manage_salon(salon_id));

create policy "leads_member_read" on public.leads
for select using (public.is_member_of_salon(salon_id));

create policy "leads_admin_manage" on public.leads
for all using (public.can_manage_salon(salon_id)) with check (public.can_manage_salon(salon_id));

create policy "bookings_member_read" on public.bookings
for select using (public.is_member_of_salon(salon_id));

create policy "bookings_admin_update" on public.bookings
for update using (public.can_manage_salon(salon_id)) with check (public.can_manage_salon(salon_id));

create policy "booking_events_member_read" on public.booking_events
for select using (public.is_member_of_salon(salon_id));

create policy "booking_events_admin_insert" on public.booking_events
for insert with check (public.can_manage_salon(salon_id));

create policy "reminder_rules_member_read" on public.reminder_rules
for select using (public.is_member_of_salon(salon_id));

create policy "reminder_rules_admin_manage" on public.reminder_rules
for all using (public.can_manage_salon(salon_id)) with check (public.can_manage_salon(salon_id));

create policy "reminder_jobs_member_read" on public.reminder_jobs
for select using (public.is_member_of_salon(salon_id));

create policy "reminder_jobs_admin_manage" on public.reminder_jobs
for all using (public.can_manage_salon(salon_id)) with check (public.can_manage_salon(salon_id));

grant execute on function public.public_catalog(text) to anon, authenticated;
grant execute on function public.available_slots(text, uuid, uuid, date) to anon, authenticated;
grant execute on function public.create_public_booking(text, uuid, uuid, date, time, text, text, text, text) to anon, authenticated;
grant execute on function public.public_change_booking_status(uuid, text) to anon, authenticated;
grant execute on function public.create_public_lead(text, text, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.mark_booking_risk() to authenticated;
grant select on public.admin_booking_view to authenticated;
