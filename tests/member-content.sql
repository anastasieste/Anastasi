begin;

insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('7c57cc03-326c-4343-b246-13b81abce001','content-qa@example.invalid',now(),
  '{"full_name":"Contenido QA","callsign":"CONTENTQA","squad":"ANS098"}'),
 ('7c57cc03-326c-4343-b246-13b81abce002','content-admin@example.invalid',now(),
  '{"full_name":"Moderador QA","callsign":"CONTENTQA-ADMIN","squad":"ANS098"}');
update members_private.profiles set status='approved' where callsign like 'CONTENTQA%';
insert into members_private.administrators values ('7c57cc03-326c-4343-b246-13b81abce002');

do $$
declare
  owner constant uuid := '7c57cc03-326c-4343-b246-13b81abce001';
  admin constant uuid := '7c57cc03-326c-4343-b246-13b81abce002';
  upload jsonb := jsonb_build_object('actor',owner,'title','Foto de prueba','bytes',750,'drive_id','content-qa-photo','upload_url','upload','mime_type','image/png');
  photo uuid;
begin
  photo := (public.portal_content_start(upload)->>'id')::uuid;
  if photo is null then raise exception 'Faltó el envío de la foto'; end if;
  perform public.portal_content_service('submit',jsonb_build_object('id',photo,'actor',owner));
  if exists(select from public.portal_photo_gallery(array['content-qa-photo'])) then raise exception 'Foto pendiente en la galería'; end if;
  if public.portal_content_service('claim',jsonb_build_object('id',photo,'actor',owner,'decision','approved')) is not null then
    raise exception 'Un miembro aprobó su envío';
  end if;
  perform public.portal_content_service('claim',jsonb_build_object('id',photo,'actor',admin,'decision','approved'));
  perform public.portal_content_service('decide',jsonb_build_object('id',photo,'decision','approved'));
  if not exists(select from public.portal_photo_gallery(array['content-qa-photo']) where id=photo)
    or exists(select from public.portal_photo_gallery(array[]::text[]))
    or exists(select from public.portal_public_videos() where id=photo) then
    raise exception 'La foto aprobada no respeta los filtros de publicación';
  end if;

  photo := (public.portal_content_start(upload || '{"drive_id":"content-qa-rejected"}')->>'id')::uuid;
  perform public.portal_content_service('submit',jsonb_build_object('id',photo,'actor',owner));
  perform public.portal_content_service('claim',jsonb_build_object('id',photo,'actor',admin,'decision','rejected'));
  perform public.portal_content_service('decide',jsonb_build_object('id',photo,'decision','rejected'));
  update members_private.videos set decided_at=now()-interval '6 days' where id=photo;
  if public.portal_content_service('expired','{}') @> jsonb_build_array(jsonb_build_object('id',photo)) then
    raise exception 'La foto venció antes de siete días';
  end if;
  update members_private.videos set decided_at=now()-interval '7 days' where id=photo;
  if not public.portal_content_service('expired','{}') @> jsonb_build_array(jsonb_build_object('id',photo,'mime_type','image/png','status','rejected')) then
    raise exception 'La foto rechazada no llegó a la limpieza';
  end if;
end;
$$;

set local role anon;
do $$
begin
  begin perform public.portal_content_queue(); raise exception 'La cola está abierta a visitantes';
  exception when insufficient_privilege then null; end;
  begin perform public.portal_photo_gallery(array['content-qa-photo']); raise exception 'Se expuso la resolución de fotos por ID de Drive';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
rollback;
