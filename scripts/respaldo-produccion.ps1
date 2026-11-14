# AMURA · Respaldo manual de producción y comprobación de que se puede restaurar. Solo lee producción.
# Uso:
#   powershell -ExecutionPolicy Bypass -File "<repo>\scripts\respaldo-produccion.ps1" -Servidor <host del Session pooler>
# Pide la contraseña sin mostrarla. La restauración de prueba usa un PostgreSQL temporal que se borra al terminar.
# Los archivos contienen datos de clientes y hashes de contraseñas: nunca en Git, en dist/ ni en carpetas públicas.
param(
  [Parameter(Mandatory = $true)][string]$Servidor,
  [string]$Proyecto = 'sjjjlnqgcaqtkmzdcmog',
  [string]$Destino = 'D:\Empresas\NUVAREL\Respaldos-Supabase',
  [string]$BinPostgres = '',
  [int]$Puerto = 5432,
  # Otro usuario de base de datos, p. ej. el acceso temporal que crea la CLI de Supabase (cli_login_postgres.<proyecto>).
  # Con PGPASSWORD ya definida en el entorno no se pide la contraseña.
  [string]$Usuario = ''
)
if (-not $Usuario) { $Usuario = "postgres.$Proyecto" }
if (-not $BinPostgres) { $BinPostgres = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin' -ErrorAction SilentlyContinue | Sort-Object { [int]$_.Parent.Name } | Select-Object -Last 1 -ExpandProperty FullName }
if ($BinPostgres) { $env:Path = "$BinPostgres;$env:Path" }
foreach ($h in 'pg_dump', 'pg_restore', 'psql', 'initdb', 'pg_ctl', 'pg_isready') { if (-not (Get-Command $h -ErrorAction SilentlyContinue)) { throw "No encuentro $h. Instala PostgreSQL o indica -BinPostgres." } }

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$destinoFull = [IO.Path]::GetFullPath($Destino)
if ($destinoFull.StartsWith($repo, [StringComparison]::OrdinalIgnoreCase)) { throw 'El respaldo no puede guardarse dentro del repositorio.' }

$f = Get-Date -Format 'yyyyMMdd-HHmm'
$carpeta = Join-Path $destinoFull "amura-respaldo-$f"
New-Item -ItemType Directory -Path $carpeta -Force -ErrorAction Stop | Out-Null
# Solo la cuenta actual puede abrir la carpeta.
& icacls $carpeta /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" | Out-Null
$dump = Join-Path $carpeta "amura-$f.dump"

# Los esquemas con datos de AMURA, de sus cuentas y de las referencias a sus archivos.
$esquemas = "'public', 'auth', 'storage'"
$sinExtension = "not exists (select 1 from pg_depend d where d.objid = {0} and d.deptype = 'e')"
$sqlFilas = Join-Path $carpeta 'consulta-filas.sql'
$sqlObjetos = Join-Path $carpeta 'consulta-objetos.sql'
$sqlExtensiones = Join-Path $carpeta 'consulta-extensiones.sql'
# Filas y huella del contenido de cada tabla: comparar solo cantidades no demuestra que los datos sean los mismos.
@"
select schemaname || '.' || relname as tabla,
  (xpath('/row/c/text()', x))[1]::text::bigint as filas, (xpath('/row/h/text()', x))[1]::text as huella
from pg_stat_user_tables, lateral query_to_xml(format('select count(*) as c, md5(coalesce(string_agg(t::text, ''|'' order by t::text collate "C"), '''')) as h from %I.%I t', schemaname, relname), false, true, '') x
where schemaname in ($esquemas) order by 1 collate "C";
"@ | Out-File $sqlFilas -Encoding ascii
@"
select tipo, n from (
  select 'tablas.' || n.nspname as tipo, count(*)::text as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r', 'p') and n.nspname in ($esquemas) and $($sinExtension -f 'c.oid') group by 1
  union all select 'vistas.' || n.nspname, count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('v', 'm') and n.nspname in ($esquemas) and $($sinExtension -f 'c.oid') group by 1
  union all select 'indices.' || n.nspname, count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'i' and n.nspname in ($esquemas) and $($sinExtension -f 'c.oid') group by 1
  union all select 'tablas_con_rls.' || n.nspname, count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r', 'p') and c.relrowsecurity and n.nspname in ($esquemas) group by 1
  union all select 'politicas.' || schemaname, count(*)::text from pg_policies where schemaname in ($esquemas) group by 1
  union all select 'funciones.' || n.nspname, count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ($esquemas) and $($sinExtension -f 'p.oid') group by 1
  union all select 'triggers.' || n.nspname, count(*)::text from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where not t.tgisinternal and n.nspname in ($esquemas) group by 1
) o order by 1 collate "C";
"@ | Out-File $sqlObjetos -Encoding ascii
"select e.extname || '|' || n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname <> 'plpgsql' order by 1;" | Out-File $sqlExtensiones -Encoding ascii

@"
QUÉ INCLUYE
- Esquemas public, auth y storage: estructura, datos, funciones, políticas, triggers y permisos.
  Comprende usuarios, perfiles, clientes, reservas, contratos, pagos y cobranzas.

QUÉ NO INCLUYE
- Archivos de Supabase Storage (comprobantes, documentos, plantillas, multimedia): solo sus referencias. Los archivos se descargan aparte.
- Configuración de Auth: URL y redirecciones, proveedores, SMTP, plantillas de correo, registro público y claves JWT.
- Funciones Edge y sus secretos: el código está en supabase/functions del repositorio; los secretos, en el panel.
- Roles del servidor y extensiones: extensiones-produccion.txt lista las que hay que reinstalar.
- Otros esquemas de Supabase (realtime, vault, cron) y la configuración del proyecto.

Guarda una copia cifrada fuera de este equipo. Contiene datos personales y hashes de contraseñas.
"@ | Out-File (Join-Path $carpeta 'LEEME.txt') -Encoding utf8

$pgpass = Join-Path $env:APPDATA 'postgresql\pgpass.conf'
$guardada = (Test-Path $pgpass) -and (Select-String -Path $pgpass -SimpleMatch "${Servidor}:" -Quiet)
if (-not $env:PGPASSWORD -and -not $guardada) {
  $seg = Read-Host 'Contraseña de la base de producción' -AsSecureString
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($seg))
}
$env:PGSSLMODE = 'require'
$env:PGTZ = 'UTC'
$c = @('-h', $Servidor, '-p', "$Puerto", '-U', $Usuario, '-d', 'postgres')
try {
  Write-Host 'Exportando estructura y datos de public, auth y storage...'
  & pg_dump @c --schema=public --schema=auth --schema=storage --format=custom --file="$dump"
  if ($LASTEXITCODE) { throw 'pg_dump falló: revisa el servidor y la contraseña.' }
  & pg_dump @c --schema=public --schema=auth --schema=storage --schema-only --file="$(Join-Path $carpeta "amura-esquema-$f.sql")"
  if ($LASTEXITCODE) { throw 'pg_dump del esquema falló' }
  & psql @c -v ON_ERROR_STOP=1 -At -F '|' -f $sqlFilas -o (Join-Path $carpeta 'filas-produccion.txt')
  if ($LASTEXITCODE) { throw 'No se pudieron contar las filas de producción' }
  & psql @c -v ON_ERROR_STOP=1 -At -F '|' -f $sqlObjetos -o (Join-Path $carpeta 'objetos-produccion.txt')
  if ($LASTEXITCODE) { throw 'No se pudieron contar los objetos de producción' }
  & psql @c -v ON_ERROR_STOP=1 -At -f $sqlExtensiones -o (Join-Path $carpeta 'extensiones-produccion.txt')
  if ($LASTEXITCODE) { throw 'No se pudieron listar las extensiones' }
} finally {
  Remove-Item Env:PGPASSWORD, Env:PGSSLMODE -ErrorAction SilentlyContinue
}

if ((Get-Item $dump).Length -eq 0) { throw 'El respaldo está vacío' }
$lista = & pg_restore --list "$dump"
if ($LASTEXITCODE -or -not $lista) { throw 'El respaldo no se puede leer' }
$lista | Out-File (Join-Path $carpeta 'contenido-respaldo.txt') -Encoding utf8
Get-FileHash (Join-Path $carpeta 'amura-*') -Algorithm SHA256 | Select-Object @{ n = 'Archivo'; e = { Split-Path $_.Path -Leaf } }, Hash | Format-Table -AutoSize | Out-File (Join-Path $carpeta 'sha256.txt') -Encoding utf8

# Restauración real en un PostgreSQL temporal: no toca Supabase ni las bases locales, y se borra al terminar.
Write-Host 'Restaurando en un PostgreSQL temporal para comprobarlo...'
$tmp = Join-Path $env:TEMP "amura-verificacion-$f"
$pv = 55433
$l = @('-h', '127.0.0.1', '-p', "$pv", '-U', 'postgres')
$base = 'amura_verificacion'
$iniciado = $false
$verificado = $false
try {
  & initdb -D $tmp -U postgres -A trust -E UTF8 --locale=C *> (Join-Path $carpeta 'initdb.txt')
  if ($LASTEXITCODE) { throw 'No se pudo preparar el PostgreSQL temporal' }
  # Sin tubería ni -Wait: el servidor hereda las salidas de pg_ctl y PowerShell se quedaría esperándolo.
  Start-Process -FilePath (Get-Command pg_ctl).Source -WindowStyle Hidden -ArgumentList @('-D', "`"$tmp`"", '-l', "`"$(Join-Path $tmp 'servidor.log')`"", '-o', "`"-p $pv -c listen_addresses=127.0.0.1`"", 'start')
  $iniciado = $true
  for ($i = 0; $i -lt 60; $i++) { & pg_isready -q -h 127.0.0.1 -p $pv; if (-not $LASTEXITCODE) { break }; Start-Sleep -Seconds 1 }
  if ($LASTEXITCODE) { throw 'No se pudo iniciar el PostgreSQL temporal' }
  & psql @l -d postgres -q -v ON_ERROR_STOP=1 -c "create database $base"
  if ($LASTEXITCODE) { throw 'No se pudo crear la base temporal' }
  $roles = 'anon', 'authenticated', 'service_role', 'authenticator', 'supabase_auth_admin', 'supabase_storage_admin', 'supabase_admin', 'dashboard_user'
  foreach ($r in $roles) { & psql @l -d $base -q -c "create role $r nologin" | Out-Null }
  & psql @l -d $base -q -c 'drop schema public cascade' | Out-Null
  $noInstaladas = @()
  foreach ($x in Get-Content (Join-Path $carpeta 'extensiones-produccion.txt')) {
    $ext, $esq = $x -split '\|'
    & psql @l -d $base -q -c "create schema if not exists `"$esq`"" 2>$null | Out-Null
    & psql @l -d $base -q -v ON_ERROR_STOP=1 -c "create extension if not exists `"$ext`" schema `"$esq`"" 2>$null | Out-Null
    if ($LASTEXITCODE) { $noInstaladas += $ext }
  }
  $avisos = Join-Path $carpeta 'restauracion-avisos.txt'
  & pg_restore @l -d $base --no-owner --no-privileges "$dump" 2> $avisos
  $errores = @(Select-String -Path $avisos -Pattern 'pg_restore: error:').Count

  $env:PGTZ = 'UTC'
  & psql @l -d $base -v ON_ERROR_STOP=1 -At -F '|' -f $sqlFilas -o (Join-Path $carpeta 'filas-restauradas.txt')
  if ($LASTEXITCODE) { throw 'No se pudieron contar las filas restauradas' }
  & psql @l -d $base -v ON_ERROR_STOP=1 -At -F '|' -f $sqlObjetos -o (Join-Path $carpeta 'objetos-restaurados.txt')
  if ($LASTEXITCODE) { throw 'No se pudieron contar los objetos restaurados' }

  $difFilas = Compare-Object (Get-Content (Join-Path $carpeta 'filas-produccion.txt')) (Get-Content (Join-Path $carpeta 'filas-restauradas.txt'))
  $difObjetos = Compare-Object (Get-Content (Join-Path $carpeta 'objetos-produccion.txt')) (Get-Content (Join-Path $carpeta 'objetos-restaurados.txt'))
  $filas = @{}
  foreach ($x in Get-Content (Join-Path $carpeta 'filas-produccion.txt')) { $p = $x -split '\|'; $filas[$p[0]] = [int64]$p[1] }
  $claves = 'auth.users', 'public.profiles', 'public.clients', 'public.reservations', 'public.contracts', 'public.payments', 'public.cobranza_gestiones', 'storage.buckets', 'storage.objects'
  $faltan = @($claves | Where-Object { -not $filas.ContainsKey($_) })
  $vacias = @('auth.users', 'public.profiles' | Where-Object { -not $filas[$_] })
  $acl = @($lista | Where-Object { $_ -match ' ACL ' }).Count

  $r = @("Respaldo: $dump", "Tamaño: $([math]::Round((Get-Item $dump).Length / 1MB, 2)) MB", '', 'Filas de tablas clave:')
  $r += $claves | ForEach-Object { "  $_ = $(if ($filas.ContainsKey($_)) { $filas[$_] } else { 'NO EXISTE' })" }
  $r += @('', 'Objetos (producción = restaurado salvo que se indique):')
  $r += Get-Content (Join-Path $carpeta 'objetos-produccion.txt') | ForEach-Object { "  $($_ -replace '\|', ' = ')" }
  $r += @('', "Permisos (ACL) guardados en el respaldo: $acl", "Tablas comparadas por filas y huella: $($filas.Count)", "Tablas distintas: $(@($difFilas).Count)", "Objetos distintos: $(@($difObjetos).Count)", "Errores de restauración: $errores", "Extensiones no instaladas en la prueba: $(if ($noInstaladas) { $noInstaladas -join ', ' } else { 'ninguna' })")
  if ($difFilas) { $r += @('', 'Diferencias de tablas (solo nombre y filas):'); $r += $difFilas | ForEach-Object { "  $($_.SideIndicator) $(($_.InputObject -split '\|')[0..1] -join ' = ')" } }
  if ($difObjetos) { $r += @('', 'Diferencias de objetos:'); $r += $difObjetos | ForEach-Object { "  $($_.SideIndicator) $($_.InputObject)" } }

  $verificado = -not $difFilas -and -not $difObjetos -and -not $faltan.Count -and -not $vacias.Count -and $acl -gt 0
  $r += @('', $(if ($verificado) { 'RESPALDO VERIFICADO' } else { 'RESPALDO NO VERIFICADO' }))
  $r | Out-File (Join-Path $carpeta 'resumen.txt') -Encoding utf8
  $r | ForEach-Object { Write-Host $_ }
  Remove-Item $sqlFilas, $sqlObjetos, $sqlExtensiones, (Join-Path $carpeta 'initdb.txt') -ErrorAction SilentlyContinue
} finally {
  if ($iniciado) { & pg_ctl -D $tmp -m fast -w stop | Out-Null }
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item Env:PGTZ -ErrorAction SilentlyContinue
}
Write-Host ''
Write-Host "Carpeta del respaldo: $carpeta"
if (-not $verificado) { Write-Host 'Si alguien usaba el sistema durante el respaldo, repítelo: una sesión nueva cambia las tablas de auth.' ; exit 1 }
