-- AMURA · Usuarios de prueba. SOLO para un proyecto de pruebas: se detiene si encuentra cuentas reales.
-- 1. En Supabase: Authentication → Users → Add user → Create new user, con "Auto Confirm User", para cada correo de abajo.
--    La contraseña la eliges allí; no la guardes en el repositorio.
-- 2. Ejecuta este archivo en el SQL Editor. Se puede repetir.

do $$
declare
  r record; v_id uuid; v_equipo uuid; v_supervisora uuid; v_admin uuid;
begin
  if exists (select 1 from auth.users where email not like '%@prueba.local') then
    raise exception 'Hay cuentas que no son de prueba (%). Este script no se ejecuta en un proyecto con usuarios reales.', (select count(*) from auth.users where email not like '%@prueba.local');
  end if;
  for r in select * from (values
    ('admin@prueba.local', 'Ana Administradora', 'administrador', null),
    ('gerente@prueba.local', 'Gabriel Gerente', 'gerencia', null),
    ('finanzas@prueba.local', 'Fernanda Finanzas', 'finanzas', 'empresa'),
    ('legal@prueba.local', 'Luis Legal', 'legal', 'empresa'),
    ('supervisora@prueba.local', 'Sofía Supervisora', 'supervisor', null),
    ('corredor1@prueba.local', 'Carlos Corredor', 'corredor', null),
    ('corredor2@prueba.local', 'Cora Corredora', 'corredor', null)
  ) as x(email, nombre, rol, alcance) loop
    select id into v_id from auth.users where email = r.email;
    if v_id is null then raise exception 'Falta crear la cuenta % en Authentication', r.email; end if;
    insert into public.profiles (id, nombre, email, estado, rol_id, alcance) values (v_id, r.nombre, r.email, 'activo', r.rol, r.alcance)
    on conflict (id) do update set estado = 'activo', rol_id = excluded.rol_id, alcance = excluded.alcance;
    insert into public.user_projects values (v_id, 'AMURA') on conflict do nothing;
  end loop;

  select id into v_supervisora from public.profiles where email = 'supervisora@prueba.local';
  select id into v_admin from public.profiles where email = 'admin@prueba.local';
  select id into v_equipo from public.teams where nombre = 'Equipo Norte (prueba)';
  if v_equipo is null then insert into public.teams (nombre, supervisor_id) values ('Equipo Norte (prueba)', v_supervisora) returning id into v_equipo; end if;
  update public.profiles set equipo_id = v_equipo where email = 'corredor1@prueba.local';

  -- Sin receptor de pagos no se puede verificar ninguna reserva.
  update public.payment_settings set receptor = 'NUVAREL', definido_por = v_admin, definido_en = now() where id = 1;
  -- Unidades disponibles para las pruebas.
  update public.inventory_units set estado = 'disponible' where estado = 'por_confirmar';
end $$;

select email, nombre, rol_id, estado, equipo_id is not null as en_equipo from public.profiles order by email;
