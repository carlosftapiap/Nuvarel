-- AMURA · Últimos ajustes para operar de principio a fin:
--   · Reserva predeterminada de USD 500, editable hasta el 6 %; se descuenta del pago a la firma.
--   · Forma de pago fija por política: 6 % a la firma + 14 % en cuotas = entrada del 20 %; 80 % contra entrega.
--   · El corredor de origen es su perfil comercial: Comisiones y Ventas lo reconocen aunque no tenga cuenta de acceso.
-- No modifica clientes, reservas, contratos ni pagos existentes. Se puede repetir.
-- Ejecutar después de 20261031070000_corredores.sql.

begin;

do $$ begin
  if to_regclass('public.corredores') is null or to_regclass('public.comisiones') is null then
    raise exception 'Faltan Corredores o Comisiones: aplica antes 20261031060000_comisiones_tramos.sql y 20261031070000_corredores.sql';
  end if;
  if exists (select 1 from public.pricing_params where reserva_pct <> 6 or cuotas_pct <> 14) then
    raise exception 'Los parámetros no son 6 %% y 14 %%: corrígelos antes de continuar. No se aplicó nada.';
  end if;
end $$;

/* ------------------------------------------------------------ reserva y entrada */

-- reservas_solicitar propone el 6 %: aquí se fija el predeterminado. Sigue siendo editable con reservas_fijar_monto.
create or replace function public.reserva_monto_predeterminado() returns trigger
language plpgsql set search_path = public as $$
begin
  new.monto_reserva := least(500.00, new.monto_reserva);
  return new;
end $$;
drop trigger if exists reserva_monto_predeterminado on public.reservations;
create trigger reserva_monto_predeterminado before insert on public.reservations for each row execute function public.reserva_monto_predeterminado();

-- El contrato calcula sobre 6 % y 14 %: otro valor en los parámetros impediría generarlo.
alter table public.pricing_params drop constraint if exists pricing_params_politica_entrada;
alter table public.pricing_params add constraint pricing_params_politica_entrada check (reserva_pct = 6 and cuotas_pct = 14);

/* ------------------------------------------------- corredor de origen en módulos */

-- Un corredor con cuenta y sin perfil comercial lo obtiene al registrar su primer cliente, para no perder el origen.
create or replace function public.clientes_crear(p_id uuid, p_datos jsonb, p_asesor uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare d jsonb; v_id uuid := coalesce(p_id, gen_random_uuid()); v_corredor uuid := nullif(p_datos ->> 'corredor_origen_id', '')::uuid;
begin
  if not public.tiene_permiso('clientes.editar') then raise exception 'Sin permiso para registrar clientes' using errcode = '42501'; end if;
  perform public.clientes_responsable_valido(p_asesor);
  d := public.clientes_datos(p_datos);
  if v_corredor is null and d ->> 'origen' = 'corredor' then
    select id into v_corredor from corredores where usuario_id = auth.uid() and estado = 'activo';
    if v_corredor is null and not exists (select 1 from corredores where usuario_id = auth.uid()) then
      insert into corredores (nombre, email, usuario_id)
      select p.nombre, p.email, p.id from profiles p where p.id = auth.uid() and p.rol_id = 'corredor'
      returning id into v_corredor;
    end if;
  end if;
  perform public.clientes_corredor_valido(v_corredor, d ->> 'origen');
  insert into clients (id, nombre, documento, telefono, email, origen, origen_detalle, corredor_origen_id, unidades_interes, presupuesto, proposito, forma_pago, asesor_id, created_by)
  values (v_id, d ->> 'nombre', d ->> 'documento', d ->> 'telefono', d ->> 'email', d ->> 'origen', d ->> 'origen_detalle', v_corredor,
          array(select jsonb_array_elements_text(d -> 'unidades_interes')), (d ->> 'presupuesto')::numeric, d ->> 'proposito', d ->> 'forma_pago', p_asesor, auth.uid());
  perform public.clientes_nota(v_id, 'nota', 'Cliente registrado · origen ' || (d ->> 'origen'));
  return v_id;
end $$;

-- El corredor de la venta ve su comisión por la cuenta vinculada a su perfil, aunque el perfil tenga otro identificador.
create or replace function public.comision_en_alcance(k public.contracts) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.en_alcance(k.asesor_id), false) or coalesce(public.en_alcance(k.responsable_id), false)
    or coalesce((select public.en_alcance(c.usuario_id) from corredores c where c.id = k.corredor_origen_id), false)
    or coalesce(public.en_alcance(k.atribucion_usuario_id), false)
    or public.cliente_en_alcance(k.client_id)
$$;

do $$
declare v_def text := pg_get_functiondef('public.comisiones_listar()'::regprocedure);
begin
  if position('from profiles where id = k.corredor_origen_id' in v_def) > 0 then
    execute replace(v_def, 'from profiles where id = k.corredor_origen_id', 'from corredores where id = k.corredor_origen_id');
  elsif position('from corredores where id = k.corredor_origen_id' in v_def) = 0 then
    raise exception 'comisiones_listar no tiene la forma esperada: revisa 20261031060000_comisiones_tramos.sql';
  end if;
end $$;

-- Nombres que muestran Ventas y Clientes: personas con cuenta y corredores comerciales.
create or replace function public.contratos_personas() returns table (id uuid, nombre text)
language sql stable security definer set search_path = public as $$
  with vistos as (
    select k.* from contracts k
    where (public.tiene_permiso('ventas.ver') or public.tiene_permiso('cobranzas.ver')) and public.cliente_en_alcance(k.client_id)
  ), ids as (
    select asesor_id as u from vistos union select responsable_id from vistos union select atribucion_usuario_id from vistos
    union select corredor_origen_id from vistos union select firmado_por from vistos union select anulado_por from vistos union select created_by from vistos
    union select d.registrado_por from contract_documents d join vistos v on v.id = d.contract_id
    union select m.registrado_por from contract_milestones m join vistos v on v.id = m.contract_id
  )
  select p.id, p.nombre from profiles p join ids on ids.u = p.id
  union select c.id, c.nombre from corredores c join vistos v on v.corredor_origen_id = c.id
$$;

create or replace function public.clientes_personas() returns table (id uuid, nombre text)
language sql stable security definer set search_path = public as $$
  with visibles as (
    select c.id, c.asesor_id, c.created_by, c.atribucion_usuario_id, c.corredor_origen_id from clients c
    where public.tiene_permiso('clientes.ver') and public.cliente_en_alcance(c.id)
  ), ids as (
    select asesor_id as u from visibles
    union select created_by from visibles
    union select atribucion_usuario_id from visibles
    union select a.usuario_id from client_access a join visibles v on v.id = a.client_id
    union select a.user_id from client_activities a join visibles v on v.id = a.client_id
    union select o.responsable_id from opportunities o join visibles v on v.id = o.client_id
  )
  select p.id, p.nombre from profiles p join ids on ids.u = p.id
  union select c.id, c.nombre from corredores c join visibles v on v.corredor_origen_id = c.id
$$;

revoke all on function public.reserva_monto_predeterminado() from public, anon, authenticated;
revoke all on function public.comision_en_alcance(public.contracts) from public, anon, authenticated;

commit;
