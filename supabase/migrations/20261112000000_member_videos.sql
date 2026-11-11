alter table members_private.profiles
  add column show_video_notice boolean not null default true;

create table members_private.videos (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references members_private.profiles(user_id) on delete set null,
  title text not null check (length(title) between 1 and 100),
  bytes integer not null check (bytes between 1 and 104857600),
  drive_id text not null unique,
  upload_url text,
  status text not null default 'uploading' check (status in ('uploading', 'pending', 'approved', 'rejected', 'abandoned')),
  decision text check (decision in ('approved', 'rejected')),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  decided_at timestamptz,
  decided_by uuid references members_private.profiles(user_id) on delete set null,
  deleted_at timestamptz
);
alter table members_private.videos enable row level security;
revoke all on members_private.videos from public, anon, authenticated;
create index videos_author_status on members_private.videos(author_id, status, created_at);
create index videos_status_date on members_private.videos(status, decided_at, created_at);

create function public.portal_video_notice(show_notice boolean default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare result boolean;
begin
  if show_notice is null then
    select p.show_video_notice into result from members_private.profiles p
      where p.user_id=auth.uid() and p.status='approved';
  else
    update members_private.profiles p set show_video_notice=show_notice
      where p.user_id=auth.uid() and p.status='approved' returning p.show_video_notice into result;
  end if;
  if result is null then raise exception 'Se requiere una membresía activa' using errcode='42501'; end if;
  return result;
end;
$$;
revoke all on function public.portal_video_notice(boolean) from public, anon;
grant execute on function public.portal_video_notice(boolean) to authenticated;

create function public.portal_public_videos()
returns table (id uuid, title text, published_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select v.id, v.title, v.decided_at from members_private.videos v
  where v.status='approved' order by v.decided_at desc limit 100;
$$;
revoke all on function public.portal_public_videos() from public;
grant execute on function public.portal_public_videos() to anon, authenticated;

create function public.portal_profile_videos(member_id uuid)
returns table (id uuid, title text, published_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select v.id, v.title, v.decided_at
  from members_private.videos v join members_private.profiles p on p.user_id=v.author_id
  where v.status='approved' and v.author_id=member_id and p.status='approved'
    and (p.user_id=auth.uid() or p.show_activity)
    and exists (select 1 from members_private.profiles viewer where viewer.user_id=auth.uid() and viewer.status='approved')
  order by v.decided_at desc limit 100;
$$;
revoke all on function public.portal_profile_videos(uuid) from public, anon;
grant execute on function public.portal_profile_videos(uuid) to authenticated;

create function public.portal_video_queue()
returns table (id uuid, title text, callsign text, bytes integer, submitted_at timestamptz, decision text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform members_private.require_admin();
  return query
    select v.id, v.title, coalesce(p.callsign, 'Cuenta eliminada'), v.bytes, v.submitted_at, v.decision
    from members_private.videos v left join members_private.profiles p on p.user_id=v.author_id
    where v.status='pending' order by v.submitted_at limit 100;
end;
$$;
revoke all on function public.portal_video_queue() from public, anon;
grant execute on function public.portal_video_queue() to authenticated;

-- Exclusivo del servicio que custodia las credenciales y las URLs de Drive.
create function public.portal_video_service(operation text, input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  video_id uuid := (input->>'id')::uuid;
  actor uuid := (input->>'actor')::uuid;
  requested text := input->>'decision';
  current_video members_private.videos;
begin
  if operation='can_review' then
    return to_jsonb(exists (
      select 1 from members_private.administrators a join members_private.profiles p on p.user_id=a.user_id
      where a.user_id=actor and p.status='approved'
    ));
  elsif operation='eligible' then
    return to_jsonb(exists (select 1 from members_private.profiles p where p.user_id=actor and p.status='approved'));
  elsif operation='expired' then
    return coalesce((
      select jsonb_agg(to_jsonb(expired)) from (
        select v.id, v.drive_id from members_private.videos v
        where v.deleted_at is null and (
          (v.status='rejected' and v.decided_at <= now() - interval '7 days')
          or (v.status='uploading' and v.created_at <= now() - interval '2 days')
        ) order by v.created_at limit 40
      ) expired
    ), '[]'::jsonb);
  elsif operation='start' then
    perform pg_advisory_xact_lock(hashtextextended(actor::text, 41213));
    if not exists (select 1 from members_private.profiles p where p.user_id=actor and p.status='approved') then
      return null;
    end if;
    if (select count(*) from members_private.videos v where v.author_id=actor and
        (v.status='pending' or (v.status='uploading' and v.created_at>now()-interval '2 hours'))) >= 5 then
      return '{"limit":true}'::jsonb;
    end if;
    insert into members_private.videos(author_id,title,bytes,drive_id,upload_url)
    values(actor,input->>'title',(input->>'bytes')::integer,input->>'drive_id',input->>'upload_url')
    returning * into current_video;
    return to_jsonb(current_video);
  end if;

  if operation='get' then
    select * into current_video from members_private.videos v where v.id=video_id;
  elsif operation='submit' then
    update members_private.videos v set status='pending', submitted_at=now(), upload_url=null
    where v.id=video_id and v.author_id=actor and v.status='uploading'
      and exists (select 1 from members_private.profiles p where p.user_id=actor and p.status='approved')
    returning * into current_video;
  elsif operation='claim' then
    if requested not in ('approved','rejected') or not exists (
      select 1 from members_private.administrators a join members_private.profiles p on p.user_id=a.user_id
      where a.user_id=actor and p.status='approved'
    ) then return null; end if;
    update members_private.videos v
      set decision=requested, decided_by=coalesce(v.decided_by, actor)
    where v.id=video_id and v.status='pending' and (v.decision is null or v.decision=requested)
    returning * into current_video;
  elsif operation='decide' then
    update members_private.videos v set status=v.decision, decided_at=now()
    where v.id=video_id and v.status='pending' and v.decision=requested
    returning * into current_video;
  elsif operation='purged' then
    update members_private.videos v
      set deleted_at=now(), upload_url=null,
          status=case when v.status='uploading' then 'abandoned' else v.status end
    where v.id=video_id and v.deleted_at is null and (
      (v.status='rejected' and v.decided_at <= now()-interval '7 days')
      or (v.status='uploading' and v.created_at <= now()-interval '2 days')
    )
    returning * into current_video;
  end if;
  return case when current_video.id is not null then to_jsonb(current_video) end;
end;
$$;
revoke all on function public.portal_video_service(text,jsonb) from public, anon, authenticated;
grant execute on function public.portal_video_service(text,jsonb) to service_role;
