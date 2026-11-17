-- AMURA · Limpieza de datos de prueba · RECUPERACIÓN (solo si hiciera falta deshacer el PASO 2).
-- Vuelve a insertar desde respaldo_limpieza_20261117 todo lo que se borró y restaura el estado de esas unidades.
-- Una sola transacción. Requiere que el respaldo exista y que no se hayan reutilizado esas unidades con operaciones nuevas.

begin;

do $$
begin
  if to_regclass('respaldo_limpieza_20261117.clients') is null then raise exception 'No existe el respaldo'; end if;
  if exists (select 1 from public.inventory_units u join respaldo_limpieza_20261117.inventory_units b on b.codigo = u.codigo
              where b.reserva_id in (select id from respaldo_limpieza_20261117.reservations) and u.reserva_id is not null) then
    raise exception 'Alguna de esas unidades ya tiene otra reserva: recuperar exige revisión manual';
  end if;
end $$;

select set_config('app.flujo', 'on', true);
select set_config('app.cumplimiento', 'on', true);

-- Los disparadores de alta (avisos, historial, numeración, montos) no deben recalcular datos restaurados.
set local session_replication_role = replica;

insert into public.clients select * from respaldo_limpieza_20261117.clients on conflict (id) do nothing;
insert into public.client_activities select * from respaldo_limpieza_20261117.client_activities on conflict (id) do nothing;
insert into public.client_assignment_history select * from respaldo_limpieza_20261117.client_assignment_history on conflict (id) do nothing;
insert into public.opportunities select * from respaldo_limpieza_20261117.opportunities on conflict (id) do nothing;
insert into public.opportunity_events select * from respaldo_limpieza_20261117.opportunity_events on conflict (id) do nothing;
insert into public.quotes select * from respaldo_limpieza_20261117.quotes on conflict (id) do nothing;
insert into public.ordenes_contrato select * from respaldo_limpieza_20261117.ordenes_contrato on conflict (id) do nothing;
insert into public.expediente_documentos select * from respaldo_limpieza_20261117.expediente_documentos on conflict (id) do nothing;
insert into public.reservations select * from respaldo_limpieza_20261117.reservations on conflict (id) do nothing;
insert into public.reservas_cumplimiento_historial select * from respaldo_limpieza_20261117.reservas_cumplimiento_historial on conflict (id) do nothing;
insert into public.desistimientos select * from respaldo_limpieza_20261117.desistimientos on conflict (id) do nothing;
insert into public.comprobantes_pago select * from respaldo_limpieza_20261117.comprobantes_pago on conflict (id) do nothing;
insert into public.recibos_pago select * from respaldo_limpieza_20261117.recibos_pago on conflict (id) do nothing;
insert into public.cobranza_alertas select * from respaldo_limpieza_20261117.cobranza_alertas on conflict (id) do nothing;

update public.inventory_units u set estado = b.estado, reserva_id = b.reserva_id, updated_at = b.updated_at
  from respaldo_limpieza_20261117.inventory_units b
 where b.codigo = u.codigo and b.reserva_id in (select id from respaldo_limpieza_20261117.reservations);
delete from public.inventory_status_history where motivo like 'Limpieza de datos de prueba (2026-11-17)%';

set local session_replication_role = origin;
commit;
