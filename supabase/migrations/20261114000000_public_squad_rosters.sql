alter table members_private.profiles
  add column show_avatar boolean not null default true;

create function members_private.member_avatar_visible(member_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select from members_private.profiles p
    where p.user_id=member_id and p.show_avatar and members_private.approved_member(p.user_id)
  );
$$;
revoke all on function members_private.member_avatar_visible(uuid) from public, anon, authenticated;
grant execute on function members_private.member_avatar_visible(uuid) to authenticated;

drop policy "Approved members read member avatars" on storage.objects;
create policy "Approved members read member avatars" on storage.objects for select to authenticated
using (
  bucket_id='member-avatars' and members_private.approved_member((select auth.uid()))
  and (
    name=(select auth.uid())::text || '/avatar'
    or members_private.member_avatar_visible(
      case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/avatar$'
        then split_part(name, '/', 1)::uuid end
    )
  )
);

drop function public.portal_own_profile();
create function public.portal_own_profile()
returns table (
  id uuid, callsign text, full_name text, email text, squad text, biography text, profile_details text,
  show_biography boolean, show_full_name boolean, show_details boolean, show_activity boolean, has_avatar boolean,
  show_avatar boolean
) language plpgsql stable security definer set search_path = '' as $$
begin
  perform members_private.require_member();
  return query select p.user_id, p.callsign, p.full_name, u.email::text, p.squad, p.biography, p.profile_details,
    p.show_biography, p.show_full_name, p.show_details, p.show_activity,
    exists (select from storage.objects o where o.bucket_id='member-avatars' and o.name=p.user_id::text || '/avatar'),
    p.show_avatar
  from members_private.profiles p join auth.users u on u.id=p.user_id where p.user_id=auth.uid();
end;
$$;

-- Las pestañas abiertas con la versión anterior pueden guardar las otras preferencias.
create function public.portal_update_privacy(
  bio_visible boolean, name_visible boolean, details_visible boolean, activity_visible boolean, avatar_visible boolean
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.portal_update_privacy(bio_visible, name_visible, details_visible, activity_visible);
  update members_private.profiles p set show_avatar=avatar_visible where p.user_id=auth.uid();
end;
$$;

create or replace function public.portal_directory(squad_filter text default null)
returns table (id uuid, callsign text, squad text, has_avatar boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform members_private.require_member();
  return query select p.user_id, p.callsign, p.squad,
    p.show_avatar and exists (select from storage.objects o where o.bucket_id='member-avatars' and o.name=p.user_id::text || '/avatar')
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
    p.show_avatar and exists (select from storage.objects o where o.bucket_id='member-avatars' and o.name=p.user_id::text || '/avatar'),
    case when p.show_full_name then p.full_name end,
    case when p.show_biography then nullif(p.biography,'') end,
    case when p.show_details then nullif(p.profile_details,'') end,
    p.show_activity
  from members_private.profiles p where p.user_id=member_id and members_private.approved_member(p.user_id);
end;
$$;

create function public.portal_public_squad_roster(squad_code text)
returns table (callsign text, has_avatar boolean)
language sql stable security definer set search_path = '' as $$
  select p.callsign,
    p.show_avatar and exists (select from storage.objects o where o.bucket_id='member-avatars' and o.name=p.user_id::text || '/avatar')
  from members_private.profiles p
  where p.squad=squad_code and members_private.approved_member(p.user_id)
  order by lower(p.callsign), p.user_id;
$$;

-- Solo la función de servidor puede resolver un callsign a un objeto de Storage.
create function public.portal_public_avatar(squad_code text, member_callsign text)
returns text language sql stable security definer set search_path = '' as $$
  select o.name from members_private.profiles p
  join storage.objects o on o.bucket_id='member-avatars' and o.name=p.user_id::text || '/avatar'
  where p.squad=squad_code and lower(p.callsign)=lower(member_callsign)
    and members_private.member_avatar_visible(p.user_id);
$$;

revoke all on function public.portal_own_profile(), public.portal_update_privacy(boolean,boolean,boolean,boolean,boolean),
  public.portal_public_squad_roster(text), public.portal_public_avatar(text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.portal_own_profile(), public.portal_update_privacy(boolean,boolean,boolean,boolean,boolean) to authenticated;
grant execute on function public.portal_public_squad_roster(text) to anon, authenticated;
grant execute on function public.portal_public_avatar(text,text) to service_role;

notify pgrst, 'reload schema';
