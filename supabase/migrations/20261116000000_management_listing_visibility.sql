alter table members_private.profiles
  add column hidden_from_management boolean not null default false;

create or replace function public.portal_management_snapshot()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform members_private.require_admin();
  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(to_jsonb(a) order by lower(a.callsign), a.id)
      from members_private.management_accounts a
      join members_private.profiles p on p.user_id = a.id
      where not (p.status = 'rejected' and p.hidden_from_management)
    ), '[]'::jsonb),
    'roles', (select jsonb_agg(to_jsonb(r) order by r.label) from members_private.portal_roles r),
    'squads', (select jsonb_agg(s.code order by s.code) from members_private.squads s)
  );
end;
$$;
