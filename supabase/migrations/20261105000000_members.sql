create schema if not exists members_private;
revoke all on schema members_private from public, anon, authenticated;

create table members_private.squads (code text primary key);
insert into members_private.squads (code) values
  ('ANS098'), ('ANSG52'), ('ANS2H6'), ('ANS0115'), ('ANSCBZ'), ('ANS456'), ('ANSXFW'),
  ('ANS141'), ('ANS7T7'), ('ANS11'), ('ANS0Y3'), ('ANSRSU'), ('ANSDRFE'), ('ANSDRN');

create table members_private.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 3 and 100),
  callsign text not null check (callsign ~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,31}$'),
  squad text not null references members_private.squads (code),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null
);
create unique index member_callsign_unique on members_private.profiles (lower(callsign));

create table members_private.administrators (
  user_id uuid primary key references members_private.profiles (user_id) on delete cascade
);

create table members_private.outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('application', 'approved', 'rejected')),
  user_id uuid not null references members_private.profiles (user_id) on delete cascade,
  recipient text not null,
  callsign text not null,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  claim_id uuid,
  sent_at timestamptz,
  unique (kind, user_id)
);

create table members_private.login_attempts (
  callsign text primary key,
  attempts integer not null,
  expires_at timestamptz not null
);

alter table members_private.squads enable row level security;
alter table members_private.profiles enable row level security;
alter table members_private.administrators enable row level security;
alter table members_private.outbox enable row level security;
alter table members_private.login_attempts enable row level security;

create function members_private.register_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into members_private.profiles (user_id, full_name, callsign, squad)
  values (new.id, trim(new.raw_user_meta_data->>'full_name'),
    trim(new.raw_user_meta_data->>'callsign'), new.raw_user_meta_data->>'squad');
  return new;
end;
$$;
revoke all on function members_private.register_profile() from public, anon, authenticated;
create trigger anastasi_register_profile after insert on auth.users
for each row execute function members_private.register_profile();

create function members_private.notify_application()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is not null then
    insert into members_private.outbox (kind, user_id, recipient, callsign)
    select 'application', p.user_id, 'anastasieste@gmail.com', p.callsign
    from members_private.profiles p where p.user_id = new.id and p.status = 'pending'
    on conflict (kind, user_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function members_private.notify_application() from public, anon, authenticated;
create trigger anastasi_verify_email after update of email_confirmed_at on auth.users
for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
execute function members_private.notify_application();
-- En una creación con correo ya confirmado, este trigger corre después de crear el perfil.
create trigger anastasi_verified_signup after insert on auth.users
for each row execute function members_private.notify_application();

create function public.current_member_profile()
returns table (callsign text, status text, is_admin boolean)
language sql stable security definer set search_path = '' as $$
  select p.callsign, p.status,
    p.status = 'approved' and exists (select from members_private.administrators a where a.user_id = p.user_id)
  from members_private.profiles p where p.user_id = auth.uid();
$$;

create function public.active_squad_counts()
returns table (code text, member_count integer)
language sql stable security definer set search_path = '' as $$
  select p.squad, count(*)::integer
  from members_private.profiles p join auth.users u on u.id = p.user_id
  where p.status = 'approved' and u.email_confirmed_at is not null
  group by p.squad;
$$;

create function members_private.require_admin()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (
    select from members_private.administrators a
    join members_private.profiles p on p.user_id = a.user_id
    join auth.users u on u.id = a.user_id
    where a.user_id = auth.uid() and p.status = 'approved' and u.email_confirmed_at is not null
  ) then raise insufficient_privilege; end if;
end;
$$;
revoke all on function members_private.require_admin() from public, anon, authenticated;

create function public.pending_member_applications()
returns table (id uuid, full_name text, callsign text, squad text, email text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform members_private.require_admin();
  return query select p.user_id, p.full_name, p.callsign, p.squad, u.email::text, p.created_at
    from members_private.profiles p join auth.users u on u.id = p.user_id
    where p.status = 'pending' and u.email_confirmed_at is not null
    order by p.created_at, p.user_id limit 100;
end;
$$;

create function public.decide_member_application(application_id uuid, approved boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  decision text;
  member members_private.profiles%rowtype;
begin
  perform members_private.require_admin();
  if approved is null then raise exception 'Decisión requerida'; end if;
  decision := case when approved then 'approved' else 'rejected' end;
  update members_private.profiles p
  set status = decision, decided_at = now(), decided_by = auth.uid()
  where p.user_id = application_id and p.status = 'pending'
    and exists (select from auth.users u where u.id = p.user_id and u.email_confirmed_at is not null)
  returning p.* into member;
  if not found then raise exception 'La solicitud ya fue procesada o no está confirmada'; end if;
  insert into members_private.outbox (kind, user_id, recipient, callsign)
  select decision, member.user_id, u.email, member.callsign from auth.users u where u.id = member.user_id;
end;
$$;

-- El email asociado a un callsign solo sale hacia el servidor de autenticación.
create function public.reserve_callsign_login(handle text)
returns table (allowed boolean, email text)
language plpgsql security definer set search_path = '' as $$
declare
  attempts integer;
begin
  if handle is null or handle !~ '^[a-z0-9][a-z0-9._-]{1,31}$' then return query select false, null::text; return; end if;
  delete from members_private.login_attempts l where l.expires_at < now();
  insert into members_private.login_attempts as l (callsign, attempts, expires_at)
  values (handle, 1, now() + interval '5 minutes')
  on conflict (callsign) do update set attempts = l.attempts + 1
  returning l.attempts into attempts;
  if attempts > 8 then return query select false, null::text; return; end if;
  return query select true, (
    select u.email::text from members_private.profiles p join auth.users u on u.id = p.user_id
    where lower(p.callsign) = handle
  );
end;
$$;

create function public.claim_member_mail()
returns table (id uuid, kind text, recipient text, callsign text, claim_id uuid)
language sql security definer set search_path = '' as $$
  with available as (
    select o.id from members_private.outbox o
    where o.sent_at is null and o.attempts < 6 and o.available_at <= now()
    order by o.available_at limit 8 for update skip locked
  )
  update members_private.outbox o
  set claim_id = gen_random_uuid(), attempts = o.attempts + 1, available_at = now() + interval '2 minutes'
  from available a where o.id = a.id
  returning o.id, o.kind, o.recipient, o.callsign, o.claim_id;
$$;

create function public.finish_member_mail(job uuid, claim uuid, delivered boolean)
returns void language sql security definer set search_path = '' as $$
  update members_private.outbox o
  set claim_id = null, sent_at = case when delivered then now() else null end,
      available_at = now() + o.attempts * interval '2 minutes'
  where o.id = job and o.claim_id = claim and o.sent_at is null;
$$;

revoke all on function public.current_member_profile(), public.active_squad_counts(),
  public.pending_member_applications(), public.decide_member_application(uuid, boolean),
  public.reserve_callsign_login(text), public.claim_member_mail(),
  public.finish_member_mail(uuid, uuid, boolean) from public, anon, authenticated;

grant execute on function public.active_squad_counts() to anon, authenticated;
grant execute on function public.current_member_profile(), public.pending_member_applications(),
  public.decide_member_application(uuid, boolean) to authenticated;
grant execute on function public.reserve_callsign_login(text), public.claim_member_mail(),
  public.finish_member_mail(uuid, uuid, boolean) to service_role;
