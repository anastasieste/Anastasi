-- Ejecutar como postgres después de aplicar las migraciones. Los datos se revierten.
begin;

insert into auth.users (id,email,email_confirmed_at,raw_user_meta_data)
values
 ('235a160b-42c0-4524-a543-c6faecc25101','roster-owner@example.invalid',now(),' {"full_name":"Avatar QA","callsign":"ROSTERQA-OWNER","squad":"ANS098"}'),
 ('235a160b-42c0-4524-a543-c6faecc25102','roster-viewer@example.invalid',now(),' {"full_name":"Visitante QA","callsign":"ROSTERQA-VIEWER","squad":"ANS456"}'),
 ('235a160b-42c0-4524-a543-c6faecc25103','roster-pending@example.invalid',now(),' {"full_name":"Pendiente QA","callsign":"ROSTERQA-PENDING","squad":"ANS098"}'),
 ('235a160b-42c0-4524-a543-c6faecc25104','roster-suspended@example.invalid',now(),' {"full_name":"Suspendido QA","callsign":"ROSTERQA-SUSPENDED","squad":"ANS098"}');
update members_private.profiles set status='approved'
where callsign in ('ROSTERQA-OWNER','ROSTERQA-VIEWER','ROSTERQA-SUSPENDED');
update members_private.profiles set suspended_at=now(), suspension_reason='Prueba'
where callsign='ROSTERQA-SUSPENDED';
insert into storage.objects (bucket_id,name) values ('member-avatars','235a160b-42c0-4524-a543-c6faecc25101/avatar');

set local role anon;
do $$
begin
  if (select jsonb_agg(to_jsonb(r)) from public.portal_public_squad_roster('ANS098') r where r.callsign like 'ROSTERQA-%')
    is distinct from '[{"callsign":"ROSTERQA-OWNER","has_avatar":true}]'::jsonb then
    raise exception 'La lista pública mostró campos inesperados o integrantes sin membresía activa';
  end if;
  begin perform public.portal_public_avatar('ANS098','ROSTERQA-OWNER'); raise exception 'Se expuso la ruta interna del avatar';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;

set local role service_role;
do $$
begin
  if public.portal_public_avatar('ANS098','ROSTERQA-OWNER') is distinct from '235a160b-42c0-4524-a543-c6faecc25101/avatar'
    or public.portal_public_avatar('ANS456','ROSTERQA-OWNER') is not null then
    raise exception 'La ruta interna no coincide con el integrante o el escuadrón';
  end if;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','235a160b-42c0-4524-a543-c6faecc25101',true);
select public.portal_update_privacy(false,false,false,false,false);
select public.portal_update_privacy(false,false,false,false);
do $$
begin
  if not exists(select from public.portal_own_profile() where has_avatar and not show_avatar)
    or not exists(select from storage.objects where bucket_id='member-avatars' and name=auth.uid()::text || '/avatar') then
    raise exception 'El titular perdió acceso a su avatar o una versión anterior restableció el ajuste';
  end if;
  if not exists(select from public.portal_public_squad_roster('ANS098') where callsign='ROSTERQA-OWNER' and not has_avatar) then
    raise exception 'El ajuste de avatar no se reflejó en el directorio público';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub','235a160b-42c0-4524-a543-c6faecc25102',true);
do $$
declare target_profile_id constant uuid := '235a160b-42c0-4524-a543-c6faecc25101';
begin
  if not exists(select from public.portal_directory('ANS098') where id=target_profile_id and not has_avatar)
    or not exists(select from public.portal_directory_profile(target_profile_id) where not has_avatar)
    or exists(select from storage.objects where bucket_id='member-avatars' and name=target_profile_id::text || '/avatar') then
    raise exception 'El directorio privado, el perfil o Storage revelaron un avatar oculto';
  end if;
end;
$$;
reset role;

set local role service_role;
do $$
begin
  if public.portal_public_avatar('ANS098','ROSTERQA-OWNER') is not null then
    raise exception 'El servidor siguió resolviendo un avatar oculto';
  end if;
end;
$$;
reset role;
rollback;
