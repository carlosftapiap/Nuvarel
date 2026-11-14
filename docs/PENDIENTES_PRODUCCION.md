# Pendientes en producción

Lista única de lo que está en el repositorio y todavía no está en producción. Ningún punto se marca como hecho sin evidencia comprobada en producción. No se avanza a una fase nueva con pendientes abiertos.

Última revisión: 2026-11-11

## Estado con evidencia

| # | Pendiente | Evidencia (2026-11-11) | Estado | Quién |
|---|---|---|---|---|
| 1a | Migración `20261112000000_constancia_provisional.sql` | `verificar_despliegue.sql` vía CLI: columnas, disparador y funciones de 7 argumentos presentes e iguales al repositorio; 0 constancias | **Aplicada** | — |
| 1b | Migración `20261112010000_correo_destinatario_efectivo.sql` | `verificar_despliegue.sql`: única diferencia, `cobranza_alertas.destinatario_efectivo` FALTA | Pendiente (respaldo + autorización) | Claude vía CLI |
| 1d | Migración `20261113000000_pagos_anticipados.sql` (fase 2) | Probada en PGlite (pruebas de base, de la app y de despliegue). Diagnóstico de solo lectura en producción: 0 contratos con pagos sobre la entrada | Pendiente (respaldo + autorización) | Claude vía CLI |
| 1e | Migración `20261114000000_cumplimiento.sql` (fase 3) | Probada en PGlite (base, app y despliegue). Producción: 0 contratos, ninguno en borrador quedaría bloqueado | Pendiente (respaldo + autorización) | Claude vía CLI |
| 1f | Migración `20261116000000_notificaciones.sql` (fase 5) | Probada en PGlite (base, app y despliegue). Producción: cola de avisos vacía | Pendiente (respaldo + autorización) | Claude vía CLI |
| 1g | Función `cobranza-diaria` con avisos por evento y recordatorios | Código listo; no desplegada (punto 3) | Pendiente | Claude vía CLI |
| 1c | Resto de migraciones del repositorio | `verificar_despliegue.sql`: sin otras diferencias | **Aplicadas** | — |
| 2 | Publicar la app | En pausa por decisión del usuario (2026-11-11): primero se termina la aplicación | En pausa | Usuario |
| 3 | Función `cobranza-diaria` desplegada | `functions list`: solo existe `crear-usuario` | **No desplegada** | Claude vía CLI |
| 3b | Función `crear-usuario` desplegada | `functions list`: versión 4 activa; el código descargado es idéntico al del repositorio | **Desplegada y sincronizada** | — |
| 4 | Dominio remitente en Resend | `GET /domains` con la clave local: lista vacía. Solo sirve el remitente de pruebas `onboarding@resend.dev` | **Sin dominio** | Usuario |
| 5 | Secretos de la función | `secrets list`: solo `APP_ORIGIN` (más los de Supabase). Faltan `CRON_SECRET`, `RESEND_API_KEY`, `CORREO_PRUEBA_DESTINO` | **Faltan** | Claude vía CLI |
| 5b | Respaldo de producción | `backups list`: ninguno (sin PITR). El respaldo con `pg_dump` necesita la contraseña de la base | **Sin respaldo** | Usuario escribe la contraseña |
| 5c | Historial de migraciones de la CLI | No existe `supabase_migrations.schema_migrations`: las migraciones se aplicaron desde el editor SQL | Sin historial | Claude (con autorización) |
| 6 | Programador diario (`pg_cron` + `pg_net`) | `verificar_correo.sql` (2026-11-11): `pg_cron` y `pg_net` **no instaladas**; cola sin alertas pendientes | **No instalado** | Usuario (Database → Extensions) |
| 7 | Registro público desactivado | `GET /auth/v1/settings` devuelve **`"disable_signup": false`** | **Activado: hay que desactivarlo** | Usuario (panel) |

## Qué puedo hacer yo y qué requiere tu intervención

| Paso | Claude | Usuario |
|---|---|---|
| Respaldo (`scripts/respaldo-produccion.ps1`) | — | Lo ejecuta (pide la contraseña de la base) |
| Aplicar migraciones | Prepara y prueba el SQL y la recuperación | Lo pega completo en el editor SQL |
| `verificar_despliegue.sql` y `verificar_correo.sql` | Interpreta el resultado | Lo ejecuta y comparte el resultado |
| Desplegar `cobranza-diaria` y definir secretos | Lo ejecuta si inicias `npx supabase login` en esta terminal | O lo ejecuta con los comandos indicados |
| Compilar la app (`dist`) | Sí | — |
| Publicar en A2Hosting | — | Sube el paquete |
| Desactivar el registro público | — | Authentication → Sign In / Providers → desactivar "Allow new users to sign up" |
| Dominio en Resend | Indica los registros DNS que muestre Resend | Registra el dominio y los DNS |
| Prueba de conexión de correo | La ejecuta (llamada a la función) y revisa el historial | Confirma que llegó el correo |

## Modo prueba de correo (activo hasta nuevo aviso)

- Secreto `CORREO_PRUEBA_DESTINO=carlosftapiap@gmail.com`: todo correo se entrega solo a ese buzón, aunque `COBRANZA_ENVIO_REAL` sea `true`.
- El destinatario original se conserva en `cobranza_alertas.destinatario`; el que lo recibió, en `destinatario_efectivo`. El asunto lleva `[PRUEBA para <original>]`.
- Remitente: `onboarding@resend.dev` (de pruebas). Resend solo entrega desde ese remitente al correo dueño de la cuenta.
- Máximo de 10 correos por ejecución (`CORREO_PRUEBA_MAXIMO`). Si el destino está mal escrito, no se envía nada.
- Prueba controlada: `POST` a la función con `{"prueba":"conexion"}` envía un solo correo y no toca la cola de cobranza.
- **Para pasar a real:** dominio verificado, `COBRANZA_REMITENTE` corporativo, cancelar en la cola los avisos de prueba que sigan pendientes, borrar `CORREO_PRUEBA_DESTINO` y poner `COBRANZA_ENVIO_REAL=true`.

## Recuperación de la fase 1

- `supabase/instalacion/revertir_fase1_constancia_correo.sql`. Probado: en una base sin uso deja todo como antes. Si ya hay constancias, medios de pago o envíos registrados, se detiene sin cambiar nada, para no perder trazabilidad.
- Las migraciones solo agregan columnas, un disparador y dos funciones nuevas. No modifican ni borran pagos, recibos, reservas ni la cola existente. Las funciones de registro anteriores siguen funcionando igual.
- Si la app nueva fallara, se vuelve a publicar el `dist` anterior. Con las migraciones aplicadas, la app anterior sigue funcionando.

## Orden obligatorio

1. Respaldo verificado.
2. Migraciones (punto 1) y `verificar_despliegue.sql` sin diferencias.
3. Publicar la app (punto 2).
4. Prueba con datos marcados PRUEBA, registro de lo creado y limpieza.

Si la app se publica antes que la migración, **registrar pagos deja de funcionar**: la app envía el medio de pago y la base todavía no lo acepta.
