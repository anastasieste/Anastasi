-- Ejecutar como postgres. Los datos de prueba se revierten.
begin;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('76700000-0000-4000-8000-000000000001','video-admin@example.invalid',now(),'{"full_name":"Admin QA","callsign":"VIDEO-QA-ADMIN","squad":"ANS098"}'),
 ('76700000-0000-4000-8000-000000000002','video-author@example.invalid',now(),'{"full_name":"Autor QA","callsign":"VIDEO-QA-AUTHOR","squad":"ANS098"}'),
 ('76700000-0000-4000-8000-000000000003','video-member@example.invalid',now(),'{"full_name":"Lector QA","callsign":"VIDEO-QA-READER","squad":"ANS098"}');
update members_private.profiles set status='approved' where callsign like 'VIDEO-QA-%';
insert into members_private.administrators values ('76700000-0000-4000-8000-000000000001');
insert into members_private.videos(id,author_id,title,bytes,drive_id,status,submitted_at) values
 ('76700000-0000-4000-8000-000000000011','76700000-0000-4000-8000-000000000002','Video aprobado QA',500,'fixture-approval','pending',now()),
 ('76700000-0000-4000-8000-000000000012','76700000-0000-4000-8000-000000000002','Video rechazado QA',600,'fixture-rejection','pending',now());

set local role anon;
do $$ begin
  if exists (select from public.portal_public_videos() where id::text like '76700000-%') then
    raise exception 'Un video pendiente se hizo público';
  end if;
  begin
    perform public.portal_video_service('get','{"id":"76700000-0000-4000-8000-000000000011"}');
    raise exception 'Acceso anónimo a datos de Drive';
  exception when insufficient_privilege then null; end;
  begin
    perform public.portal_video_gallery(array['fixture-approval']);
    raise exception 'Acceso anónimo a la consulta interna de Drive';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','76700000-0000-4000-8000-000000000002',true);
do $$ begin
  if public.portal_video_notice() is distinct from true or public.portal_video_notice(false) is distinct from false then
    raise exception 'El aviso inicial o su desactivación fallaron';
  end if;
  if public.portal_video_notice() is distinct from false or public.portal_video_notice(true) is distinct from true then
    raise exception 'La preferencia no persistió o no se puede reactivar';
  end if;
  begin
    perform public.portal_video_queue();
    raise exception 'Un miembro vio la cola administrativa';
  exception when insufficient_privilege then null; end;
  begin
    perform public.portal_video_service('get','{}');
    raise exception 'Un miembro pudo invocar el servicio privado';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','76700000-0000-4000-8000-000000000001',true);
do $$ begin
  if (select count(*) from public.portal_video_queue() where id::text like '76700000-%') <> 2 then
    raise exception 'El administrador no recibió la cola';
  end if;
end $$;
reset role;

set local role service_role;
do $$
declare
  first_video jsonb := '{"id":"76700000-0000-4000-8000-000000000011","actor":"76700000-0000-4000-8000-000000000001","decision":"approved"}';
  second_video jsonb := '{"id":"76700000-0000-4000-8000-000000000012","actor":"76700000-0000-4000-8000-000000000001","decision":"rejected"}';
begin
  if public.portal_video_service('claim',first_video || '{"actor":"76700000-0000-4000-8000-000000000002"}') is not null then
    raise exception 'Un miembro pudo tomar una decisión';
  end if;
  if public.portal_video_service('claim',first_video)->>'decision' is distinct from 'approved'
    or public.portal_video_service('claim',first_video || '{"decision":"rejected"}') is not null
    or public.portal_video_service('decide',first_video)->>'status' is distinct from 'approved' then
    raise exception 'Falló el bloqueo de decisión';
  end if;
  perform public.portal_video_service('claim',second_video);
  if public.portal_video_service('decide',second_video)->>'status' is distinct from 'rejected' then
    raise exception 'El rechazo no quedó registrado';
  end if;
  if public.portal_video_service('expired','{}') @> '[{"id":"76700000-0000-4000-8000-000000000012"}]' then
    raise exception 'El video podría purgarse antes de siete días';
  end if;
end $$;
reset role;
update members_private.videos set decided_at=now()-interval '7 days' where drive_id='fixture-rejection';
set local role service_role;
do $$ begin
  if not public.portal_video_service('expired','{}') @> '[{"id":"76700000-0000-4000-8000-000000000012"}]' then
    raise exception 'El rechazo vencido no quedó disponible para la limpieza';
  end if;
  if public.portal_video_service('purged','{"id":"76700000-0000-4000-8000-000000000012"}')->>'status' is distinct from 'rejected' then
    raise exception 'La limpieza perdió el registro del rechazo';
  end if;
end $$;
reset role;
set local role anon;
do $$ begin
  if (select count(*) from public.portal_public_videos() where id::text like '76700000-%') <> 1 then
    raise exception 'La galería no distingue los estados';
  end if;
end $$;
reset role;
set local role service_role;
do $$ begin
  if (select count(*) from public.portal_video_gallery(array['fixture-approval', 'fixture-rejection'])) <> 1
     or exists (select from public.portal_video_gallery(array['fixture-rejection'])) then
    raise exception 'La galería debe filtrar por estado y presencia en Drive';
  end if;
  if not exists (select from public.portal_video_gallery(array['fixture-approval']) where not has_cover) then
    raise exception 'Los videos publicados antes de las carátulas deben seguir apareciendo';
  end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','76700000-0000-4000-8000-000000000003',true);
do $$ begin
  if exists(select from public.portal_profile_videos('76700000-0000-4000-8000-000000000002')) then
    raise exception 'La actividad privada apareció en otro perfil';
  end if;
end $$;
select set_config('request.jwt.claim.sub','76700000-0000-4000-8000-000000000002',true);
do $$ begin
  if (select count(*) from public.portal_profile_videos('76700000-0000-4000-8000-000000000002')) <> 1 then
    raise exception 'El autor no pudo consultar su actividad';
  end if;
end $$;
rollback;
