alter table members_private.profiles add column management_note text not null default ''
  check (char_length(management_note) <= 1000);

create or replace view members_private.management_accounts as
select p.user_id as id, p.callsign, p.full_name, u.email::text as email, p.squad,
  case when a.user_id is not null then 'administrator' else p.member_role end as role,
  case when p.suspended_at is not null or u.banned_until > now() then 'SUSPENDIDA'
       when p.status='rejected' then 'RECHAZADA'
       when p.status='approved' and u.email_confirmed_at is not null then 'ACTIVA' else 'PENDIENTE' end as state,
  u.email_confirmed_at is not null as confirmed,
  p.suspension_reason, p.management_revision, p.suspended_at is not null as managed_suspension,
  p.management_note
from members_private.profiles p join auth.users u on u.id=p.user_id
left join members_private.administrators a on a.user_id=p.user_id;

create or replace function public.portal_manage_accounts(changes jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  change jsonb;
  target uuid;
  prior members_private.management_accounts%rowtype;
  next_role text;
  next_state text;
  next_callsign text;
  next_squad text;
  next_note text;
  reason text;
  ban_until timestamptz;
  processed integer := 0;
begin
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
      raise exception using errcode='PT409', message='La cuenta cambió. Recarga la página y vuelve a preparar el cambio.';
    end if;

    next_role := coalesce(nullif(change->>'role',''),prior.role);
    next_state := coalesce(nullif(change->>'state',''),prior.state);
    next_callsign := coalesce(nullif(btrim(change->>'callsign'),''),prior.callsign);
    next_squad := coalesce(nullif(btrim(change->>'squad'),''),prior.squad);
    next_note := coalesce(btrim(change->>'note'),prior.management_note);
    reason := case when next_state='SUSPENDIDA' then
      case when change ? 'reason' then nullif(btrim(change->>'reason'),'') else prior.suspension_reason end
    end;
    if (change ? 'note' and jsonb_typeof(change->'note') is distinct from 'string') or char_length(next_note)>1000 then
      raise exception using errcode='22023', message='La nota admite hasta 1000 caracteres.';
    end if;
    if (next_role,next_state,next_callsign,next_squad,reason) is distinct from
      (prior.role,prior.state,prior.callsign,prior.squad,prior.suspension_reason) then
      if prior.state not in ('ACTIVA','SUSPENDIDA') or (prior.state='SUSPENDIDA' and not prior.managed_suspension) then
        raise exception using errcode='22023', message='El rol o estado de esta cuenta no se puede cambiar aquí.';
      end if;
      if next_state not in ('ACTIVA','SUSPENDIDA') or not exists (select from members_private.portal_roles r where r.code=next_role) then
        raise exception using errcode='22023', message='El rol o estado no está disponible.';
      end if;
      if target=auth.uid() and (next_role<>'administrator' or next_state<>'ACTIVA') then
        raise exception using errcode='22023', message='Otro administrador debe cambiar tu rol o suspender tu cuenta.';
      end if;
      if next_state='SUSPENDIDA' and (reason is null or char_length(reason)>1000) then
        raise exception using errcode='22023', message='La suspensión requiere un motivo de 1 a 1000 caracteres.';
      end if;
    elsif next_note is not distinct from prior.management_note then
      continue;
    end if;

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

    if next_role is distinct from prior.role then
      if next_role='administrator' then
        insert into members_private.administrators(user_id) values (target) on conflict do nothing;
      else
        delete from members_private.administrators a where a.user_id=target;
      end if;
    end if;
    update members_private.profiles p set callsign=next_callsign, squad=next_squad,
      member_role=case when next_role='administrator' then 'member' else next_role end,
      suspension_reason=reason, management_note=next_note, management_revision=management_revision+1 where p.user_id=target;
    insert into members_private.account_management_log(member_id,administrator_id,previous,updated)
    select target, auth.uid(),
      jsonb_build_object('role',prior.role,'state',prior.state,'callsign',prior.callsign,'squad',prior.squad,'reason',prior.suspension_reason,'note',prior.management_note),
      jsonb_build_object('role',a.role,'state',a.state,'callsign',a.callsign,'squad',a.squad,'reason',a.suspension_reason,'note',a.management_note)
    from members_private.management_accounts a where a.id=target;
    processed := processed+1;
  end loop;
  return processed;
end;
$$;
