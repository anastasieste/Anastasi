-- Ejecutar como postgres después de aplicar las migraciones. Las cuentas y decisiones se revierten.
begin;

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values
 ('80efec28-b2ac-450a-9868-7ab049fc2001','admin@example.invalid',now(),'{"full_name":"Admin QA","callsign":"PORTALQA-ADMIN","squad":"ANS098"}'),
 ('80efec28-b2ac-450a-9868-7ab049fc2002','member@example.invalid',now(),'{"full_name":"Miembro QA","callsign":"PORTALQA-MEMBER","squad":"ANS098"}'),
 ('80efec28-b2ac-450a-9868-7ab049fc2003','accept@example.invalid',now(),'{"full_name":"Candidato QA","callsign":"PORTALQA-ACCEPT","squad":"ANSG52"}'),
 ('80efec28-b2ac-450a-9868-7ab049fc2004','reject@example.invalid',now(),'{"full_name":"Candidato QA","callsign":"PORTALQA-REJECT","squad":"ANSG52"}'),
 ('80efec28-b2ac-450a-9868-7ab049fc2005','unverified@example.invalid',null,'{"full_name":"Candidato QA","callsign":"PORTALQA-NOTVERIFIED","squad":"ANSG52"}');
update members_private.profiles set status='approved'
where user_id in ('80efec28-b2ac-450a-9868-7ab049fc2001','80efec28-b2ac-450a-9868-7ab049fc2002');
insert into members_private.administrators values ('80efec28-b2ac-450a-9868-7ab049fc2001');

set local role anon;
do $$
begin
  begin perform public.portal_directory(null); raise exception 'Anónimo pudo consultar el directorio';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','80efec28-b2ac-450a-9868-7ab049fc2003',true);
do $$
begin
  begin perform public.portal_directory(null); raise exception 'Cuenta pendiente pudo consultar el directorio';
  exception when insufficient_privilege then null; end;
  begin
    insert into storage.objects (bucket_id,name) values ('member-avatars',auth.uid()::text || '/avatar');
    raise exception 'Cuenta pendiente pudo subir un avatar';
  exception when insufficient_privilege then null; end;
end;
$$;

select set_config('request.jwt.claim.sub','80efec28-b2ac-450a-9868-7ab049fc2002',true);
do $$
declare
  target constant uuid := '80efec28-b2ac-450a-9868-7ab049fc2001';
begin
  if (select email from public.portal_own_profile()) is distinct from 'member@example.invalid' then
    raise exception 'El correo propio no se recuperó correctamente';
  end if;
  if (select full_name from public.portal_directory_profile(target)) is not null then
    raise exception 'El nombre real no es privado por defecto';
  end if;
  if exists(select from public.portal_directory(null) where id='80efec28-b2ac-450a-9868-7ab049fc2003') then
    raise exception 'Una cuenta pendiente apareció en el directorio';
  end if;
  perform public.portal_update_profile('Miembro QA','Biografía privada','Detalle privado');
  perform public.portal_update_privacy(true,false,false,false);
  begin perform public.portal_admin_edit_member(target,'OTRO','ANS098'); raise exception 'Edición ajena permitida';
  exception when insufficient_privilege then null; end;
  begin perform public.pending_member_applications(); raise exception 'Listado administrativo expuesto';
  exception when insufficient_privilege then null; end;
  begin perform public.portal_application_history(); raise exception 'Notas administrativas expuestas';
  exception when insufficient_privilege then null; end;
  begin perform public.decide_member_application(target,true,'Nota'); raise exception 'Decisión no autorizada';
  exception when insufficient_privilege then null; end;
  insert into storage.objects (bucket_id,name) values ('member-avatars',auth.uid()::text || '/avatar');
  if not (select has_avatar from public.portal_own_profile()) then raise exception 'Avatar propio ausente'; end if;
  begin
    insert into storage.objects (bucket_id,name) values ('member-avatars',target::text || '/avatar');
    raise exception 'Subida ajena permitida';
  exception when insufficient_privilege then null; end;
end;
$$;

select set_config('request.jwt.claim.sub','80efec28-b2ac-450a-9868-7ab049fc2001',true);
do $$
declare
  member constant uuid := '80efec28-b2ac-450a-9868-7ab049fc2002';
  accepted constant uuid := '80efec28-b2ac-450a-9868-7ab049fc2003';
  rejected constant uuid := '80efec28-b2ac-450a-9868-7ab049fc2004';
  visible record;
begin
  select * into visible from public.portal_directory_profile(member);
  if visible.full_name is not null or visible.profile_details is not null or visible.show_activity
    or visible.biography is distinct from 'Biografía privada' or not visible.has_avatar then
    raise exception 'El perfil compartido no respetó las preferencias';
  end if;
  if not exists (select from storage.objects where bucket_id='member-avatars' and name=member::text || '/avatar') then
    raise exception 'El directorio no pudo leer el avatar';
  end if;
  update storage.objects set name=name where bucket_id='member-avatars' and name=member::text || '/avatar';
  if found then raise exception 'Se pudo cambiar un avatar ajeno'; end if;
  if (select count(*) from public.pending_member_applications() where id in (accepted,rejected)) <> 2 then
    raise exception 'No aparecieron ambas solicitudes confirmadas';
  end if;
  perform public.decide_member_application(accepted,true,'Nota de aprobación');
  perform public.decide_member_application(rejected,false,'Nota de rechazo');
  begin perform public.decide_member_application(accepted,false,'Duplicada'); raise exception 'Se permitió una decisión duplicada';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform public.decide_member_application('80efec28-b2ac-450a-9868-7ab049fc2005',true,'No confirmada');
    raise exception 'Se aceptó una cuenta sin correo confirmado';
  exception when sqlstate 'PT409' then null; end;
  if not exists(select from public.portal_application_history() where id=accepted and note='Nota de aprobación'
    and administrator='PORTALQA-ADMIN' and decided_at is not null) then raise exception 'Nota o autor de decisión ausente'; end if;
  perform public.portal_admin_edit_member(member,'PORTALQA-NEW','ANSG52');
end;
$$;
reset role;

do $$
begin
  if not exists (select from members_private.member_edits where old_callsign='PORTALQA-MEMBER'
    and new_callsign='PORTALQA-NEW' and new_squad='ANSG52' and changed_at is not null) then
    raise exception 'Edición administrativa sin auditoría';
  end if;
  if (select count(*) from members_private.outbox where
    (kind='approved' and recipient='accept@example.invalid') or (kind='rejected' and recipient='reject@example.invalid')) <> 2 then
    raise exception 'Faltan notificaciones de decisión';
  end if;
end;
$$;
rollback;
