# Habilitar Clientes y el desistimiento en producción

Estado: **probado en local contra una copia del estado de producción. Nada de esto se ha ejecutado en producción, y falta probarlo en un proyecto alojado de pruebas.** Cada paso con ⚠️ escribe en la base y necesita tu autorización.

## Qué se va a aplicar

| Orden | Archivo | Qué hace | Efecto sobre datos |
|---|---|---|---|
| 1 | `instalacion/correctivo_clientes_produccion.sql` | Agrega lo que falta de Clientes: `client_access`, `client_import_settings`, `clients.documento`, `clients.corredor_origen_id` y sus funciones. Actualiza 9 funciones y 4 políticas | No borra. Se detiene si ya hay clientes u oportunidades |
| 2 | `migrations/20261031030000_desistimiento.sql` | Tabla `desistimientos`, permiso `ventas.desistimiento`, registro de desistimiento y anulación de reservas que libera la unidad solo si corresponde | No borra. Reemplaza `reservas_anular` |

No incluye el Gantt (`20261030000000`). `20261031020000_ventas_contratos.sql` ya está en producción: no se repite.

### Impacto en permisos

- **Quién ve un cliente** cambia a: asesor actual, responsable de una negociación abierta o autorización expresa, según el alcance de cada usuario. Quien lo registró deja de verlo si se reasigna. Hoy hay 0 clientes, así que nadie pierde acceso a nada existente.
- **Nadie escribe directo** en `clients` ni en `opportunities`: solo mediante funciones. La app ya funciona así.
- **Desistimiento:** lo pueden registrar administración, gerencia, supervisor, vendedor y corredor, dentro de su alcance. Un corredor podrá liberar una unidad de su propio cliente. Si prefieres que eso requiera aprobación, avísame antes de aplicarlo.
- **El origen del cliente queda fijo** al crearlo. Solo `corredores.gestionar` lo corrige, con auditoría.

## 1. Diagnóstico (solo lectura)

1. Abre el proyecto `sjjjlnqgcaqtkmzdcmog` → **SQL Editor** → **New query**.
2. Pega todo `instalacion/diagnostico_solo_lectura.sql` y pulsa **Run**. Es una sola consulta y no escribe nada.
3. En Resultados, usa **Export → Copy as JSON** (o CSV) y compártelo. No contiene claves ni datos de personas.

Debe mostrar: `clientes_crear` y las demás como `version anterior`, `client_access` como `NO EXISTE`, y `registros` de `clients` en 0. Si aparece `OTRA VERSION`, **detente y compártelo**: el correctivo se probó contra la versión anterior conocida.

## 2. Respaldo externo ⚠️ (solo lee, pero exporta datos)

Supabase Free no ofrece respaldos descargables desde el panel: hazlo con `pg_dump`.

**Instalar:** PostgreSQL **de la misma versión mayor o superior** al servidor (la fila `version` del diagnóstico), desde https://www.postgresql.org/download/windows/. Basta "Command Line Tools".

**Obtener la conexión sin exponerla:** panel de Supabase → botón **Connect** → **Session pooler** (funciona con IPv4). Toma de ahí el host y el usuario, que tiene la forma `postgres.sjjjlnqgcaqtkmzdcmog`. La contraseña es la de la base de datos; si no la tienes, se cambia en **Project Settings → Database**. No la pegues en el chat, en archivos ni en el historial.

En PowerShell, en una carpeta **fuera del repositorio** (cambia `<HOST>` y la ruta de `bin` si tu versión es otra):

```powershell
$env:Path += ";C:\Program Files\PostgreSQL\17\bin"
$seg = Read-Host "Contraseña de la base" -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($seg))
$env:PGSSLMODE = "require"
$c = @("-h", "<HOST>", "-p", "5432", "-U", "postgres.sjjjlnqgcaqtkmzdcmog", "-d", "postgres")
$f = Get-Date -Format "yyyyMMdd-HHmm"

# Esquema y datos de la aplicación
pg_dump @c --schema=public --no-owner --no-privileges --format=custom --file="amura-public-$f.dump"
# Permisos de la aplicación, en texto legible
pg_dump @c --schema=public --schema-only --file="amura-public-esquema-$f.sql"
# Usuarios de Auth (datos sensibles: contiene hashes de contraseñas)
pg_dump @c --schema=auth --data-only --file="amura-auth-datos-$f.sql"
# Metadatos de Storage (no incluye los archivos)
pg_dump @c --schema=storage --data-only --file="amura-storage-metadatos-$f.sql"

Remove-Item Env:PGPASSWORD
Get-ChildItem amura-* | Select-Object Name, Length
```

Tratamiento aparte:

- **Auth:** el archivo trae correos y hashes de contraseñas. Guárdalo cifrado. Sin él se restauran las tablas, pero los perfiles quedan sin cuenta. El esquema `auth` lo administra Supabase: en la restauración solo se cargan sus datos.
- **Storage:** `pg_dump` solo guarda metadatos. Los archivos se descargan aparte desde **Storage**, bucket por bucket, o con la CLI de Supabase. Si no usas buckets, no hay nada que descargar.
- **Funciones Edge y variables secretas:** no están en estos archivos. El código de las funciones está en `supabase/functions`; las variables se vuelven a configurar a mano.
- Estos archivos **no se suben a Git**.

## 3. Verificar que el respaldo restaura ⚠️

Un respaldo no cuenta hasta restaurarlo. Hazlo en un proyecto de Supabase **separado y vacío**, con su propio host:

```powershell
$d = @("-h", "<HOST_PRUEBAS>", "-p", "5432", "-U", "postgres.<ID_PRUEBAS>", "-d", "postgres")
psql @d -c "select current_database(), inet_server_addr();"   # confirma que NO es producción
psql @d -c "set session_replication_role = replica;" -f "amura-auth-datos-<FECHA>.sql"
pg_restore @d --no-owner --no-privileges --schema=public --dbname=postgres "amura-public-<FECHA>.dump"
```

Después ejecuta `diagnostico_solo_lectura.sql` en ambos proyectos y compara: mismas filas en `registros`, mismas huellas en `funcion`. Entra a la app contra ese proyecto (ver `ENTORNO_PRUEBAS.md`) con una cuenta restaurada.

Solo si eso coincide, hay respaldo verificado. **Este procedimiento no se ha probado todavía: en este equipo no hay `pg_dump` ni acceso a tu base.** Si algún comando falla, envíame el mensaje de error (sin la contraseña).

## 4. Probar en un proyecto de pruebas ⚠️

Antes de producción, en el proyecto de pruebas de `ENTORNO_PRUEBAS.md`: ejecuta el correctivo, luego el desistimiento, luego `validar_rls.sql`, y recorre la lista del paso 7.

## 5. Aplicar en producción ⚠️ (requiere tu autorización específica)

1. Vuelve a ejecutar el diagnóstico. Si cambió algo desde el respaldo, detente.
2. En **SQL Editor**, ejecuta `instalacion/correctivo_clientes_produccion.sql` completo. Es todo o nada.
3. Ejecuta `migrations/20261031030000_desistimiento.sql` completo.

Si el correctivo se detiene con "Ya hay clientes", no cambió nada. Avísame antes de seguir.

## 6. Publicar la aplicación ⚠️

La rama `integracion-supabase` no está desplegada ni tiene push. La app publicada debe actualizarse **después** del paso 5, para que no llame a funciones que aún no existen. No lo he hecho.

## 7. Verificar después

Ejecuta el diagnóstico: las funciones deben decir `igual al repositorio actual`, salvo lo indicado abajo.

Con dos navegadores (o uno en incógnito) y usuarios reales autorizados:

| # | Quién | Prueba | Esperado |
|---|---|---|---|
| 1 | Corredor A | Crea el cliente `PRUEBA Borrar` | Se guarda sin aviso de migración |
| 2 | Corredor A | Cierra sesión y vuelve a entrar | Sigue ahí |
| 3 | Corredor B | Busca ese cliente | No lo ve |
| 4 | Administrador | Lo ve y lo reasigna a B con motivo | A deja de verlo; B lo ve; el origen no cambia |
| 5 | Corredor B | Registra una llamada | Pasa a Contactado y queda en el historial |
| 6 | Corredor B | Abre una negociación y registra el desistimiento | Se cierra; el cliente pasa a Perdido; la unidad no cambia |
| 7 | Administrador | Revisa Configuración → Auditoría | Figuran reasignación y desistimiento con motivo |

**Estas pruebas dejan registros reales**, porque nada se borra desde la app. El cliente quedará como Perdido, con el nombre `PRUEBA`. Evita probar con una reserva aprobada en producción: libera y bloquea unidades reales. Eso se prueba en el proyecto de pruebas.

## Queda fuera a propósito

- `contrato_datos_venta` en producción no guarda `origen_detalle`: un contrato tendría ese dato vacío. Es un cambio de una línea en Ventas, pendiente de tu decisión.
- Si el diagnóstico muestra `cotizaciones_emitir guarda la cedula: NO`, la cotización no llevará la cédula. También es una corrección aparte.
- Cotizaciones y reservas guardadas solo en navegadores: ver `ENTORNO_PRUEBAS.md`.

## Volver atrás

El correctivo y el desistimiento son aditivos y transaccionales: si fallan, no cambian nada. Si después de aplicarlos hay un problema, **no borres nada**: envíame el error. La referencia para restaurar la definición anterior es `amura-public-esquema-<FECHA>.sql`.
