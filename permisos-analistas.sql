begin;

create or replace function public.risk_edit_assigned_case(
  p_case_id text, p_topic text, p_department text, p_notes text,
  p_expected_topic text, p_expected_department text, p_expected_notes text
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  membership public.risk_access%rowtype;
  workspace public.risk_workspace%rowtype;
  item jsonb;
  item_position bigint;
begin
  select * into membership from public.risk_access
  where user_id = (select auth.uid()) and role in ('risk', 'research')
  for share;
  if not found then raise exception 'Cuenta sin acceso' using errcode = '42501'; end if;

  select * into workspace from public.risk_workspace
  where owner_id = membership.workspace_owner for update;
  if not found then raise exception 'Caso no disponible' using errcode = '42501'; end if;

  select entry.value, entry.ordinality into item, item_position
  from pg_catalog.jsonb_array_elements(workspace.payload->'cases') with ordinality entry(value, ordinality)
  where entry.value->>'id' = p_case_id
    and entry.value->>(case membership.role when 'risk' then 'person' else 'researcher' end) = membership.catalog_id;
  if not found then raise exception 'Caso no disponible' using errcode = '42501'; end if;

  if coalesce(item->>'topic','') is distinct from p_expected_topic
    or coalesce(item->>'department','') is distinct from p_expected_department
    or coalesce(item->>'notes','') is distinct from p_expected_notes then
    raise exception 'El caso cambió. Actualiza antes de editar.' using errcode = '40001';
  end if;

  if nullif(btrim(p_topic),'') is null or
     (char_length(p_topic) > 300 and p_topic is distinct from p_expected_topic) or
     p_department is null or p_notes is null or (char_length(p_notes) > 10000 and p_notes is distinct from p_expected_notes) then
    raise exception 'Revisa el tema, la dependencia y las observaciones.' using errcode = '22023';
  end if;
  if p_department <> coalesce(item->>'department','') and (
    p_department = '' or not exists (
      select 1 from pg_catalog.jsonb_array_elements(workspace.payload->'departments') d
      where d->>'id' = p_department and d->'active' = 'true'::jsonb
    )
  ) then raise exception 'Selecciona una dependencia activa.' using errcode = '22023'; end if;

  update public.risk_workspace
  set payload = pg_catalog.jsonb_set(workspace.payload, array['cases', (item_position - 1)::text],
    item || pg_catalog.jsonb_build_object('topic', btrim(p_topic), 'department', p_department, 'notes', p_notes)),
    revision = workspace.revision + 1
  where owner_id = workspace.owner_id;
end;
$$;

create or replace function public.risk_global_dashboard()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with workspace as (
    select coalesce(w.payload, '{}'::jsonb) as payload
    from public.risk_access a
    left join public.risk_workspace w on w.owner_id = a.workspace_owner
    where a.user_id = (select auth.uid())
  ), clock as (
    select (now() at time zone 'America/Guatemala')::date as today
  ), cases as (
    select c.item, c.item->'closed' = 'true'::jsonb as closed,
      nullif(c.item->>'due','') as due,
      nullif(c.item->>'closedAt','') as responded,
      nullif(c.item->>'assigned','') as assigned
    from workspace w cross join lateral pg_catalog.jsonb_array_elements(w.payload->'cases') c(item)
  ), metrics as (
    select count(*) as total,
      count(*) filter (where closed is not true) as opened,
      count(*) filter (where closed) as closed,
      count(*) filter (where closed is not true and due between today::text and (today + 7)::text) as upcoming,
      count(*) filter (where closed is not true and due < today::text) as overdue,
      count(*) filter (where closed is not true and due is null) as undated,
      count(*) filter (where closed and left(responded,7) = left(today::text,7)) as closed_month,
      count(*) filter (where closed and due is not null and responded is not null) as measurable,
      count(*) filter (where closed and responded <= due) as on_time,
      avg(case when closed and responded >= assigned and responded ~ '^\d{4}-\d{2}-\d{2}$' and assigned ~ '^\d{4}-\d{2}-\d{2}$'
        then responded::date - assigned::date end) as average_days
    from cases cross join clock
  ), groups as (
    select mapping.kind, coalesce(entry.item->>'name', mapping.fallback) as label,
      count(*) filter (where c.closed is not true) as opened,
      count(*) filter (where c.closed) as closed,
      count(*) filter (where c.closed is not true and c.due < clock.today::text) as overdue
    from cases c cross join workspace w cross join clock
    cross join lateral (values
      ('people', c.item->>'person', 'Sin analista'),
      ('types', coalesce(c.item->>'type','matrix'), 'Sin tipo'),
      ('departments', c.item->>'department', 'Sin dependencia registrada')
    ) mapping(kind, id, fallback)
    left join lateral (
      select entry.item from pg_catalog.jsonb_array_elements(w.payload->mapping.kind) entry(item)
      where entry.item->>'id' = mapping.id limit 1
    ) entry on true
    group by mapping.kind, coalesce(entry.item->>'name', mapping.fallback)
  )
  select pg_catalog.jsonb_build_object(
    'metrics', pg_catalog.to_jsonb(metrics),
    'groups', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(groups) order by kind, label) from groups), '[]'::jsonb),
    'departments', coalesce(w.payload->'departments', '[]'::jsonb)
  )
  from workspace w cross join metrics;
$$;

revoke all on function public.risk_edit_assigned_case(text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.risk_edit_assigned_case(text,text,text,text,text,text,text) to authenticated;
revoke all on function public.risk_global_dashboard() from public, anon, authenticated;
grant execute on function public.risk_global_dashboard() to authenticated;

commit;
