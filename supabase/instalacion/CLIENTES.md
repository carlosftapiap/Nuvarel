# Clientes conectado a Supabase · instalación y verificación

Estado: **probado en la base local** (Postgres real con las migraciones del proyecto, RLS y usuarios de prueba). **No aplicado en producción ni verificado contra el proyecto alojado.** Requiere tu autorización antes de cada paso marcado con ⚠️.

## Qué cambia

| Archivo | Qué hace |
|---|---|
| `migrations/20261031000000_clientes_crm.sql` | Funciones de servidor para clientes, negociaciones, accesos e importación. Agrega columnas (`version`, `documento`, `corredor_origen_id`, `referencia`, `tipologia`) y las tablas `client_imports`, `client_access` y `client_import_settings`. **Quita la escritura directa** en `clients`, `client_activities`, `opportunities` y `opportunity_events`, y **cambia quién ve a un cliente**: su asesor actual, quien tenga una negociación abierta o una autorización expresa, según su alcance. Quien lo registró ya no lo ve si se reasigna. No borra ni cambia datos. |
| `migrations/20261031010000_integracion_comercial.sql` | Cotizaciones y reservas se leen y operan según el acceso al cliente, no según quién las creó. Cada contrato guarda asesor, responsable, atribución, corredor de origen y origen al generarse. No crea comisiones. |
| `src/features/clientes`, `cotizaciones` y `reservas` (`remoto.ts`, `store`) | Con Supabase configurado, la app lee y guarda en la base. Sin configuración sigue en el navegador. |

**Importante:** el código nuevo ya usa estas funciones. Mientras las migraciones no se apliquen, la app conectada muestra los clientes de la base y un aviso, pero **no permite guardar clientes, cotizaciones ni reservas**, y lo guardado en el navegador no se toca. Las cotizaciones y reservas que estén solo en el navegador no se importan: dejarían de verse en modo conectado, aunque la copia local se conserva.

Despliegue en producción: `DESPLIEGUE_PRODUCCION.md`.

Estas migraciones no dependen de `20261030000000_plan_responsable_externo.sql`: pueden aplicarse por separado.

## 1. Comprobaciones previas (solo lectura)

Ejecuta en el SQL Editor. Debe devolver `true` en todas las columnas:

```sql
select to_regclass('public.opportunities') is not null as oportunidades,
       to_regprocedure('public.cliente_en_alcance(uuid)') is not null as alcance,
       to_regprocedure('public.reservas_anular(uuid, text)') is not null as reservas,
       to_regprocedure('public.auditar(text, text, text, text, jsonb, jsonb, text)') is not null as auditoria;
```

Cuántos datos existen hoy, para comparar después:

```sql
select (select count(*) from public.clients) as clientes,
       (select count(*) from public.client_activities) as actividades,
       (select count(*) from public.opportunities) as oportunidades;
```

Haz una copia de seguridad del proyecto antes de continuar.

## 2. Aplicar las migraciones ⚠️

Ejecuta en el SQL Editor, previo respaldo, `20261031000000_clientes_crm.sql`, luego `20261031010000_integracion_comercial.sql` y luego `20261031020000_ventas_contratos.sql`. Se pueden repetir sin efectos.

Vuelve a ejecutar la consulta de conteo: los números deben coincidir.

## 3. Verificar con usuarios de prueba

Crea desde Configuración un administrador, un supervisor con un equipo, y dos corredores (uno dentro del equipo y otro fuera). Marca cada punto en la app:

| # | Prueba | Resultado esperado |
|---|---|---|
| 1 | Corredor A crea un cliente | Aparece en Nuevo y en `select * from clients` |
| 2 | Cerrar sesión y volver a entrar | Sigue ahí |
| 3 | Entrar con el mismo usuario en otro navegador | Aparece sin importar nada |
| 4 | Corredor B entra | No lo ve |
| 5 | Supervisor del equipo de A entra | Lo ve; no ve los de B |
| 6 | Administrador lo reasigna a B, con motivo | B lo ve; `audit_log` tiene motivo, responsable anterior y nuevo; `atribucion_usuario_id` no cambia |
| 7 | Registrar una llamada | Pasa a Contactado y queda en `client_activities` |
| 8 | Arrastrar a otra etapa | Persiste al recargar |
| 9 | Registrar otro cliente con el mismo teléfono desde otro equipo | Se rechaza, sin revelar de quién es |
| 10 | Intentar elegir Reserva | No se puede |
| 11 | Abrir dos negociaciones del mismo cliente | Dos oportunidades, una sola ficha |
| 12 | En un navegador con clientes locales: "Revisar e importar" | Vista previa, importación, comprobación y archivo de la copia local |
| 13 | Corredor genera una cotización desde la ficha | Queda en `quotes`, ligada a cliente y negociación; los datos del cliente no se reescriben |
| 14 | Solicitar reserva, registrar comprobante, Finanzas verifica, Gerencia aprueba | La unidad solo se bloquea y el cliente solo pasa a Reserva al aprobar |
| 15 | Tras la reasignación del punto 6 | A deja de ver cliente, cotización y reserva; B los ve; el origen no cambia |
| 16 | Administración cierra la importación | El equipo ya no puede importar; administración sí |

Comprobación de seguridad (con la sesión de un corredor, desde la consola del navegador o con su token):

```js
await supabase.from('clients').update({ etapa: 'visita' }).eq('id', '<id de su cliente>')
// Debe fallar con "row-level security"
await supabase.from('clients').insert({ nombre: 'Directo', telefono: '0990000000', origen: 'whatsapp', asesor_id: '<su id>', created_by: '<su id>' })
// Debe fallar con "row-level security"
```

## 4. Si hay que volver atrás ⚠️

Las migraciones son aditivas: las columnas, tablas y funciones nuevas pueden quedarse. Para devolver la visibilidad anterior (quien registró sigue viendo al cliente) y la escritura directa en clientes:

```sql
create or replace function public.cliente_en_alcance(p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from clients c where c.id = p_client and (public.en_alcance(c.asesor_id) or public.en_alcance(c.created_by)))
$$;
drop policy if exists "ver clientes" on public.clients;
create policy "ver clientes" on public.clients for select to authenticated
  using (public.tiene_permiso('clientes.ver') and (public.en_alcance(asesor_id) or public.en_alcance(created_by)));
drop policy if exists "editar clientes" on public.clients;
create policy "crear clientes" on public.clients for insert to authenticated
  with check (public.tiene_permiso('clientes.editar') and created_by = auth.uid()
              and (asesor_id = auth.uid() or (public.tiene_permiso('clientes.asignar') and public.en_alcance(asesor_id))));
create policy "editar clientes" on public.clients for update to authenticated
  using (public.tiene_permiso('clientes.editar') and (public.en_alcance(asesor_id) or public.en_alcance(created_by)))
  with check (public.en_alcance(asesor_id) or public.en_alcance(created_by));
create policy "registrar actividades" on public.client_activities for insert to authenticated
  with check (user_id = auth.uid() and public.tiene_permiso('clientes.editar') and public.cliente_en_alcance(client_id));
```

La versión anterior de la app, conectada a esta base, seguiría guardando clientes en el navegador: esto solo revierte permisos.
