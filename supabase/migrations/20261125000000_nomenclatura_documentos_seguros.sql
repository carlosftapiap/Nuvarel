-- AMURA: 0016 definitivo, incorpora 0015 y proteccion documental en UNA transaccion.
-- Ejecutar este archivo completo. NO ejecutar 0015 por separado. Respaldo externo verificado previo.
-- No modifica archivos ni snapshots historicos. Conserva las siete FK y los datos fisicos/comerciales.
begin;
-- INICIO BLOQUE 0015
lock table public.inventory_units in share row exclusive mode;
create temporary table nomenclatura_0015_antes on commit drop as
  select codigo,to_jsonb(u)-'dpt' as datos from public.inventory_units u;

-- Recuperación exacta de textos; no se revierte mediante sustituciones globales.
create table if not exists public.nomenclatura_textos_respaldo (
  tabla text not null, clave text not null, antes jsonb not null, despues jsonb not null,
  primary key(tabla,clave)
);
alter table public.nomenclatura_textos_respaldo enable row level security;
revoke all on public.nomenclatura_textos_respaldo from public,anon,authenticated;
insert into public.nomenclatura_textos_respaldo
select 'obra_frentes',id::text,
 jsonb_build_object('nombre',nombre,'descripcion',descripcion,'contexto',contexto),
 jsonb_build_object('nombre',replace(replace(nombre,'Edificio 1','Edificio A'),'Edificio 2','Edificio B'),
 'descripcion',replace(replace(descripcion,'Edificio 1','Edificio A'),'Edificio 2','Edificio B'),
 'contexto',replace(replace(contexto,'Edificio 1','Edificio A'),'Edificio 2','Edificio B'))
from public.obra_frentes where nombre ~ 'Edificio [12]' or descripcion ~ 'Edificio [12]' or contexto ~ 'Edificio [12]'
on conflict do nothing;
insert into public.nomenclatura_textos_respaldo
select 'medios_proyecto',id::text,jsonb_build_object('titulo',titulo,'descripcion',descripcion),
 jsonb_build_object('titulo',replace(replace(titulo,'Edificio 1','Edificio A'),'Edificio 2','Edificio B'),
 'descripcion',replace(replace(descripcion,'Edificio 1','Edificio A'),'Edificio 2','Edificio B'))
from public.medios_proyecto where titulo ~ 'Edificio [12]' or descripcion ~ 'Edificio [12]'
on conflict do nothing;
insert into public.nomenclatura_textos_respaldo
select 'contract_fields',clave,jsonb_build_object('tipo',tipo,'descripcion',descripcion),jsonb_build_object('tipo','texto','descripcion','Edificio A o B')
from public.contract_fields where clave='unidad.edificio' on conflict do nothing;

-- 1. Verificación previa, conversión y constancia en la auditoría. Si algo no cuadra, se detiene sin cambiar nada.
do $$
declare v_total int; v_fuera int; v_cambiadas int;
begin
  select count(*) into v_total from public.inventory_units;
  if v_total <> 72 then raise exception 'Se esperaban 72 unidades y hay %: revisar antes de continuar', v_total; end if;
  if (select count(*) from public.inventory_units where edificio=1)<>30
     or (select count(*) from public.inventory_units where edificio=2)<>42
     or (select count(distinct (edificio,piso,posicion)) from public.inventory_units)<>72
     or exists(select 1 from public.inventory_units where posicion>case edificio when 1 then 5 else 7 end
       or codigo<>'E'||edificio::text||'-'||case piso when 'PB' then 'PB' else 'P'||piso end||'-A'||posicion::text) then
    raise exception 'Los edificios, posiciones o claves técnicas no coinciden con el mapeo aprobado';
  end if;
  select count(*) into v_fuera from public.inventory_units
  where dpt <> edificio::text || case piso when 'PB' then '0' else piso end || lpad(posicion::text, 2, '0')
    and dpt <> case edificio when 1 then 'A' else 'B' end || case piso when 'PB' then '0' else piso end || lpad(posicion::text, 2, '0');
  if v_fuera > 0 then raise exception '% unidades tienen un número que no corresponde a su edificio, piso y posición: revisar antes de continuar', v_fuera; end if;

  update public.inventory_units set dpt = case edificio when 1 then 'A' else 'B' end || substr(dpt, 2)
  where dpt ~ '^[12][0-5]0[1-7]$';
  get diagnostics v_cambiadas = row_count;

  if v_cambiadas > 0 then
    insert into public.audit_log (actor_id, accion, entidad, entidad_id, motivo, antes, despues)
    values (auth.uid(), 'nomenclatura_comercial', 'inventory_units', 'todas',
      'Nueva nomenclatura comercial: Edificio A y B, departamentos A001-A505 y B001-B507. El código interno no cambia.',
      jsonb_build_object('formato', '1001-1505 y 2001-2507', 'edificios', '1 y 2'),
      jsonb_build_object('formato', 'A001-A505 y B001-B507', 'edificios', 'A y B', 'unidades', v_cambiadas));
  end if;
end $$;

-- 2. Integridad: el número comercial siempre corresponde a su edificio, piso y posición.
alter table public.inventory_units drop constraint if exists inventory_units_dpt_comercial;
alter table public.inventory_units add constraint inventory_units_dpt_comercial
  check (dpt = case edificio when 1 then 'A' else 'B' end || case piso when 'PB' then '0' else piso end || lpad(posicion::text, 2, '0'));

-- 3. Funciones: solo se reemplaza el fragmento indicado de la versión vigente (que ya incluye los cambios de migraciones anteriores).
create or replace function pg_temp.parchar(p_firma text, p_buscar text, p_reemplazo text) returns void
language plpgsql as $$
declare v_def text := pg_get_functiondef(to_regprocedure(p_firma)); v_new text;
begin
  if position(p_reemplazo in v_def) > 0 then return; end if;
  v_new := replace(v_def, p_buscar, p_reemplazo);
  if v_new = v_def then raise exception 'No se encontró el fragmento esperado en %', p_firma; end if;
  execute v_new;
end $$;

-- Contratos nuevos: el edificio se imprime como A o B.
select pg_temp.parchar('public.contratos_datos_documento(uuid, jsonb)',
  $x$'edificio', u.edificio,$x$,
  $x$'edificio', case u.edificio when 1 then 'A' when 2 then 'B' else u.edificio::text end,$x$)
where to_regprocedure('public.contratos_datos_documento(uuid, jsonb)') is not null;

-- Mensajes de los parámetros de precios.
select pg_temp.parchar('public.inventario_actualizar_parametros(numeric, numeric, numeric, integer, integer, text)',
  $x$'Los meses del Edificio 1 deben estar entre 1 y 120'$x$, $x$'Los meses del Edificio A deben estar entre 1 y 120'$x$)
where to_regprocedure('public.inventario_actualizar_parametros(numeric, numeric, numeric, integer, integer, text)') is not null;
select pg_temp.parchar('public.inventario_actualizar_parametros(numeric, numeric, numeric, integer, integer, text)',
  $x$'Los meses del Edificio 2 deben estar entre 1 y 120'$x$, $x$'Los meses del Edificio B deben estar entre 1 y 120'$x$)
where to_regprocedure('public.inventario_actualizar_parametros(numeric, numeric, numeric, integer, integer, text)') is not null;

-- 4. La variable {{unidad.edificio}} de las plantillas ahora es una letra.
do $$ begin
  if to_regclass('public.contract_fields') is not null then
    update public.contract_fields set tipo = 'texto', descripcion = 'Edificio A o B' where clave = 'unidad.edificio';
  end if;
end $$;

-- 5. Textos guardados que nombran los edificios: frentes de obra y material del proyecto. Solo cambia «Edificio 1/2».
do $$
begin
  if to_regclass('public.obra_frentes') is not null then
    update public.obra_frentes set
      nombre = replace(replace(nombre, 'Edificio 1', 'Edificio A'), 'Edificio 2', 'Edificio B'),
      descripcion = replace(replace(descripcion, 'Edificio 1', 'Edificio A'), 'Edificio 2', 'Edificio B'),
      contexto = replace(replace(contexto, 'Edificio 1', 'Edificio A'), 'Edificio 2', 'Edificio B')
    where nombre ~ 'Edificio [12]' or descripcion ~ 'Edificio [12]' or contexto ~ 'Edificio [12]';
  end if;
  if to_regclass('public.medios_proyecto') is not null then
    update public.medios_proyecto set
      titulo = replace(replace(titulo, 'Edificio 1', 'Edificio A'), 'Edificio 2', 'Edificio B'),
      descripcion = replace(replace(descripcion, 'Edificio 1', 'Edificio A'), 'Edificio 2', 'Edificio B')
    where titulo ~ 'Edificio [12]' or descripcion ~ 'Edificio [12]';
  end if;
end $$;

do $$ begin
 if (select jsonb_agg(datos order by codigo) from nomenclatura_0015_antes) is distinct from
    (select jsonb_agg(to_jsonb(u)-'dpt' order by codigo) from public.inventory_units u) then
  raise exception 'Cambió un dato protegido de Inventario; se cancela 0015';
 end if;
end $$;
-- FIN BLOQUE 0015

lock table public.inventory_units in share row exclusive mode;
create temporary table nomenclatura_inventario_antes on commit drop as
  select codigo,to_jsonb(u)-'dpt_anterior' as datos from public.inventory_units u;

do $$ begin
  if (select count(*) from public.inventory_units) <> 72
     or (select count(*) from public.inventory_units where edificio = 1) <> 30
     or (select count(*) from public.inventory_units where edificio = 2) <> 42
     or exists (select 1 from public.inventory_units where posicion > case edificio when 1 then 5 else 7 end
       or codigo <> 'E' || edificio::text || '-' || case piso when 'PB' then 'PB' else 'P' || piso end || '-A' || posicion::text
       or dpt <> case edificio when 1 then 'A' else 'B' end || case piso when 'PB' then '0' else piso end || lpad(posicion::text,2,'0'))
     or (select count(distinct (edificio,piso,posicion)) from public.inventory_units) <> 72 then
    raise exception 'El inventario no coincide con el mapeo aprobado de 72 unidades; no se aplicó 0016';
  end if;
  if (select count(*) from pg_constraint where contype='f' and confrelid='public.inventory_units'::regclass and convalidated) <> 7 then
    raise exception 'Revisar las siete relaciones foráneas de Inventario antes de aplicar 0016';
  end if;
end $$;

-- Respaldo de recuperación interno, protegido: no es sustituto del respaldo externo verificado.
create table if not exists public.nomenclatura_respaldo (
  version text primary key, creado_en timestamptz not null default now(),
  inventario jsonb not null, plan jsonb not null, funciones jsonb not null
);
alter table public.nomenclatura_respaldo enable row level security;
revoke all on public.nomenclatura_respaldo from public, anon, authenticated;
insert into public.nomenclatura_respaldo(version,inventario,plan,funciones)
select '0016', (select jsonb_agg(to_jsonb(u) order by codigo) from public.inventory_units u),
  (select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from public.plan_activities a where to_jsonb(a)::text ~* 'edificio [12]'),
  (select jsonb_object_agg(p.oid::regprocedure::text,pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname in ('clientes_datos','clientes_editar','clientes_importar','oportunidades_crear','oportunidades_vincular_unidad',
    'oportunidades_cerrar','oportunidades_transferir','desistimientos_registrar',
    'cotizaciones_emitir','financiamiento_guardar_simulacion','leads_procesar','contratos_datos_documento','inventario_ajustar_precio','notif_datos_contrato',
    'notif_reservas','notif_comprobantes','notif_movimientos','notificaciones_recordatorios','reservas_reportar_pago','cobranzas_reportar_pago'))
on conflict(version) do nothing;

alter table public.inventory_units add column if not exists dpt_anterior text generated always as
  (edificio::text || case piso when 'PB' then '0' else piso end || lpad(posicion::text,2,'0')) stored;
create unique index if not exists inventory_units_dpt_anterior_key on public.inventory_units(dpt_anterior);
create unique index if not exists inventory_units_posicion_unica on public.inventory_units(edificio,piso,posicion);
do $$ begin
 if not exists(select 1 from pg_constraint where conname='inventory_units_identidad_estable' and conrelid='public.inventory_units'::regclass) then
  alter table public.inventory_units add constraint inventory_units_identidad_estable check (
    posicion<=case edificio when 1 then 5 else 7 end
    and codigo='E'||edificio::text||'-'||case piso when 'PB' then 'PB' else 'P'||piso end||'-A'||posicion::text);
 end if;
end $$;

-- La base es la autoridad del número comercial. Resolver nunca inserta ni modifica unidades.
create or replace function public.inventario_resolver_codigo(p_codigo text) returns text
language sql stable security definer set search_path = public as $$
  select codigo from inventory_units where upper(btrim(p_codigo)) in (codigo,dpt,dpt_anterior)
$$;
create or replace function public.unidad_numero_comercial(p_codigo text) returns text
language sql stable security definer set search_path = public as $$
  select dpt from inventory_units where codigo=public.inventario_resolver_codigo(p_codigo)
$$;
revoke all on function public.inventario_resolver_codigo(text), public.unidad_numero_comercial(text) from public, anon;
grant execute on function public.inventario_resolver_codigo(text), public.unidad_numero_comercial(text) to authenticated;
do $$ begin
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant execute on function public.inventario_resolver_codigo(text), public.unidad_numero_comercial(text) to service_role;
  end if;
end $$;

-- Función privada: no permite consultar precios/superficies fuera de las RLS existentes.
create or replace function public.documento_unidad_snapshot(p_codigo text) returns jsonb
language sql stable security definer set search_path = public as $$
 select jsonb_build_object('codigo',codigo,'dpt',dpt,'edificio',edificio,
   'edificioNombre',case when dpt ~ '^[AB]' then 'Edificio ' || left(dpt,1) else 'Edificio ' || edificio::text end,
   'piso',piso,'posicion',posicion,'ubicacion',ubicacion,'tipologia',tipologia,'areaM2',area_m2,
   'bodegaCodigo',bodega_codigo,'bodegaM2',bodega_m2,'patioM2',patio_m2,'parqueo',parqueo,
   'usdM2',usd_m2,'estado',estado,'versionDocumento',1)
 from inventory_units where codigo=p_codigo
$$;
revoke all on function public.documento_unidad_snapshot(text) from public, anon, authenticated;

alter table public.quotes add column if not exists unidad_snapshot jsonb;
alter table public.recibos_pago add column if not exists unidad_snapshot jsonb;
alter table public.mortgage_simulations add column if not exists unidad_snapshot jsonb;
alter table public.comprobantes_pago add column if not exists constancia_snapshot jsonb;

create or replace function public.documentos_congelar_unidad() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_codigo text;
begin
  if tg_op='UPDATE' then
    if new.unidad_snapshot is distinct from old.unidad_snapshot then
      raise exception 'La instantánea de emisión no se modifica; emite un documento nuevo' using errcode='42501';
    end if;
    if tg_table_name='quotes' and to_jsonb(new)->>'codigo' is distinct from to_jsonb(old)->>'codigo' then
      raise exception 'La unidad de una cotización emitida no se cambia' using errcode='42501';
    end if;
    if tg_table_name='recibos_pago' then
      if (to_jsonb(new)-array['anulado_en','motivo_anulacion','pdf_ruta','pdf_hash']) is distinct from
         (to_jsonb(old)-array['anulado_en','motivo_anulacion','pdf_ruta','pdf_hash']) then
        raise exception 'Los datos del recibo original no se modifican' using errcode='42501';
      end if;
      if to_jsonb(old)->>'pdf_ruta' is not null and
         (to_jsonb(new)->>'pdf_ruta',to_jsonb(new)->>'pdf_hash') is distinct from
         (to_jsonb(old)->>'pdf_ruta',to_jsonb(old)->>'pdf_hash') then
        raise exception 'El archivo original del recibo no se reemplaza' using errcode='42501';
      end if;
    end if;
    return new;
  end if;
  v_codigo := case when tg_table_name='quotes' then to_jsonb(new)->>'codigo' else to_jsonb(new)->>'codigo_unidad' end;
  new.unidad_snapshot := public.documento_unidad_snapshot(v_codigo);
  if new.unidad_snapshot is null then raise exception 'La unidad del documento no existe'; end if;
  if tg_table_name='recibos_pago' then new := jsonb_populate_record(new,jsonb_build_object('departamento',new.unidad_snapshot->>'dpt')); end if;
  return new;
end $$;
revoke all on function public.documentos_congelar_unidad() from public, anon, authenticated;
drop trigger if exists quotes_unidad_snapshot on public.quotes;
create trigger quotes_unidad_snapshot before insert or update on public.quotes for each row execute function public.documentos_congelar_unidad();
drop trigger if exists recibos_unidad_snapshot on public.recibos_pago;
create trigger recibos_unidad_snapshot before insert or update on public.recibos_pago for each row execute function public.documentos_congelar_unidad();
drop trigger if exists simulaciones_unidad_snapshot on public.mortgage_simulations;
create trigger simulaciones_unidad_snapshot before insert or update on public.mortgage_simulations for each row execute function public.documentos_congelar_unidad();

create or replace function public.comprobantes_congelar_constancia() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_codigo text; v_cliente uuid; v_concepto text; cl clients; em emisor_recibos; v_perfil text; v_medio text;
begin
  if tg_op='UPDATE' then
    if new.constancia_snapshot is distinct from old.constancia_snapshot then
      raise exception 'La constancia original no se modifica' using errcode='42501';
    end if;
    if (to_jsonb(new)-array['estado','revisado_por','revisado_en','motivo_revision']) is distinct from
       (to_jsonb(old)-array['estado','revisado_por','revisado_en','motivo_revision']) then
      raise exception 'Los datos de emisión de la constancia no se modifican' using errcode='42501';
    end if;
    return new;
  end if;
  v_medio := current_setting('app.constancia_medio',true);
  if v_medio in ('transferencia','deposito','cheque') then new.medio:=v_medio; end if;
  if new.reservation_id is not null then
    select codigo_unidad,client_id,'Reserva '||codigo into v_codigo,v_cliente,v_concepto from reservations where id=new.reservation_id;
  else
    select c.codigo_unidad,c.client_id,'Contrato '||c.codigo into v_codigo,v_cliente,v_concepto
      from payments p join contracts c on c.id=p.contract_id where p.id=new.payment_id;
  end if;
  select * into cl from clients where id=v_cliente;
  select * into em from emisor_recibos where id=1;
  select nombre into v_perfil from profiles where id=new.cargado_por;
  new.constancia_snapshot := jsonb_build_object('cliente',coalesce(cl.nombre,'—'),'documento',coalesce(cl.documento,''),
    'departamento',public.unidad_numero_comercial(v_codigo),'codigoUnidad',v_codigo,'concepto',v_concepto,
    'emisor',coalesce(em.razon_social,'NUVAREL S.A.S.'),'emisorRuc',em.ruc,'emisorDireccion',em.direccion,
    'registradoPor',coalesce(v_perfil,'Usuario'),'unidad',public.documento_unidad_snapshot(v_codigo),'estadoEmision',new.estado,
    'comprobante',jsonb_build_object('monto',new.monto,'fecha',new.fecha,'banco',new.banco,'referencia',new.referencia,
      'medio',new.medio,'cargadoEn',new.cargado_en,'constanciaNumero',new.constancia_numero));
  if new.constancia_snapshot->'unidad' is null or new.constancia_snapshot->'unidad'='null'::jsonb then
    raise exception 'No se encontró la unidad de la constancia';
  end if;
  return new;
end $$;
revoke all on function public.comprobantes_congelar_constancia() from public, anon, authenticated;
drop trigger if exists comprobantes_documento_snapshot on public.comprobantes_pago;
create trigger comprobantes_documento_snapshot before insert or update on public.comprobantes_pago for each row execute function public.comprobantes_congelar_constancia();

-- Parches controlados: conservan firmas, permisos y reglas comerciales de la versión vigente.
create or replace function pg_temp.nomenclatura_parchar(p_firma text,p_buscar text,p_nuevo text) returns void language plpgsql as $$
declare v_def text:=replace(pg_get_functiondef(to_regprocedure(p_firma)),chr(13),'');
begin
 p_buscar:=replace(p_buscar,chr(13),'');
 p_nuevo:=replace(p_nuevo,chr(13),'');
 if v_def is null then raise exception 'Falta la función %',p_firma; end if;
 if position(p_nuevo in v_def)>0 then return; end if;
 if position(p_buscar in v_def)=0 then raise exception 'La función % difiere de la versión auditada',p_firma; end if;
 execute replace(v_def,p_buscar,p_nuevo);
end $$;
select pg_temp.nomenclatura_parchar('public.clientes_datos(jsonb)',
 $x$array(select distinct jsonb_array_elements_text(coalesce(p -> 'unidades_interes', '[]'::jsonb)))$x$,
 $x$array(select distinct coalesce(public.inventario_resolver_codigo(x),x) from jsonb_array_elements_text(coalesce(p -> 'unidades_interes','[]'::jsonb)) x)$x$);
select pg_temp.nomenclatura_parchar('public.clientes_importar(jsonb)',
 $x$where exists (select 1 from inventory_units u where u.codigo = x)$x$,
 $x$where public.inventario_resolver_codigo(x) is not null$x$);
select pg_temp.nomenclatura_parchar('public.oportunidades_crear(uuid,text,text)',
 $x$v_unidad text := nullif(trim(coalesce(p_unidad, '')), '')$x$,
 $x$v_unidad text := case when nullif(trim(p_unidad),'') is null then null else coalesce(public.inventario_resolver_codigo(p_unidad),p_unidad) end$x$);
select pg_temp.nomenclatura_parchar('public.oportunidades_vincular_unidad(uuid,text)',
 $x$begin
  if o.codigo_unidad$x$,
 $x$begin
  p_unidad := coalesce(public.inventario_resolver_codigo(p_unidad),p_unidad);
  if o.codigo_unidad$x$);
select pg_temp.nomenclatura_parchar('public.financiamiento_guardar_simulacion(text,uuid,text,uuid,jsonb,jsonb)',
 $x$if not exists (select 1 from inventory_units where codigo = p_unidad)$x$,
 $x$p_unidad := coalesce(public.inventario_resolver_codigo(p_unidad),p_unidad);
  if not exists (select 1 from inventory_units where codigo = p_unidad)$x$);
select pg_temp.nomenclatura_parchar('public.leads_procesar(uuid,timestamptz,uuid,text)',
 $x$case when exists (select 1 from inventory_units u where u.codigo = l.unidad_interes) then array[l.unidad_interes] else '{}'::text[] end$x$,
 $x$case when public.inventario_resolver_codigo(l.unidad_interes) is not null then array[public.inventario_resolver_codigo(l.unidad_interes)] else '{}'::text[] end$x$);
select pg_temp.nomenclatura_parchar('public.contratos_datos_documento(uuid,jsonb)',
 $x$'codigo', u.codigo, 'departamento', u.dpt$x$,
 $x$'codigo', u.dpt, 'codigo_interno', u.codigo, 'numero_anterior', u.dpt_anterior, 'codigo_comercial', u.dpt, 'departamento', u.dpt$x$);
-- Evita que un ajuste concurrente cambie la unidad entre el cálculo y su instantánea de emisión.
select pg_temp.nomenclatura_parchar('public.cotizaciones_emitir(uuid,numeric,integer,text)',
 $x$select * into u from inventory_units where codigo = o.codigo_unidad;$x$,
 $x$select * into u from inventory_units where codigo = o.codigo_unidad for share;$x$);
insert into public.contract_fields(clave,grupo,etiqueta,tipo,descripcion) values
 ('unidad.codigo_interno','Unidad','Identificador técnico','texto','Referencia permanente; no es el número comercial'),
 ('unidad.numero_anterior','Unidad','Número anterior','texto','Equivalencia histórica'),
 ('unidad.codigo_comercial','Unidad','Código comercial','texto','Código vigente al emitir el documento')
on conflict(clave) do nothing;

select pg_temp.nomenclatura_parchar('public.inventario_ajustar_precio(text,numeric,text,text[],smallint,text,text)',
 $x$'Edificio ' || p_edificio$x$,$x$'Edificio ' || case p_edificio when 1 then 'A' else 'B' end$x$);

-- Las notas nuevas usan el número comercial; las actividades históricas permanecen intactas.
select pg_temp.nomenclatura_parchar('public.clientes_editar(uuid,integer,jsonb)',
 $x$select string_agg(x, ', ') into v_nuevas$x$,
 $x$select string_agg(public.unidad_numero_comercial(x), ', ') into v_nuevas$x$);
select pg_temp.nomenclatura_parchar('public.oportunidades_crear(uuid,text,text)',
 $x$coalesce(v_unidad, 'tipología ' || v_tipologia)$x$,
 $x$coalesce(public.unidad_numero_comercial(v_unidad), 'tipología ' || v_tipologia)$x$);
select pg_temp.nomenclatura_parchar('public.oportunidades_cerrar(uuid,text)',
 $x$coalesce(o.codigo_unidad, o.tipologia, '')$x$,
 $x$coalesce(public.unidad_numero_comercial(o.codigo_unidad), o.tipologia, '')$x$);
select pg_temp.nomenclatura_parchar('public.oportunidades_transferir(uuid,uuid,text)',
 $x$coalesce(o.codigo_unidad, o.tipologia, '')$x$,
 $x$coalesce(public.unidad_numero_comercial(o.codigo_unidad), o.tipologia, '')$x$);
select pg_temp.nomenclatura_parchar('public.desistimientos_registrar(uuid,uuid,text,text)',
 $x$coalesce(' · ' || coalesce(r.codigo_unidad, o.codigo_unidad), '')$x$,
 $x$coalesce(' · ' || public.unidad_numero_comercial(coalesce(r.codigo_unidad, o.codigo_unidad)), '')$x$);

-- Solo los avisos futuros cambian: las colas y las auditorías históricas permanecen intactas.
do $$ declare f record; v_def text; v_nueva text; v_ref text;
begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
   and p.proname in ('notif_datos_contrato','notif_reservas','notif_comprobantes','notif_movimientos','notificaciones_recordatorios') loop
   v_def:=pg_get_functiondef(f.oid); v_nueva:=v_def;
   foreach v_ref in array array['c.codigo_unidad','new.codigo_unidad','r.codigo_unidad','x.codigo_unidad'] loop
     v_nueva:=replace(v_nueva,'''Unidad'', '||v_ref||')','''Unidad'', public.unidad_numero_comercial('||v_ref||'))');
     v_nueva:=replace(v_nueva,'|| '||v_ref||',','|| public.unidad_numero_comercial('||v_ref||'),');
     v_nueva:=replace(v_nueva,'coalesce('||v_ref||', '''')','coalesce(public.unidad_numero_comercial('||v_ref||'), '''')');
   end loop;
   v_nueva:=replace(v_nueva,'select r.codigo_unidad, cl.nombre','select public.unidad_numero_comercial(r.codigo_unidad), cl.nombre');
   v_nueva:=replace(v_nueva,'select c.codigo_unidad, cl.nombre','select public.unidad_numero_comercial(c.codigo_unidad), cl.nombre');
   if v_nueva<>v_def then execute v_nueva; end if;
 end loop;
end $$;

select pg_temp.nomenclatura_parchar('public.reservas_reportar_pago(uuid,numeric,date,text,text,jsonb,text)',
 $x$v_id := public.reservas_reportar_pago$x$,
 $x$perform set_config('app.constancia_medio',p_medio,true);
  v_id := public.reservas_reportar_pago$x$);
select pg_temp.nomenclatura_parchar('public.cobranzas_reportar_pago(uuid,numeric,date,text,text,jsonb,text)',
 $x$v_id := public.cobranzas_reportar_pago$x$,
 $x$perform set_config('app.constancia_medio',p_medio,true);
  v_id := public.cobranzas_reportar_pago$x$);
do $$ declare firma text; v_def text;
begin
 foreach firma in array array['public.reservas_reportar_pago(uuid,numeric,date,text,text,jsonb,text)','public.cobranzas_reportar_pago(uuid,numeric,date,text,text,jsonb,text)'] loop
  v_def:=pg_get_functiondef(to_regprocedure(firma));
  if position('set_config(''app.constancia_medio'','''',true)' in v_def)=0 then
   execute replace(v_def,'return v_id;','perform set_config(''app.constancia_medio'','''',true); return v_id;');
  end if;
 end loop;
end $$;

update public.plan_activities set nombre=replace(replace(nombre,'edificio 1','edificio A'),'edificio 2','edificio B'),
 descripcion=replace(replace(descripcion,'edificio 1','edificio A'),'edificio 2','edificio B')
where nombre ~ 'edificio [12]' or descripcion ~ 'edificio [12]';

-- Reversión conservadora: nunca suprimir instantáneas ni volver a un generador antiguo después de emitir documentos.
create or replace function public.nomenclatura_permitir_reversion() returns void language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from quotes where unidad_snapshot is not null)
 or exists(select 1 from recibos_pago where unidad_snapshot is not null)
 or exists(select 1 from comprobantes_pago where constancia_snapshot is not null)
 or exists(select 1 from mortgage_simulations where unidad_snapshot is not null)
 or exists(select 1 from contract_document_versions where datos->'unidad'->>'departamento' ~ '^[AB][0-5]0[1-7]$') then
  raise exception 'Ya existen documentos emitidos con la nomenclatura nueva. Conservar sus instantáneas y aplicar una recuperación compatible; no ejecutar esta reversión';
 end if;
end $$;
revoke all on function public.nomenclatura_permitir_reversion() from public,anon,authenticated;

-- Verifica todos los campos originales: el único campo nuevo de Inventario es dpt_anterior.
do $$ begin
 if (select jsonb_agg(datos order by codigo) from nomenclatura_inventario_antes) is distinct from
    (select jsonb_agg(to_jsonb(u)-'dpt_anterior' order by codigo) from public.inventory_units u) then
  raise exception '0016 alteraría datos existentes del inventario: transacción cancelada';
 end if;
end $$;
commit;
