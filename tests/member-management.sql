-- Ejecutar como postgres. Los datos y cambios de prueba se revierten.
begin;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('20806000-2026-1109-0000-000000000001','admin-mgmt@example.invalid',now(),'{"full_name":"Admin QA","callsign":"MGTQA-ADMIN","squad":"ANS098"}'),
 ('20806000-2026-1109-0000-000000000002','member-mgmt@example.invalid',now(),'{"full_name":"Miembro QA","callsign":"MGTQA-MEMBER","squad":"ANS098"}'),
 ('20806000-2026-1109-0000-000000000003','pending-mgmt@example.invalid',null,'{"full_name":"Miembro QA","callsign":"MGTQA-PENDING","squad":"ANS098"}');
update members_private.profiles set status='approved' where callsign in ('MGTQA-ADMIN','MGTQA-MEMBER');
insert into members_private.administrators values ('20806000-2026-1109-0000-000000000001');
insert into members_private.portal_roles values ('qa_moderator','Moderador QA');

set local role authenticated;
select set_config('request.jwt.claim.sub','20806000-2026-1109-0000-000000000002',true);
do $$
begin
  begin
    perform public.portal_management_snapshot();
    raise exception 'Un miembro leyó la hoja administrativa';
  exception when insufficient_privilege then null; end;
  begin
    perform public.portal_manage_accounts('[]');
    raise exception 'Un miembro pudo editar cuentas';
  exception when insufficient_privilege then null; end;
end;
$$;

select set_config('request.jwt.claim.sub','20806000-2026-1109-0000-000000000001',true);
do $$
declare
  member constant text := '20806000-2026-1109-0000-000000000002';
  draft jsonb := jsonb_build_object('id',member,'revision',0,'expected_role','member','expected_state','ACTIVA',
    'expected_callsign','MGTQA-MEMBER','expected_squad','ANS098','role','qa_moderator','state','SUSPENDIDA');
begin
  if not (public.portal_management_snapshot()->'roles' @> '[{"code":"qa_moderator","label":"Moderador QA"}]') then
    raise exception 'El catálogo dinámico no se incluyó';
  end if;
  if not (public.portal_management_snapshot()->'members' @> '[{"callsign":"MGTQA-PENDING","state":"PENDIENTE","confirmed":false}]') then
    raise exception 'El estado pendiente no se incluyó';
  end if;
  begin
    perform public.portal_manage_accounts(jsonb_build_array(draft));
    raise exception 'Se permitió suspender sin motivo';
  exception when invalid_parameter_value then null; end;
  if public.portal_manage_accounts(jsonb_build_array(draft || '{"reason":"Motivo de prueba"}')) <> 1 then
    raise exception 'No se aplicó la suspensión';
  end if;
  if exists(select from public.portal_directory(null) where id=member::uuid) then
    raise exception 'La cuenta suspendida aparece en el directorio';
  end if;
  begin
    perform public.portal_manage_accounts(jsonb_build_array(draft || '{"reason":"Motivo repetido"}'));
    raise exception 'La propuesta vencida fue aceptada';
  exception when sqlstate 'PT409' then null; end;
end;
$$;
select set_config('request.jwt.claim.sub','20806000-2026-1109-0000-000000000002',true);
do $$
begin
  if not exists(select from public.current_member_profile() where status='suspended' and not is_admin) then
    raise exception 'La sesión anterior no reconoce la suspensión';
  end if;
  begin perform public.portal_own_profile(); raise exception 'La sesión suspendida pudo leer el perfil';
  exception when insufficient_privilege then null; end;
end;
$$;
select set_config('request.jwt.claim.sub','20806000-2026-1109-0000-000000000001',true);
do $$
declare
  member constant text := '20806000-2026-1109-0000-000000000002';
begin
  begin
    perform public.portal_manage_accounts('[{"id":"20806000-2026-1109-0000-000000000001","revision":0,"expected_role":"administrator","expected_state":"ACTIVA","expected_callsign":"MGTQA-ADMIN","expected_squad":"ANS098","role":"member"}]');
    raise exception 'Se permitió eliminar el propio acceso administrativo';
  exception when invalid_parameter_value then null; end;
  if public.portal_manage_accounts(jsonb_build_array(jsonb_build_object('id',member,'revision',1,
    'expected_role','qa_moderator','expected_state','SUSPENDIDA','expected_callsign','MGTQA-MEMBER',
    'expected_squad','ANS098','role','administrator','state','ACTIVA','squad','ANSG52'))) <> 1 then
    raise exception 'No se aplicó la reactivación';
  end if;
end;
$$;
reset role;
do $$
begin
  if (select count(*) from members_private.account_management_log where member_id='20806000-2026-1109-0000-000000000002'
    and administrator_id='20806000-2026-1109-0000-000000000001') <> 2 then raise exception 'Auditoría incompleta'; end if;
  if exists(select from auth.users where id='20806000-2026-1109-0000-000000000002' and banned_until is not null) then
    raise exception 'La reactivación dejó la restricción de acceso';
  end if;
end;
$$;
rollback;
