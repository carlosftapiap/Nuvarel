-- AMURA · Valor predeterminado de la reserva, configurable. Es solo la propuesta inicial en la pantalla de venta:
-- el monto de cada reserva sigue siendo editable hasta el 6 % con reservas_fijar_monto.
-- Aditiva: no modifica reservas, cotizaciones ni pagos existentes. Se puede repetir.
-- Revertir: drop function public.config_reserva_predeterminada(numeric, text);
--           alter table public.pricing_params drop column reserva_predeterminada;
-- Ejecutar después de 20261031130000_documentos_contractuales.sql y con un respaldo verificado.

alter table public.pricing_params add column if not exists reserva_predeterminada numeric(14,2) not null default 500;
alter table public.pricing_params drop constraint if exists pricing_params_reserva_predeterminada;
alter table public.pricing_params add constraint pricing_params_reserva_predeterminada check (reserva_predeterminada > 0);

create or replace function public.config_reserva_predeterminada(p_monto numeric, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_antes numeric;
begin
  if not public.tiene_permiso('config.cobros') then raise exception 'Sin permiso para cambiar la reserva predeterminada' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Motivo obligatorio'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'La reserva predeterminada debe ser mayor a cero'; end if;
  select reserva_predeterminada into v_antes from pricing_params where id = 1 for update;
  update pricing_params set reserva_predeterminada = p_monto where id = 1;
  perform public.auditar('Cambiar reserva predeterminada', 'cobros', '1', trim(p_motivo),
    jsonb_build_object('reserva_predeterminada', v_antes), jsonb_build_object('reserva_predeterminada', p_monto));
end $$;

revoke all on function public.config_reserva_predeterminada(numeric, text) from public, anon;
grant execute on function public.config_reserva_predeterminada(numeric, text) to authenticated;
