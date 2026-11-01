# Despliegue final de AMURA en producción

Proyecto: `sjjjlnqgcaqtkmzdcmog`. Nada de esto se ejecuta sin autorización. Si un paso falla, se detiene y no se sigue al siguiente.

## 1. Verificar el estado actual (solo lectura)

En **SQL Editor**, ejecuta `instalacion/verificar_despliegue.sql` y guarda el resultado. No modifica nada ni muestra datos de personas.

Resultado esperado: solo `FALTA` de los objetos de las migraciones pendientes (responsables externos del Plan y Avance de obra), **ningún `DISTINTO`**. Si aparece otra diferencia, detente y compártela.

## 2. Respaldo externo

Instala PostgreSQL en el equipo. En una carpeta fuera del repositorio:

```powershell
powershell -ExecutionPolicy Bypass -File "D:\Empresas\NUVAREL\App NUVAREL\scripts\respaldo-produccion.ps1" -Servidor <host del Session pooler>
```

El host está en Supabase → **Connect** → **Session pooler**. El script pide la contraseña sin mostrarla, exporta `public` y `auth`, restaura en PostgreSQL local y compara las filas de cada tabla. El respaldo solo cuenta si termina con **RESPALDO VERIFICADO**.

No incluye archivos de Storage, Funciones Edge ni sus secretos. El código de las funciones está en `supabase/functions`. Guarda la carpeta cifrada.

## 3. Migración

Ejecuta el archivo completo en **SQL Editor**:

- `migrations/20261030000000_plan_responsable_externo.sql`: permite responsables externos en el Plan.
- `migrations/20261031120000_avance_obra.sql`: módulo Avance de obra (cuatro frentes, etapas, avances, validación y evidencias privadas). Tablas vacías: no inventa fechas ni porcentajes.

- `migrations/20261031150000_reserva_atomica_disponibilidad.sql`: solicitud de reserva con el monto acordado en una sola operación, y unidades en proceso de reserva visibles para todos los perfiles comerciales. No modifica datos. **Debe aplicarse antes de publicar `/venta`.**
- `migrations/20261031160000_clientes_nombres.sql`: nombres y apellidos del cliente por separado. Los clientes existentes no cambian. **Debe aplicarse antes de usar el formulario nuevo de clientes.**
- `migrations/20261031170000_cuotas_extraordinarias.sql`: cuotas extraordinarias dentro del 14 %, en cotización, contrato y documentos. No modifica datos. **Debe aplicarse antes de emitir cotizaciones con cuotas extraordinarias.**
- `migrations/20261031180000_comprobantes_recibos.sql`: comprobantes en bucket privado, confirmación con verificación bancaria y recibos numerados de NUVAREL S.A.S. No modifica datos. **Debe aplicarse antes de publicar esta versión: Registrar pago y Confirmar pago la necesitan.**
- `migrations/20261031190000_cobranzas_controles.sql`: comprobante obligatorio, cierre de las funciones antiguas de confirmación, emisor del recibo, devoluciones y retenciones, y limpieza de archivos no vinculados. No modifica datos. **La app publicada debe ser esta versión: las anteriores ya no podrán registrar ni confirmar pagos.**
- `migrations/20261031200000_storage_comprobantes.sql`: subida de comprobantes por operación, vínculo seguro del PDF del recibo y limpieza auditada de archivos sin vincular. No modifica datos ni archivos.
- `migrations/20261031210000_obra_avance_directo.sql`: avance de obra sin segunda aprobación. **Cambia datos:** los avances pendientes de validar pasan a contar como avance actual, marcados como «Aprobación eliminada». La app publicada debe ser esta versión: las anteriores ya no podrán registrar avances.
- `migrations/20261031220000_multimedia_proyecto.sql`: biblioteca de fotografías y videos, con versiones, bucket privado propio `multimedia-proyecto` y permiso `config.multimedia` solo para Administrador. Registra el material actual como versión 1. No cambia datos comerciales.
- `migrations/20261101000000_accesos_internos.sql`: la configuración (emisor de recibos, receptor de pagos, roles, permisos, proyectos, equipos y porcentaje de comisión) deja de ser legible para cuentas sin perfil activo. No cambia datos.

Vuelve a ejecutar `verificar_despliegue.sql`: no debe quedar ningún `FALTA`, `DISTINTO` ni `ADICIONAL`.

No ejecutes ninguna otra migración. `20261031080000`, `20261031100000`, `20261031110000_datos_en_base.sql` y `20261031140000_reserva_predeterminada.sql` ya están en producción. No existe migración de disponibilidad: las 67 unidades por confirmar conservan su estado.

## 4. Desplegar la función de cuentas

Crear usuarios con contraseña necesita la clave de servicio, que solo puede estar en el servidor. En la raíz del repositorio:

```powershell
npx supabase login
npx supabase functions deploy crear-usuario --project-ref sjjjlnqgcaqtkmzdcmog
```

Supabase le entrega la clave a la función; no hay que copiarla en ningún lado. Sin este paso, «Crear usuario» y «Cambiar contraseña» muestran un aviso y no cambian nada.

Limita la función a la dirección publicada:

```powershell
npx supabase secrets set APP_ORIGIN=https://<dominio de AMURA> --project-ref sjjjlnqgcaqtkmzdcmog
```

En Supabase → **Edge Functions**, si aparece la función antigua `invitar-usuario`, elimínala.

## 5. Publicar la aplicación en A2 Hosting

1. Confirma que `.env.local` solo tiene `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`, nunca la clave `service_role`.
2. En la raíz del repositorio, compila y empaqueta:

   ```powershell
   npm run build
   tar -a -c -f amura-a2hosting.zip -C dist .
   ```

3. En cPanel → **Domains**, crea el dominio o subdominio con su propia carpeta raíz. Debe servirse desde la raíz (`/`), no desde una subcarpeta como `/amura`.
4. En **File Manager**, sube el zip a esa carpeta y usa **Extract**. Activa **Show Hidden Files** y comprueba que está `.htaccess`; hace que toda ruta responda con `index.html`. Borra el zip.
5. Activa el certificado SSL en cPanel → **SSL/TLS Status**.
6. En Supabase → **Authentication** → **URL Configuration**, pon la dirección publicada en **Site URL** y agrégala a **Redirect URLs**.
7. Abre la dirección, entra y recarga la página estando en `/inventario`: debe seguir en Inventario, sin error 404.

## 6. Primeras pruebas (desde la aplicación)

El receptor de pagos ya es NUVAREL: no se cambia. No se registran pagos reales ni se alteran operaciones existentes.

1. Con la cuenta Administrador, en Configuración → Usuarios, crea un Vendedor con contraseña inicial, rol y equipo.
2. Entra con esas credenciales y revisa sus módulos y permisos.
3. Usa solo las 5 unidades disponibles que no estén comprometidas.

Las 67 unidades por confirmar pueden cotizarse con la advertencia correspondiente, pero no reservarse. Administrador o Gerencia las pasan a Disponible una a una en Inventario, con motivo, a medida que se valida cada una.

## 7. Si algo sale mal

- Una migración que falla no deja cambios a medias; corrige la causa antes de repetirla.
- Si el error aparece después de aplicar: vuelve a publicar la versión anterior de la aplicación y compárteme el error. Restaurar el respaldo es el último recurso, porque perdería lo registrado después de hacerlo.
