alter table members_private.videos add column mime_type text not null default 'video/mp4'
  check (mime_type in ('video/mp4','image/jpeg','image/png','image/webp'));
alter table members_private.videos add constraint content_photo_limits
  check (mime_type='video/mp4' or (bytes <= 10485760 and cover is null));

create function public.portal_content_start(input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  result jsonb;
  actor_id uuid := (input->>'actor')::uuid;
begin
  if not members_private.approved_member(actor_id) then return null; end if;
  result := public.portal_video_start_with_cover(input);
  if result ? 'id' then
    update members_private.videos set mime_type=input->>'mime_type' where id=(result->>'id')::uuid;
  end if;
  return result;
end;
$$;

create function public.portal_content_queue()
returns table (id uuid, title text, callsign text, bytes integer, submitted_at timestamptz, decision text, mime_type text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform members_private.require_admin();
  return query
    select v.id, v.title, coalesce(p.callsign, 'Cuenta eliminada'), v.bytes, v.submitted_at, v.decision, v.mime_type
    from members_private.videos v left join members_private.profiles p on p.user_id=v.author_id
    where v.status='pending' order by v.submitted_at, v.id limit 100;
end;
$$;

create function public.portal_photo_gallery(drive_ids text[])
returns table (id uuid)
language sql stable security definer set search_path = '' as $$
  select v.id from members_private.videos v
  where v.status='approved' and v.mime_type<>'video/mp4' and v.drive_id=any(drive_ids)
  order by v.decided_at desc, v.id limit 100;
$$;

create or replace function public.portal_video_gallery(drive_ids text[])
returns table (id uuid, title text, has_cover boolean)
language sql stable security definer set search_path = '' as $$
  select v.id, v.title, v.cover is not null from members_private.videos v
  where v.status='approved' and v.mime_type='video/mp4' and v.drive_id=any(drive_ids)
  order by v.decided_at desc, v.id limit 100;
$$;

create or replace function public.portal_public_videos()
returns table (id uuid, title text, published_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select v.id, v.title, v.decided_at from members_private.videos v
  where v.status='approved' and v.mime_type='video/mp4' order by v.decided_at desc limit 100;
$$;

create or replace function public.portal_profile_videos(member_id uuid)
returns table (id uuid, title text, published_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select v.id, v.title, v.decided_at
  from members_private.videos v join members_private.profiles p on p.user_id=v.author_id
  where v.status='approved' and v.mime_type='video/mp4' and v.author_id=member_id
    and members_private.approved_member(p.user_id) and members_private.approved_member(auth.uid())
    and (p.user_id=auth.uid() or p.show_activity)
  order by v.decided_at desc limit 100;
$$;

create or replace function public.portal_video_queue()
returns table (id uuid, title text, callsign text, bytes integer, submitted_at timestamptz, decision text)
language sql stable security invoker set search_path = '' as $$
  select c.id, c.title, c.callsign, c.bytes, c.submitted_at, c.decision
  from public.portal_content_queue() c where c.mime_type='video/mp4';
$$;

create function public.portal_content_service(operation text, input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := (input->>'actor')::uuid;
begin
  if operation='eligible' then return to_jsonb(members_private.approved_member(actor_id)); end if;
  if operation='can_review' then
    return to_jsonb(members_private.approved_member(actor_id) and exists (
      select 1 from members_private.administrators a where a.user_id=actor_id
    ));
  end if;
  if operation='expired' then
    return coalesce((
      select jsonb_agg(to_jsonb(expired)) from (
        select v.id, v.drive_id, v.mime_type, v.status from members_private.videos v
        where v.deleted_at is null and (
          (v.status='rejected' and v.decided_at <= now() - interval '7 days')
          or (v.status='uploading' and v.created_at <= now() - interval '2 days')
        ) order by v.created_at limit 40
      ) expired
    ), '[]'::jsonb);
  end if;
  return public.portal_video_service(operation,input);
end;
$$;

revoke all on function public.portal_content_start(jsonb), public.portal_photo_gallery(text[]),
  public.portal_content_service(text,jsonb), public.portal_content_queue() from public, anon, authenticated;
grant execute on function public.portal_content_start(jsonb), public.portal_photo_gallery(text[]),
  public.portal_content_service(text,jsonb) to service_role;
grant execute on function public.portal_content_queue() to authenticated;
notify pgrst, 'reload schema';
