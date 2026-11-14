-- AMURA · SQL de producción 0007. Copia exacta de supabase/migrations/20261118010000_inventario_tres_estados.sql: no editar aquí.
-- Ejecutar completo en el SQL Editor de Supabase, en orden numérico. Registrar el resultado en CONTROL_EJECUCION.md.

-- AMURA · Inventario con tres estados: disponible, reservado y vendido.
--   · disponible: se cotiza y se reserva. reservado: reserva aprobada vigente (o contrato en preparación). vendido: contrato firmado,
--     es decir, venta formalizada. Una reserva anulada o desistida deja la unidad disponible si no hay otra operación vigente.
--   · Aprobación, pago, promesa y firma siguen como etapas de la reserva, la oportunidad y el contrato; no son estados del inventario.
--     Escritura, desembolso y entrega quedan como hitos del contrato y no cambian el estado de la unidad.
--   · Normaliza cada unidad según sus compromisos reales: contrato firmado → vendido; reserva aprobada o contrato vigente → reservado;
--     sin compromiso → disponible. Una unidad en promesa sin contrato firmado detiene el script para revisarla.
--   · El historial de estados conserva los valores anteriores como auditoría (por eso el tipo estado_comercial los mantiene);
--     la restricción inventory_units_estado_tres limita la unidad a los tres estados.
--   · El estado no se cambia a mano: lo asignan Reservas y Contratos.
-- Revertir: quitar la restricción inventory_units_estado_tres y restaurar las funciones desde sus migraciones anteriores.
-- Ejecutar después de 20261118000000_precios_lista_oficial.sql.

/* ------------------------------------------------------------ normalizar */

do $$
declare v_admin uuid := (select id from public.profiles where rol_id = 'administrador' and estado = 'activo' order by created_at limit 1);
begin
  if exists (select 1 from public.inventory_units u where u.estado = 'promesa'
             and not exists (select 1 from public.contracts k where k.codigo_unidad = u.codigo and k.estado = 'firmado')) then
    raise exception 'Hay unidades en promesa sin contrato firmado: revísalas antes de continuar';
  end if;

  create temp table tmp_tres_estados on commit drop as
  select u.codigo, u.estado as de,
    (case
      when u.estado = 'vendido' or exists (select 1 from public.contracts k where k.codigo_unidad = u.codigo and k.estado = 'firmado') then 'vendido'
      when u.estado = 'reservado'
        or exists (select 1 from public.reservations r where r.codigo_unidad = u.codigo and r.estado = 'confirmada')
        or exists (select 1 from public.contracts k where k.codigo_unidad = u.codigo and k.estado <> 'anulado') then 'reservado'
      else 'disponible' end)::public.estado_comercial as a,
    coalesce(u.reserva_id, (select r.id from public.reservations r where r.codigo_unidad = u.codigo and r.estado = 'confirmada' order by r.aprobado_en desc nulls last limit 1)) as reserva
  from public.inventory_units u;

  update public.inventory_units u
     set estado = t.a, reserva_id = case when t.a = 'disponible' then null else t.reserva end, updated_at = now()
    from tmp_tres_estados t
   where u.codigo = t.codigo and (u.estado <> t.a or (t.a = 'disponible' and u.reserva_id is not null));

  if v_admin is not null then
    insert into public.inventory_status_history (user_id, rol, codigo, de, a, motivo, reserva_id)
    select v_admin, 'administrador', t.codigo, t.de, t.a, 'Inventario con tres estados: disponible, reservado y vendido', t.reserva
    from tmp_tres_estados t where t.de <> t.a;
  end if;
end $$;

alter table public.inventory_units alter column estado set default 'disponible';
alter table public.inventory_units drop constraint if exists inventory_units_estado_tres;
alter table public.inventory_units add constraint inventory_units_estado_tres check (estado in ('disponible', 'reservado', 'vendido'));

/* ------------------------------------------------------------ funciones */

-- Reemplaza un fragmento exacto de una función. Si ya se aplicó, no hace nada; si no encuentra el fragmento, detiene el script.
-- Ignora los retornos de carro (CRLF de Windows) en la función y en los fragmentos.
create or replace function pg_temp.parchar(p_firma text, p_buscar text, p_reemplazo text) returns void
language plpgsql as $$
declare v_def text := replace(pg_get_functiondef(to_regprocedure(p_firma)), chr(13), '');
begin
  p_buscar := replace(p_buscar, chr(13), '');
  p_reemplazo := replace(p_reemplazo, chr(13), '');
  if position(p_buscar in v_def) = 0 then
    if position(p_reemplazo in v_def) > 0 then return; end if;
    raise exception 'No se encontró el fragmento esperado en %', p_firma;
  end if;
  execute replace(v_def, p_buscar, p_reemplazo);
end $$;

-- Cotizar y reservar: solo una unidad disponible.
select pg_temp.parchar('public.cotizaciones_emitir(uuid, numeric, integer, text)',
  $x$if u.estado not in ('disponible', 'por_confirmar') then$x$, $x$if u.estado <> 'disponible' then$x$);
select pg_temp.parchar('public.reservas_solicitar(uuid)',
  $x$  if u.estado = 'por_confirmar' then raise exception 'La unidad aún no tiene disponibilidad confirmada'; end if;
  if u.estado not in ('disponible', 'bloqueado') then$x$, $x$  if u.estado <> 'disponible' then$x$);
select pg_temp.parchar('public.reservas_solicitar_acordada(uuid, numeric)',
  $x$  if u.estado = 'por_confirmar' then raise exception 'La unidad aún no tiene disponibilidad confirmada'; end if;
  if u.estado not in ('disponible', 'bloqueado') then$x$, $x$  if u.estado <> 'disponible' then$x$);
select pg_temp.parchar('public.reservas_aprobar(uuid, text)',
  $x$if u.estado not in ('disponible', 'bloqueado') then$x$, $x$if u.estado <> 'disponible' then$x$);

-- El precio se congela con una reserva o una venta.
select pg_temp.parchar('public.inventario_ajustar_precio(text, numeric, text, text[], smallint, text, text)',
  $x$and u.estado not in ('reservado', 'promesa', 'vendido')$x$, $x$and u.estado not in ('reservado', 'vendido')$x$);
select pg_temp.parchar('public.precios_proponer(text, numeric, text, text[], smallint, text, text, text)',
  $x$and u.estado not in ('reservado', 'promesa', 'vendido')$x$, $x$and u.estado not in ('reservado', 'vendido')$x$);

-- Firmar el contrato formaliza la venta: la unidad pasa a vendida. Anularlo la devuelve a reservada (la reserva sigue aprobada).
select pg_temp.parchar('public.contratos_firmar(uuid, text, text)',
  $x$update inventory_units set estado = 'promesa', updated_at$x$, $x$update inventory_units set estado = 'vendido', updated_at$x$);
select pg_temp.parchar('public.contratos_firmar(uuid, text, text)',
  $x$c.codigo_unidad, 'reservado', 'promesa', 'Contrato ' || c.codigo || ' firmado'$x$,
  $x$c.codigo_unidad, 'reservado', 'vendido', 'Contrato ' || c.codigo || ' firmado: venta formalizada'$x$);
select pg_temp.parchar('public.contratos_anular(uuid, text, text)',
  $x$where codigo = c.codigo_unidad and estado = 'promesa';$x$, $x$where codigo = c.codigo_unidad and estado = 'vendido';$x$);
select pg_temp.parchar('public.contratos_anular(uuid, text, text)',
  $x$c.codigo_unidad, 'promesa', 'reservado', 'Contrato ' || c.codigo || ' anulado'$x$,
  $x$c.codigo_unidad, 'vendido', 'reservado', 'Contrato ' || c.codigo || ' anulado'$x$);

-- Escritura, desembolso y entrega son hitos del contrato: no cambian el estado de la unidad, que ya está vendida.
select pg_temp.parchar('public.contratos_registrar_hito(uuid, text, date, text, text)',
  $x$  if p_hito = 'escritura' then
    select estado into v_unidad from inventory_units where codigo = c.codigo_unidad for update;
    if v_unidad <> 'promesa' then raise exception 'La unidad debe estar en promesa para registrar la escritura (está %)', v_unidad; end if;
    update inventory_units set estado = 'vendido', updated_at = now(), updated_by = auth.uid() where codigo = c.codigo_unidad;
    insert into inventory_status_history (user_id, rol, codigo, de, a, motivo, reserva_id)
    values (auth.uid(), (select rol_id from profiles where id = auth.uid()), c.codigo_unidad, 'promesa', 'vendido', 'Escritura del contrato ' || c.codigo, c.reservation_id);
  elsif p_hito = 'entrega' then$x$,
  $x$  if p_hito = 'entrega' then$x$);
select pg_temp.parchar('public.contratos_revertir_hito(uuid, text)',
  $x$  if m.hito = 'escritura' then
    update inventory_units set estado = 'promesa', updated_at = now(), updated_by = auth.uid() where codigo = c.codigo_unidad and estado = 'vendido';
    insert into inventory_status_history (user_id, rol, codigo, de, a, motivo, reserva_id)
    values (auth.uid(), (select rol_id from profiles where id = auth.uid()), c.codigo_unidad, 'vendido', 'promesa', 'Reverso de escritura del contrato ' || c.codigo, c.reservation_id);
  elsif m.hito = 'entrega' then$x$,
  $x$  if m.hito = 'entrega' then$x$);

-- Una reserva anulada, rechazada o desistida deja la unidad disponible, salvo que otra operación la comprometa.
create or replace function public.reservas_destino_unidad(r public.reservations, u public.inventory_units) returns public.estado_comercial
language plpgsql stable security definer set search_path = public as $$
begin
  if u.estado <> 'reservado' or u.reserva_id is distinct from r.id then return null; end if;
  if exists (select 1 from reservations x where x.codigo_unidad = u.codigo and x.id <> r.id and x.estado in ('solicitada', 'pago_verificado', 'confirmada')) then return null; end if;
  if exists (select 1 from contracts k where k.codigo_unidad = u.codigo and k.estado <> 'anulado') then return null; end if;
  return 'disponible';
end $$;

create or replace function public.reservas_liberar_unidad(r public.reservations, u public.inventory_units, p_motivo text) returns text
language plpgsql security definer set search_path = public as $$
declare v_destino estado_comercial := public.reservas_destino_unidad(r, u);
begin
  if v_destino is null then
    return case
      when u.estado = 'vendido' then 'La unidad está vendida: no cambia'
      when u.reserva_id is distinct from r.id and u.estado = 'reservado' then 'La unidad está reservada por otra operación: no cambia'
      when u.estado = 'reservado' then 'La unidad tiene otra operación vigente: no cambia'
      else 'La solicitud no había retenido la unidad: no cambia' end;
  end if;
  update inventory_units set estado = v_destino, reserva_id = null, updated_at = now(), updated_by = auth.uid() where codigo = u.codigo;
  insert into inventory_status_history (user_id, rol, codigo, de, a, motivo, reserva_id)
  values (auth.uid(), (select pr.rol_id from profiles pr where pr.id = auth.uid()), u.codigo, 'reservado', v_destino, p_motivo, r.id);
  return 'La unidad queda disponible';
end $$;

-- Sin cambios manuales: reservado lo fija la aprobación de la reserva y vendido la firma del contrato.
create or replace function public.inventario_cambiar_estado(p_codigo text, p_estado public.estado_comercial, p_motivo text, p_reserva_id uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.tiene_permiso('inventario.cambiar_estado') then raise exception 'Sin permiso para cambiar estados' using errcode = '42501'; end if;
  raise exception 'El estado de la unidad lo asignan Reservas (reservado) y Contratos (vendido); una reserva anulada la deja disponible' using errcode = '42501';
end $$;
