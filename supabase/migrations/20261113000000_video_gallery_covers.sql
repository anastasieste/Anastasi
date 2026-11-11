alter table members_private.videos
  add column cover text check (cover like 'data:image/jpeg;base64,%' and length(cover) <= 80023);

create function public.portal_video_start_with_cover(input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  result := public.portal_video_service('start', input - 'cover');
  if result ? 'id' and input->>'cover' is not null then
    update members_private.videos set cover=input->>'cover' where id=(result->>'id')::uuid;
  end if;
  return result;
end;
$$;

create function public.portal_video_gallery(drive_ids text[])
returns table (id uuid, title text, has_cover boolean)
language sql stable security definer set search_path = '' as $$
  select v.id, v.title, v.cover is not null
  from members_private.videos v
  where v.status='approved' and v.drive_id=any(drive_ids)
  order by v.decided_at desc, v.id
  limit 100;
$$;

revoke all on function public.portal_video_start_with_cover(jsonb), public.portal_video_gallery(text[])
  from public, anon, authenticated;
grant execute on function public.portal_video_start_with_cover(jsonb), public.portal_video_gallery(text[])
  to service_role;
