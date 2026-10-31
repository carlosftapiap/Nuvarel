# AMURA · Respaldo externo de producción y comprobación de que se puede restaurar. Solo lee producción.
# Uso, desde una carpeta FUERA del repositorio:
#   powershell -ExecutionPolicy Bypass -File "<repo>\scripts\respaldo-produccion.ps1" -Servidor <host del Session pooler>
# Necesita PostgreSQL instalado (misma versión mayor o superior a la de Supabase).
# Los archivos contienen datos de clientes y hashes de contraseñas: guárdalos cifrados y nunca en Git.
param(
  [Parameter(Mandatory = $true)][string]$Servidor,
  [string]$Proyecto = 'sjjjlnqgcaqtkmzdcmog',
  [string]$BinPostgres = ''
)
$ErrorActionPreference = 'Stop'
if ($BinPostgres) { $env:Path = "$BinPostgres;$env:Path" }
foreach ($h in 'pg_dump', 'pg_restore', 'psql') { if (-not (Get-Command $h -ErrorAction SilentlyContinue)) { throw "No encuentro $h. Instala PostgreSQL o indica -BinPostgres." } }

$seg = Read-Host 'Contraseña de la base de producción' -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($seg))
$env:PGSSLMODE = 'require'
$c = @('-h', $Servidor, '-p', '5432', '-U', "postgres.$Proyecto", '-d', 'postgres')
$f = Get-Date -Format 'yyyyMMdd-HHmm'
$carpeta = "amura-respaldo-$f"
New-Item -ItemType Directory -Path $carpeta | Out-Null

# Filas por tabla, para comparar después de restaurar.
$conteo = "select schemaname || '.' || relname as tabla, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', schemaname, relname), false, true, '')))[1]::text::bigint as filas from pg_stat_user_tables where schemaname in ('public', 'auth') order by 1"

try {
  Write-Host 'Exportando esquema y datos de public y auth...'
  & pg_dump @c --schema=public --schema=auth --no-owner --no-privileges --format=custom --file="$carpeta\amura-$f.dump"
  if ($LASTEXITCODE) { throw 'pg_dump falló' }
  & pg_dump @c --schema=public --schema-only --file="$carpeta\amura-esquema-$f.sql"
  if ($LASTEXITCODE) { throw 'pg_dump del esquema falló' }
  & psql @c -At -F '|' -c $conteo -o "$carpeta\filas-produccion.txt"
  if ($LASTEXITCODE) { throw 'No se pudieron contar las filas de producción' }
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue
}

$lista = & pg_restore --list "$carpeta\amura-$f.dump"
if ($LASTEXITCODE -or -not $lista) { throw 'El respaldo no se puede leer' }
Write-Host "Respaldo legible: $($lista.Count) objetos."
Get-FileHash "$carpeta\*" -Algorithm SHA256 | Select-Object @{ n = 'Archivo'; e = { Split-Path $_.Path -Leaf } }, Hash | Format-Table -AutoSize | Out-File "$carpeta\sha256.txt"

# Restauración de prueba en PostgreSQL local (no toca Supabase ni crea proyectos).
Write-Host ''
$local = Read-Host 'Contraseña del usuario postgres LOCAL para comprobar la restauración (Enter para omitir)' -AsSecureString
$plano = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($local))
if (-not $plano) {
  Write-Warning 'Restauración NO comprobada: este respaldo todavía no cuenta como verificado.'
  exit 0
}
$env:PGPASSWORD = $plano
$l = @('-h', 'localhost', '-U', 'postgres')
$base = 'amura_verificacion'
try {
  & psql @l -d postgres -v ON_ERROR_STOP=1 -c "drop database if exists $base" -c "create database $base"
  if ($LASTEXITCODE) { throw 'No se pudo crear la base local' }
  & psql @l -d $base -c "do `$`$ begin create role anon nologin; exception when duplicate_object then null; end `$`$; do `$`$ begin create role authenticated nologin; exception when duplicate_object then null; end `$`$; do `$`$ begin create role service_role nologin; exception when duplicate_object then null; end `$`$; create schema if not exists extensions;" | Out-Null
  & pg_restore @l -d $base --no-owner --no-privileges "$carpeta\amura-$f.dump" 2> "$carpeta\restauracion-avisos.txt"
  & psql @l -d $base -At -F '|' -c $conteo -o "$carpeta\filas-restauradas.txt"
  if ($LASTEXITCODE) { throw 'No se pudieron contar las filas restauradas' }
  $dif = Compare-Object (Get-Content "$carpeta\filas-produccion.txt") (Get-Content "$carpeta\filas-restauradas.txt")
  if ($dif) {
    $dif | Format-Table -AutoSize
    throw "La restauración no coincide con producción. Revisa $carpeta\restauracion-avisos.txt"
  }
  Write-Host "RESPALDO VERIFICADO: las filas de todas las tablas coinciden. Carpeta: $carpeta" -ForegroundColor Green
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
