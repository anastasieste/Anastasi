create table members_private.portal_roles (
  code text primary key check (code ~ '^[a-z][a-z_]{1,30}$'),
  label text not null unique check (char_length(label) between 1 and 50)
);
insert into members_private.portal_roles values ('member','Miembro'), ('administrator','Administrador');
alter table members_private.portal_roles enable row level security;

alter table members_private.profiles
  add column member_role text not null default 'member' references members_private.portal_roles(code)
    check (member_role <> 'administrator'),
  add column suspended_at timestamptz,
  add column suspension_reason text,
  add column prior_auth_ban timestamptz,
  add column managed_auth_ban timestamptz,
  add column management_revision bigint not null default 0,
  add constraint portal_suspension_reason check (
    (suspended_at is null and suspension_reason is null)
    or (suspended_at is not null and suspension_reason is not null and char_length(btrim(suspension_reason)) between 1 and 1000)
  );

create table members_private.account_management_log (
  id bigint generated always as identity primary key,
  member_id uuid references auth.users(id) on delete set null,
  administrator_id uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  previous jsonb not null,
  updated jsonb not null
);
alter table members_private.account_management_log enable row level security;

create or replace function members_private.approved_member(member_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select from members_private.profiles p join auth.users u on u.id=p.user_id
    where p.user_id=member_id and p.status='approved' and u.email_confirmed_at is not null
      and p.suspended_at is null and (u.banned_until is null or u.banned_until <= now())
  );
$$;

create or replace function members_private.require_admin()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not members_private.approved_member(auth.uid()) or not exists (
    select from members_private.administrators a where a.user_id=auth.uid()
  ) then raise insufficient_privilege; end if;
end;
$$;

create or replace function public.current_member_profile()
returns table (callsign text, status text, is_admin boolean)
language sql stable security definer set search_path = '' as $$
  select p.callsign, case
    when p.suspended_at is not null or u.banned_until > now() then 'suspended'
    when p.status='approved' and u.email_confirmed_at is null then 'pending' else p.status end,
    members_private.approved_member(p.user_id)
      and exists (select from members_private.administrators a where a.user_id=p.user_id)
  from members_private.profiles p join auth.users u on u.id=p.user_id where p.user_id=auth.uid();
$$;

create or replace function public.active_squad_counts()
returns table (code text, member_count integer)
language sql stable security definer set search_path = '' as $$
  select p.squad, count(*)::integer from members_private.profiles p
  where members_private.approved_member(p.user_id) group by p.squad;
$$;

create or replace function public.portal_directory(squad_filter text default null)
returns table (id uuid, callsign text, squad text, has_avatar boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform members_private.require_member();
  return query select p.user_id, p.callsign, p.squad,
    exists (select from storage.objects o where o.bucket_id='member-avatars' and o.name=p.user_id::text || '/avatar')
  from members_private.profiles p
  where members_private.approved_member(p.user_id) and (squad_filter is null or p.squad=squad_filter)
  order by p.squad, lower(p.callsign), p.user_id;
end;
$$;

create or replace function public.portal_directory_profile(member_id uuid)
returns table (
  id uuid, callsign text, squad text, has_avatar boolean, full_name text, biography text, profile_details text,
  show_activity boolean
) language plpgsql stable security definer set search_path = '' as $$
begin
  perform members_private.require_member();
  return query select p.user_id, p.callsign, p.squad,
    exists (select from storage.objects o where o.bucket_id='member-avatars' and o.name=p.user_id::text || '/avatar'),
    case when p.show_full_name then p.full_name end,
    case when p.show_biography then nullif(p.biography,'') end,
    case when p.show_details then nullif(p.profile_details,'') end,
    p.show_activity
  from members_private.profiles p where p.user_id=member_id and members_private.approved_member(p.user_id);
end;
$$;

create view members_private.management_accounts as
select p.user_id as id, p.callsign, p.full_name, u.email::text as email, p.squad,
  case when a.user_id is not null then 'administrator' else p.member_role end as role,
  case when p.suspended_at is not null or u.banned_until > now() then 'SUSPENDIDA'
       when p.status='rejected' then 'RECHAZADA'
       when p.status='approved' and u.email_confirmed_at is not null then 'ACTIVA' else 'PENDIENTE' end as state,
  u.email_confirmed_at is not null as confirmed,
  p.suspension_reason, p.management_revision,
  p.suspended_at is not null as managed_suspension
from members_private.profiles p join auth.users u on u.id=p.user_id
left join members_private.administrators a on a.user_id=p.user_id;

create function public.portal_management_snapshot()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform members_private.require_admin();
  return jsonb_build_object(
    'members', coalesce((select jsonb_agg(to_jsonb(a) order by lower(a.callsign),a.id)
      from members_private.management_accounts a),'[]'::jsonb),
    'roles', (select jsonb_agg(to_jsonb(r) order by r.label) from members_private.portal_roles r),
    'squads', (select jsonb_agg(s.code order by s.code) from members_private.squads s)
  );
end;
$$;

create function public.portal_manage_accounts(changes jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  change jsonb;
  target uuid;
  prior members_private.management_accounts%rowtype;
  next_role text;
  next_state text;
  next_callsign text;
  next_squad text;
  reason text;
  ban_until timestamptz;
  processed integer := 0;
begin
  -- Serializa cambios de roles y suspensión entre administradores.
  perform pg_advisory_xact_lock(801109, 1);
  perform members_private.require_admin();
  if jsonb_typeof(changes) is distinct from 'array' or jsonb_array_length(changes) not between 1 and 100 then
    raise exception using errcode='22023', message='Selecciona de 1 a 100 cambios.';
  end if;
  if (select count(distinct value->>'id') from jsonb_array_elements(changes)) <> jsonb_array_length(changes) then
    raise exception using errcode='22023', message='Cada cuenta debe aparecer una sola vez.';
  end if;

  for change in select value from jsonb_array_elements(changes) loop
    target := (change->>'id')::uuid;
    perform from auth.users u join members_private.profiles p on p.user_id=u.id
    where u.id=target for update of u,p;
    select a.* into prior from members_private.management_accounts a where a.id=target;
    if not found or prior.management_revision is distinct from (change->>'revision')::bigint
      or prior.role is distinct from change->>'expected_role' or prior.state is distinct from change->>'expected_state'
      or prior.callsign is distinct from change->>'expected_callsign' or prior.squad is distinct from change->>'expected_squad' then
      raise exception using errcode='PT409', message='La cuenta cambió. Actualiza la hoja y vuelve a preparar el cambio.';
    end if;
    if prior.state not in ('ACTIVA','SUSPENDIDA') or (prior.state='SUSPENDIDA' and not prior.managed_suspension) then
      raise exception using errcode='22023', message='Solo se gestionan cuentas aprobadas y suspensiones aplicadas desde este panel.';
    end if;
    next_role := coalesce(nullif(change->>'role',''),prior.role);
    next_state := coalesce(nullif(change->>'state',''),prior.state);
    next_callsign := coalesce(nullif(btrim(change->>'callsign'),''),prior.callsign);
    next_squad := coalesce(nullif(btrim(change->>'squad'),''),prior.squad);
    reason := nullif(btrim(change->>'reason'),'');
    if next_state not in ('ACTIVA','SUSPENDIDA') or not exists (select from members_private.portal_roles r where r.code=next_role) then
      raise exception using errcode='22023', message='El rol o estado no está disponible.';
    end if;
    if target=auth.uid() and (next_role<>'administrator' or next_state<>'ACTIVA') then
      raise exception using errcode='22023', message='Otro administrador debe cambiar tu rol o suspender tu cuenta.';
    end if;
    if next_state='SUSPENDIDA' and prior.state<>'SUSPENDIDA' and (reason is null or char_length(reason)>1000) then
      raise exception using errcode='22023', message='La suspensión requiere un motivo de 1 a 1000 caracteres.';
    end if;
    if (next_role,next_state,next_callsign,next_squad) is not distinct from (prior.role,prior.state,prior.callsign,prior.squad) then continue; end if;

    if next_state='SUSPENDIDA' and prior.state='ACTIVA' then
      ban_until := now() + interval '100 years';
      update members_private.profiles p set suspended_at=now(), suspension_reason=reason,
        prior_auth_ban=(select u.banned_until from auth.users u where u.id=target), managed_auth_ban=ban_until
      where p.user_id=target;
      update auth.users u set banned_until=ban_until where u.id=target;
    elsif next_state='ACTIVA' and prior.state='SUSPENDIDA' then
      update auth.users u set banned_until=p.prior_auth_ban
      from members_private.profiles p where u.id=target and p.user_id=target
        and u.banned_until is not distinct from p.managed_auth_ban;
      if exists (select from auth.users u where u.id=target and u.banned_until > now()) then
        raise exception using errcode='22023', message='La cuenta tiene otra restricción activa en Supabase.';
      end if;
      update members_private.profiles p set suspended_at=null, suspension_reason=null,
        prior_auth_ban=null, managed_auth_ban=null where p.user_id=target;
    end if;

    if next_role='administrator' then
      insert into members_private.administrators(user_id) values (target) on conflict do nothing;
    else
      delete from members_private.administrators a where a.user_id=target;
    end if;
    update members_private.profiles p set callsign=next_callsign, squad=next_squad,
      member_role=case when next_role='administrator' then 'member' else next_role end,
      management_revision=management_revision+1 where p.user_id=target;
    insert into members_private.account_management_log(member_id,administrator_id,previous,updated)
    select target, auth.uid(),
      jsonb_build_object('role',prior.role,'state',prior.state,'callsign',prior.callsign,'squad',prior.squad,'reason',prior.suspension_reason),
      jsonb_build_object('role',a.role,'state',a.state,'callsign',a.callsign,'squad',a.squad,'reason',a.suspension_reason)
    from members_private.management_accounts a where a.id=target;
    processed := processed+1;
  end loop;
  return processed;
end;
$$;

revoke all on function public.portal_management_snapshot(), public.portal_manage_accounts(jsonb) from public,anon,authenticated;
grant execute on function public.portal_management_snapshot(), public.portal_manage_accounts(jsonb) to authenticated;
