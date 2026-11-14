#!/usr/bin/env bash
# AMURA · Ensayo de migraciones sobre una copia restaurada del respaldo. No toca Supabase.
# Restaura el respaldo en un PostgreSQL temporal, toma la huella de cada tabla existente (solo sus columnas actuales),
# aplica las migraciones indicadas en orden y compara: ninguna fila existente debe cambiar ni desaparecer.
# Uso: bash scripts/ensayo-migraciones.sh <archivo.dump> <migracion1.sql> [migracion2.sql ...]
set -euo pipefail
DUMP="$1"; shift
BIN="${PG_BIN:-/c/Program Files/PostgreSQL/18/bin}"
export PATH="$BIN:$PATH"
TMP="$(mktemp -d)"; PUERTO=55437; BASE=ensayo
L=(-h 127.0.0.1 -p "$PUERTO" -U postgres)
trap 'pg_ctl -D "$TMP/datos" -m fast -w stop >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

initdb -D "$TMP/datos" -U postgres -A trust -E UTF8 --locale=C >/dev/null
pg_ctl -D "$TMP/datos" -l "$TMP/servidor.log" -o "-p $PUERTO -c listen_addresses=127.0.0.1" -w start >/dev/null
psql "${L[@]}" -d postgres -qc "create database $BASE"
for r in anon authenticated service_role authenticator supabase_auth_admin supabase_storage_admin supabase_admin dashboard_user; do psql "${L[@]}" -d $BASE -qc "create role $r nologin" >/dev/null 2>&1 || true; done
psql "${L[@]}" -d $BASE -qc 'drop schema public cascade'
for e in pgcrypto "uuid-ossp"; do psql "${L[@]}" -d $BASE -qc "create schema if not exists extensions; create extension if not exists \"$e\" schema extensions" >/dev/null 2>&1 || true; done
pg_restore "${L[@]}" -d $BASE --no-owner --no-privileges "$DUMP" 2> "$TMP/restaurar.txt" || true
echo "Errores de restauración: $(grep -c 'pg_restore: error' "$TMP/restaurar.txt" || true)"
psql "${L[@]}" -d $BASE -qc "alter database $BASE set search_path = public, extensions"

# Huella por tabla, solo con las columnas que existen antes de migrar.
psql "${L[@]}" -d $BASE -Atc "create table public._ensayo_columnas as select table_schema, table_name, string_agg(quote_ident(column_name), ', ' order by column_name) as cols
  from information_schema.columns where table_schema in ('public', 'auth', 'storage') and table_name in (select table_name from information_schema.tables t where t.table_schema = columns.table_schema and t.table_type = 'BASE TABLE')
  group by 1, 2" >/dev/null
HUELLA="select c.table_schema || '.' || c.table_name || '|' || (xpath('/row/n/text()', x))[1]::text || '|' || (xpath('/row/h/text()', x))[1]::text
  from public._ensayo_columnas c, lateral query_to_xml(format('select count(*) as n, md5(coalesce(string_agg(t::text, ''|'' order by t::text collate \"C\"), '''')) as h from (select %s from %I.%I) t', c.cols, c.table_schema, c.table_name), false, true, '') x
  where c.table_name <> '_ensayo_columnas' order by 1"
psql "${L[@]}" -d $BASE -At -c "$HUELLA" > "$TMP/antes.txt"
echo "Tablas comparadas: $(wc -l < "$TMP/antes.txt")"

psql "${L[@]}" -d $BASE -qc "create table public._ensayo_roles as select * from public.roles; create table public._ensayo_permissions as select * from public.permissions; create table public._ensayo_role_permissions as select * from public.role_permissions"

for m in "$@"; do
  echo "Aplicando $(basename "$m")"
  psql "${L[@]}" -d $BASE -q -v ON_ERROR_STOP=1 --single-transaction -f "$m" > "$TMP/migracion.txt" 2>&1 || { cat "$TMP/migracion.txt"; echo 'ENSAYO FALLIDO'; exit 1; }
done
# Repetir no debe fallar ni cambiar nada.
for m in "$@"; do psql "${L[@]}" -d $BASE -q -v ON_ERROR_STOP=1 --single-transaction -f "$m" > "$TMP/migracion.txt" 2>&1 || { cat "$TMP/migracion.txt"; echo 'REPETIR FALLÓ'; exit 1; }; done

psql "${L[@]}" -d $BASE -At -c "$HUELLA" > "$TMP/despues.txt"
if diff "$TMP/antes.txt" "$TMP/despues.txt" > "$TMP/dif.txt"; then
  echo 'Filas existentes: SIN CAMBIOS'
else
  # Las tablas de permisos y roles reciben filas nuevas (permisos y rol nuevos): se muestran para revisarlas.
  cat "$TMP/dif.txt"
fi
echo "Roles, permisos y asignaciones anteriores que cambiaron o faltan (debe ser 0 0 0):"
psql "${L[@]}" -d $BASE -At -c "select (select count(*) from (select * from public._ensayo_roles except select * from public.roles) a), (select count(*) from (select * from public._ensayo_permissions except select * from public.permissions) b), (select count(*) from (select * from public._ensayo_role_permissions except select * from public.role_permissions) c)"
echo "Filas nuevas por tabla:"
psql "${L[@]}" -d $BASE -At -c "select table_name || ' ' || n from (select 'roles' table_name, count(*) n from public.roles union all select 'permissions', count(*) from public.permissions union all select 'role_permissions', count(*) from public.role_permissions union all select 'cobranza_alertas', count(*) from public.cobranza_alertas) x"
echo 'ENSAYO TERMINADO'
