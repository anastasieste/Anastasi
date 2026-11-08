alter table members_private.profiles
  add column biography text not null default '' check (char_length(biography) <= 500),
  add column profile_details text not null default '' check (char_length(profile_details) <= 300),
  add column show_biography boolean not null default false,
  add column show_full_name boolean not null default false,
  add column show_details boolean not null default false,
  add column show_activity boolean not null default false,
  add column administrative_note text not null default '' check (char_length(administrative_note) <= 1000);

alter table members_private.squads
  add column display_name text check (char_length(display_name) <= 80),
  add column description text check (char_length(description) <= 500),
  add column badge_file text check (badge_file ~ '^[A-Za-z0-9_-]+\.(png|webp|jpe?g|avif)$');

create table members_private.member_edits (
  id bigint generated always as identity primary key,
  member_id uuid not null references members_private.profiles(user_id) on delete cascade,
  administrator_id uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  old_callsign text not null,
  new_callsign text not null,
  old_squad text not null,
  new_squad text not null
);
alter table members_private.member_edits enable row level security;

create function members_private.approved_member(member_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select from members_private.profiles p join auth.users u on u.id=p.user_id
    where p.user_id=member_id and p.status='approved' and u.email_confirmed_at is not null
  );
$$;
revoke all on function members_private.approved_member(uuid) from public, anon, authenticated;
grant execute on function members_private.approved_member(uuid) to authenticated;

create function members_private.require_member()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not members_private.approved_member(auth.uid()) then raise insufficient_privilege; end if;
end;
$$;
revoke all on function members_private.require_member() from public, anon, authenticated;

create or replace function public.current_member_profile()
returns table (callsign text, status text, is_admin boolean)
language sql stable security definer set search_path = '' as $$
  select p.callsign,
    case when p.status='approved' and u.email_confirmed_at is null then 'pending' else p.status end,
    p.status='approved' and u.email_confirmed_at is not null
      and exists (select from members_private.administrators a where a.user_id=p.user_id)
  from members_private.profiles p join auth.users u on u.id=p.user_id where p.user_id=auth.uid();
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('member-avatars', 'member-avatars', false, 2097152, array['image/jpeg','image/png','image/webp']);

-- La selección permite al directorio leer avatares de miembros aprobados.
-- Los objetos tienen exactamente un nombre posible por propietario.
create policy "Approved members read member avatars" on storage.objects for select to authenticated
using (
  bucket_id='member-avatars' and members_private.approved_member(auth.uid())
  and members_private.approved_member(
    case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/avatar$'
      then split_part(name, '/', 1)::uuid end
  )
);
create policy "Approved members upload their avatar" on storage.objects for insert to authenticated
with check (
  bucket_id='member-avatars' and name=auth.uid()::text || '/avatar'
  and members_private.approved_member(auth.uid())
);
create policy "Approved members replace their avatar" on storage.objects for update to authenticated
using (bucket_id='member-avatars' and name=auth.uid()::text || '/avatar' and members_private.approved_member(auth.uid()))
with check (bucket_id='member-avatars' and name=auth.uid()::text || '/avatar' and members_private.approved_member(auth.uid()));
create policy "Approved members remove their avatar" on storage.objects for delete to authenticated
using (bucket_id='member-avatars' and name=auth.uid()::text || '/avatar' and members_private.approved_member(auth.uid()));

create function public.portal_own_profile()
returns table (
  id uuid, callsign text, full_name text, email text, squad text, biography text, profile_details text,
  show_biography boolean, show_full_name boolean, show_details boolean, show_activity boolean, has_avatar boolean
) language plpgsql stable security definer set search_path = '' as $$
begin
  perform members_private.require_member();
  return query select p.user_id, p.callsign, p.full_name, u.email::text, p.squad, p.biography, p.profile_details,
    p.show_biography, p.show_full_name, p.show_details, p.show_activity,
    exists (select from storage.objects o where o.bucket_id='member-avatars' and o.name=p.user_id::text || '/avatar')
  from members_private.profiles p join auth.users u on u.id=p.user_id where p.user_id=auth.uid();
end;
$$;

create function public.portal_update_profile(member_name text, bio text, details text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform members_private.require_member();
  update members_private.profiles p
  set full_name=btrim(member_name), biography=btrim(coalesce(bio,'')), profile_details=btrim(coalesce(details,''))
  where p.user_id=auth.uid();
end;
$$;

create function public.portal_update_privacy(bio_visible boolean, name_visible boolean, details_visible boolean, activity_visible boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform members_private.require_member();
  update members_private.profiles p
  set show_biography=bio_visible, show_full_name=name_visible, show_details=details_visible, show_activity=activity_visible
  where p.user_id=auth.uid();
end;
$$;

create function public.portal_directory(squad_filter text default null)
returns table (id uuid, callsign text, squad text, has_avatar boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform members_private.require_member();
  return query select p.user_id, p.callsign, p.squad,
    exists (select from storage.objects o where o.bucket_id='member-avatars' and o.name=p.user_id::text || '/avatar')
  from members_private.profiles p join auth.users u on u.id=p.user_id
  where p.status='approved' and u.email_confirmed_at is not null and (squad_filter is null or p.squad=squad_filter)
  order by p.squad, lower(p.callsign), p.user_id;
end;
$$;

create function public.portal_squads()
returns table (code text, display_name text, description text, badge_file text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform members_private.require_member();
  return query select s.code, s.display_name, s.description, s.badge_file
  from members_private.squads s order by s.code;
end;
$$;

create function public.portal_directory_profile(member_id uuid)
returns table (
  id uuid, callsign text, squad text, has_avatar boolean, full_name text, biography text, profile_details text,
  show_activity boolean
) language plpgsql stable security definer set search_path = '' as $$
begin
  perform members_private.require_member();
  return query select p.user_id, p.callsign, p.squad,
    exists (select from storage.objects o where o.bucket_id='member-avatars' and o.name=p.user_id::text || '/avatar'),
    case when p.show_full_name then p.full_name end,
    case when p.show_biography then nullif(p.biography,'') end,
    case when p.show_details then nullif(p.profile_details,'') end,
    p.show_activity
  from members_private.profiles p join auth.users u on u.id=p.user_id
  where p.user_id=member_id and p.status='approved' and u.email_confirmed_at is not null;
end;
$$;

create function public.portal_admin_edit_member(member_id uuid, member_callsign text, member_squad text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  previous members_private.profiles%rowtype;
begin
  perform members_private.require_admin();
  select p.* into previous from members_private.profiles p join auth.users u on u.id=p.user_id
  where p.user_id=member_id and p.status='approved' and u.email_confirmed_at is not null for update of p;
  if not found then raise exception using errcode='PT404', message='El miembro no está disponible'; end if;
  if (previous.callsign, previous.squad) is not distinct from (member_callsign, member_squad) then return; end if;
  update members_private.profiles p set callsign=member_callsign, squad=member_squad where p.user_id=member_id;
  insert into members_private.member_edits (member_id, administrator_id, old_callsign, new_callsign, old_squad, new_squad)
  values (member_id, auth.uid(), previous.callsign, member_callsign, previous.squad, member_squad);
end;
$$;

create function public.decide_member_application(application_id uuid, approved boolean, review_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  decision text;
  member members_private.profiles%rowtype;
begin
  perform members_private.require_admin();
  if approved is null then raise exception 'Decisión requerida'; end if;
  decision := case when approved then 'approved' else 'rejected' end;
  update members_private.profiles p
  set status=decision, decided_at=now(), decided_by=auth.uid(), administrative_note=btrim(coalesce(review_note,''))
  where p.user_id=application_id and p.status='pending'
    and exists (select from auth.users u where u.id=p.user_id and u.email_confirmed_at is not null)
  returning p.* into member;
  if not found then raise exception using errcode='PT409', message='La solicitud ya fue procesada o no está confirmada'; end if;
  insert into members_private.outbox (kind, user_id, recipient, callsign)
  select decision, member.user_id, u.email, member.callsign from auth.users u where u.id=member.user_id;
end;
$$;

-- La página anterior puede seguir en la caché durante el despliegue.
create or replace function public.decide_member_application(application_id uuid, approved boolean)
returns void language sql security definer set search_path = '' as $$
  select public.decide_member_application(application_id, approved, '');
$$;

create function public.portal_application_history()
returns table (id uuid, callsign text, status text, decided_at timestamptz, administrator text, note text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform members_private.require_admin();
  return query select p.user_id, p.callsign, p.status, p.decided_at, a.callsign, p.administrative_note
  from members_private.profiles p left join members_private.profiles a on a.user_id=p.decided_by
  where p.decided_at is not null and p.status in ('approved','rejected')
    and exists (select from members_private.outbox o where o.user_id=p.user_id and o.kind=p.status)
  order by p.decided_at desc, p.user_id limit 100;
end;
$$;

revoke all on function public.portal_own_profile(), public.portal_update_profile(text,text,text),
  public.portal_update_privacy(boolean,boolean,boolean,boolean), public.portal_directory(text),
  public.portal_directory_profile(uuid), public.portal_squads(), public.portal_admin_edit_member(uuid,text,text),
  public.decide_member_application(uuid,boolean,text), public.portal_application_history()
  from public, anon, authenticated;
grant execute on function public.portal_own_profile(), public.portal_update_profile(text,text,text),
  public.portal_update_privacy(boolean,boolean,boolean,boolean), public.portal_directory(text),
  public.portal_directory_profile(uuid), public.portal_squads(), public.portal_admin_edit_member(uuid,text,text),
  public.decide_member_application(uuid,boolean,text), public.portal_application_history()
  to authenticated;
