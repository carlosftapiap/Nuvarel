# Cobranza del 20% · instalación y despliegue

Estado: **probado en la base local** (migraciones reales + pruebas). **No aplicado en producción.** Requiere tu confirmación final antes de cada paso marcado con ⚠️.

## Qué incluye cada archivo

| Archivo | Qué hace | Estado |
|---|---|---|
| `migrations/20261029050000_cobranza_cronograma.sql` | Reserva configurable, cronograma exigible solo al firmar, pagos anulables, sin referencias duplicadas, estados por cuota, reprogramación con historial, gestiones, compromisos y cola de alertas | Probado local (14 pruebas) |
| `functions/_shared/cobranza.ts` | Estados de cuota, reparto de pagos, reglas de alerta, envío con reintentos | Probado local (18 pruebas) |
| `functions/cobranza-diaria/index.ts` | Función programada: lee la base, guarda alertas y envía las pendientes | ⚠️ No probada en Deno: revisar al desplegar |
| `src/features/cobranza/entrada.ts` | Cálculo del 20%: reserva, pago a la firma, cuotas y saldo contra entrega | Probado local (5 pruebas) |

## 1. Comprobar el receptor de pagos (solo lectura)

Ejecuta en el SQL Editor. Debe devolver `NUVAREL`:

```sql
select receptor, definido_en from public.payment_settings where id = 1;
```

- Si devuelve `NUVAREL`: correcto.
- Si devuelve `null` o cualquier otro valor: **no cambies nada**. Avísame para aclarar la diferencia primero.

## 2. Migración de base de datos ⚠️

Orden: `20261029040000_administrador_inicial.sql` ya aplicado → `20261029050000_cobranza_cronograma.sql` → `20261029060000_financiamiento_catalogo.sql` → volver a ejecutar `supabase/seed_roles.sql` (agrega el permiso `financiamiento.catalogo`).

Antes de ejecutarla, revisa que no existan referencias de pago duplicadas (si hay, la creación del índice fallará y hay que corregirlas primero):

```sql
select contract_id, upper(referencia), count(*)
from public.payments where estado in ('registrado', 'verificado')
group by 1, 2 having count(*) > 1;
```

Debe devolver cero filas.

## 3. Función programada ⚠️

1. Genera un secreto largo para `CRON_SECRET` (en tu computadora, no en el chat). Guárdalo como secreto del proyecto:
   ```
   supabase secrets set CRON_SECRET=<valor-generado>
   supabase secrets set APP_ORIGIN=<dirección-de-la-app>
   ```
2. Despliega la función:
   ```
   supabase functions deploy cobranza-diaria --no-verify-jwt
   ```
3. Programa la ejecución diaria a las 08:00 de Ecuador (13:00 UTC, sin horario de verano). Requiere las extensiones `pg_cron` y `pg_net` activadas en **Database → Extensions**. Reemplaza `<proyecto>` y `<CRON_SECRET>` (guárdalo en Vault, no en el texto del comando):
   ```sql
   select cron.schedule('cobranza-diaria', '0 13 * * *', $$
     select net.http_post(
       url := 'https://<proyecto>.supabase.co/functions/v1/cobranza-diaria',
       headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>', 'Content-Type', 'application/json'),
       body := '{}'::jsonb
     );
   $$);
   ```

## 4. Correo: estado actual

- **Envío real: desactivado.** Mientras `COBRANZA_ENVIO_REAL` no sea `true`, las alertas se guardan como *pendientes* con el mensaje **"Correo pendiente de configuración"**.
- **Falta definir:** el dominio remitente (por ejemplo `cobranza@tudominio.com`). Lo elige el usuario, no se inventa.
- **Cuando lo tengas:** registra el dominio en Resend, y te daré las instrucciones exactas de los registros DNS que indique Resend (no se inventan aquí).
- **Cuenta de prueba de Resend:** solo entrega a tu propio correo. Sirve para ensayar, no para producción.
- Después, activa el envío con `supabase secrets set COBRANZA_ENVIO_REAL=true COBRANZA_REMITENTE=<remitente> RESEND_API_KEY=<clave-nueva>`. **Revoca la clave que pegaste en el chat y crea una nueva.**

## 5. Pruebas locales

```
npx vitest run supabase/tests/cobranza.test.ts supabase/tests/cobranza-logica.test.ts src/features/cobranza
```

Cubre: reserva configurable, cronograma exigible solo al firmar, pagos parciales, excedentes como saldo a favor, duplicados, anulaciones con auditoría, reprogramación conservando la fecha original, permisos, cuotas pagadas que cancelan alertas, escalamientos sin repetición, compromisos incumplidos, comprobantes de más de 24 horas y fallos del proveedor de correo.

## Pantallas (probadas localmente)

- **Cobranzas** (`/cobranzas`): tablero del 20%, antigüedad de mora, cartera por cliente, unidad, edificio y responsable, registro y verificación de pagos, anulaciones, gestiones, compromisos, reprogramación y alertas. Requiere Supabase.
- **Financiamiento** (`/financiamiento`): entrada del 20%, simulador hipotecario del 80% (catálogo versionado o escenario manual, francés o alemán, comparador de 3 escenarios) y cotización integral en PDF guardada con la versión de las condiciones.
- **Catálogo bancario:** empieza vacío. Las tasas se cargan desde Financiamiento → Crédito hipotecario → *Catálogo bancario*, con fuente y fecha obligatorias. No se incluyen tasas inventadas.

## Pendiente (no incluido en esta entrega)

- Prueba de la función programada en un entorno real de Supabase.
- Envío real de correos (espera dominio y registros DNS).
