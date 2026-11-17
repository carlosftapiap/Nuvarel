-- AMURA · Cuentas bancarias oficiales para recibir pagos (sin ejecutar en producción).
-- Completa la configuración de cobros: además de quién recibe los pagos (payment_settings), se registran
-- las cuentas bancarias autorizadas de esa empresa o fiduciaria.
--   · Solo cuentas de sociedades o entidades: el RUC debe ser de 13 dígitos, terminar en 001 y tener tercer dígito
--     6 (entidad pública) o 9 (sociedad privada, incluida la fiduciaria). Un RUC de persona natural (tercer dígito 0 a 5)
--     se rechaza: no se aceptan cuentas personales.
--   · Solo el permiso config.cobros registra o desactiva cuentas, con motivo. Nada se borra: desactivar conserva el historial.
--   · Todos los perfiles autenticados ven las cuentas activas (el vendedor las indica al cliente).
-- Solo agrega una tabla y dos funciones. No modifica pagos, comprobantes ni reservas.

create table if not exists public.cuentas_receptoras (
  id uuid primary key default gen_random_uuid(),
  receptor text not null check (receptor in ('NUVAREL', 'JARVAL', 'FIDUCIARIA')),
  titular text not null check (char_length(btrim(titular)) between 3 and 160),
  ruc text not null check (ruc ~ '^[0-9]{2}[69][0-9]{7}001$'),
  banco text not null check (char_length(btrim(banco)) between 2 and 80),
  tipo text not null check (tipo in ('corriente', 'ahorros')),
  numero text not null check (numero ~ '^[0-9]{6,20}$'),
  activa boolean not null default true,
  creada_por uuid references auth.users (id),
  creada_en timestamptz not null default now(),
  desactivada_por uuid references auth.users (id),
  desactivada_en timestamptz,
  motivo_baja text,
  unique (banco, numero),
  check (activa or desactivada_en is not null)
);

alter table public.cuentas_receptoras enable row level security;
revoke insert, update, delete on public.cuentas_receptoras from anon, authenticated;
grant select on public.cuentas_receptoras to authenticated;
drop policy if exists "cuentas receptoras consultar" on public.cuentas_receptoras;
create policy "cuentas receptoras consultar" on public.cuentas_receptoras for select to authenticated
  using (activa or public.tiene_permiso('config.cobros'));

-- Registra una cuenta oficial. Mensajes claros para cada error frecuente.
create or replace function public.config_cuenta_registrar(
  p_receptor text, p_titular text, p_ruc text, p_banco text, p_tipo text, p_numero text, p_motivo text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_ruc text := regexp_replace(coalesce(p_ruc, ''), '\D', '', 'g'); v_num text := regexp_replace(coalesce(p_numero, ''), '\D', '', 'g'); v_id uuid;
begin
  if auth.uid() is null or not public.tiene_permiso('config.cobros') then
    raise exception 'Sin permiso para registrar cuentas de cobro' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Indica el motivo o el respaldo de la cuenta'; end if;
  if p_receptor not in ('NUVAREL', 'JARVAL', 'FIDUCIARIA') then raise exception 'Receptor no válido: %', p_receptor; end if;
  if v_ruc !~ '^[0-9]{10}001$' then raise exception 'El RUC debe tener 13 dígitos y terminar en 001'; end if;
  if substr(v_ruc, 3, 1) not in ('6', '9') then
    raise exception 'El RUC corresponde a una persona natural: solo se aceptan cuentas de la empresa o de la fiduciaria';
  end if;
  if v_num !~ '^[0-9]{6,20}$' then raise exception 'Número de cuenta no válido'; end if;
  if exists (select 1 from cuentas_receptoras where banco = btrim(p_banco) and numero = v_num) then
    raise exception 'Esa cuenta ya está registrada';
  end if;
  insert into cuentas_receptoras (receptor, titular, ruc, banco, tipo, numero, creada_por)
  values (p_receptor, btrim(p_titular), v_ruc, btrim(p_banco), p_tipo, v_num, auth.uid())
  returning id into v_id;
  perform public.auditar('Registrar cuenta de cobro', 'cobros', v_id::text, btrim(p_motivo), null,
    jsonb_build_object('receptor', p_receptor, 'titular', btrim(p_titular), 'ruc', v_ruc, 'banco', btrim(p_banco), 'tipo', p_tipo, 'numero', right(v_num, 4)), null);
  return v_id;
end $$;

-- Desactiva una cuenta. Se conserva con su motivo; deja de mostrarse a los vendedores.
create or replace function public.config_cuenta_desactivar(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.tiene_permiso('config.cobros') then
    raise exception 'Sin permiso para desactivar cuentas de cobro' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Indica el motivo de la desactivación'; end if;
  update cuentas_receptoras set activa = false, desactivada_por = auth.uid(), desactivada_en = now(), motivo_baja = btrim(p_motivo)
   where id = p_id and activa;
  if not found then raise exception 'La cuenta no existe o ya está desactivada'; end if;
  perform public.auditar('Desactivar cuenta de cobro', 'cobros', p_id::text, btrim(p_motivo), jsonb_build_object('activa', true), jsonb_build_object('activa', false), null);
end $$;

revoke all on function public.config_cuenta_registrar(text, text, text, text, text, text, text) from public, anon;
revoke all on function public.config_cuenta_desactivar(uuid, text) from public, anon;
grant execute on function public.config_cuenta_registrar(text, text, text, text, text, text, text) to authenticated;
grant execute on function public.config_cuenta_desactivar(uuid, text) to authenticated;
