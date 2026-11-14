# AMURA · Guarda la contraseña de la base de producción en el archivo estándar de PostgreSQL (pgpass.conf) de esta cuenta de Windows,
# para que los respaldos se hagan sin pedirla. La contraseña no se muestra ni queda en el historial.
# El archivo queda en %APPDATA%\postgresql\pgpass.conf y solo lo puede abrir tu usuario. Para quitarla: borra ese archivo.
# Uso: powershell -ExecutionPolicy Bypass -File ".\scripts\guardar-clave-respaldo.ps1"
param(
  [string]$Servidor = 'aws-0-us-east-1.pooler.supabase.com',
  [string]$Proyecto = 'sjjjlnqgcaqtkmzdcmog'
)
$carpeta = Join-Path $env:APPDATA 'postgresql'
New-Item -ItemType Directory -Path $carpeta -Force | Out-Null
$archivo = Join-Path $carpeta 'pgpass.conf'
$seg = Read-Host 'Contraseña de la base de producción' -AsSecureString
$clave = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($seg))
# En pgpass, ":" y "\" de la contraseña se escapan con "\".
$clave = $clave.Replace('\', '\\').Replace(':', '\:')
$linea = "${Servidor}:5432:postgres:postgres.${Proyecto}:$clave"
$otras = if (Test-Path $archivo) { @(Get-Content $archivo | Where-Object { $_ -notlike "${Servidor}:*" }) } else { @() }
@($otras + $linea) | Set-Content -Path $archivo -Encoding ascii
& icacls $archivo /inheritance:r /grant:r "$($env:USERNAME):F" | Out-Null
Remove-Variable clave, linea, seg
Write-Host "Contraseña guardada en $archivo (solo tu usuario puede leerlo)."
