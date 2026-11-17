# AMURA · Cumplimiento antes del pago de la reserva

**Estado:** en producción. Migración `supabase/migrations/20261202000000_reserva_cumplimiento.sql` (SQL 0023), ejecutada por el administrador y verificada el 2026-11-17. Interfaz: bandeja de Cumplimiento (sección «Solicitudes de reserva»), pagador en el registro del comprobante y bloqueo visible en Pagos por verificar.

**Para:** equipo de desarrollo, Cumplimiento, Finanzas y Legal.

## 1. Regla de negocio

- Registrar un comprobante de reserva **no exige contrato ni promesa**.
- Finanzas **solo verifica** el pago de una reserva si el Oficial de Cumplimiento **aprobó esa operación**.
- Ningún perfil puede omitirlo, ni el administrador.
- La revisión legal del contrato sigue siendo un control aparte y posterior (ya existe: trigger `contratos_cumplimiento`).

## 2. Flujo

| # | Paso | Quién | Estado de la reserva | Estado de Cumplimiento | Departamento |
|---|---|---|---|---|---|
| 1 | Cotización aprobada → Orden de contrato | Vendedor | — | — | Disponible |
| 2 | Solicita la reserva y sube documentos | Vendedor | solicitada | **pendiente** (apartado 48 h) | **Solicitud en trámite** |
| 3 | Revisa documentos por cliente y operación | Oficial de Cumplimiento | solicitada | aprobado / observado / rechazado | Apartado |
| 3a | Observado: el cliente corrige (48 h más) | Vendedor → Cumplimiento | solicitada | vuelve a pendiente | Apartado |
| 3b | Una sola prórroga para observados | Supervisor autoriza | solicitada | observado | Apartado |
| 3c | Rechazado | Cumplimiento | **anulada** con motivo | rechazado | Libre |
| 3d | Apartado vencido sin decisión | Vendedor o Cumplimiento | **anulada** con motivo | pendiente / observado | Libre |
| 4 | Verifica el ingreso bancario | Finanzas | pago_verificado / **confirmada** | aprobado | Reservado |
| 5 | Promesa de compraventa y cronograma | Legal | — | — | — |
| 6 | Firma del contrato | Legal (con Cumplimiento aprobado) | — | — | Vendido |
| 7 | Cobranza de cuotas | Finanzas | — | — | — |

La promesa y el cronograma (pasos 5 y 7) son **segunda fase**: empiezan cuando exista una plantilla aprobada por Legal.

## 3. Lo que ya existe y se reutiliza

- Bandeja del Oficial de Cumplimiento (`BandejaCumplimientoPage`) y el expediente del cliente (`expediente_documentos`).
- Pantalla de Finanzas «Pagos por verificar» (`porVerificar`), que muestra solo reservas en estado «solicitada».
- `reservas_verificar_pago`: ya separa funciones (quien solicita no verifica) y ya bloquea si falta el receptor de cobros.
- Índice único: una sola reserva activa por unidad. Es el apartado real del departamento.
- `reservas_reportar_pago`: el comprobante se registra antes de la aprobación, sin cambios.

**No se crean pantallas nuevas.** Cumplimiento agrega la solicitud de reserva a su bandeja existente.

## 4. Cambios técnicos (migración propuesta)

1. **Columnas en `reservations`:** `cumplimiento_estado`, `apartado_hasta`, `prorrogas`, `cumplimiento_decidido_por` y `cumplimiento_decidido_en`. Son nuevas; no modifican filas existentes.
2. **Tabla `reservas_cumplimiento_historial`:** registra cada decisión con usuario, fecha y motivo. Solo se agrega; nadie la edita.
3. **Permiso `reservas.prorrogar`** para el supervisor.
4. **Disparadores:**
   - Al crear una solicitud: estado pendiente y 48 h de apartado.
   - Guardia: el estado de Cumplimiento solo cambia desde sus funciones, y una operación aprobada no cambia de departamento, precio, monto ni cliente.
5. **Funciones:** `reservas_cumplimiento_resolver`, `reservas_cumplimiento_reenviar`, `reservas_cumplimiento_prorrogar` y `reservas_vencer_apartado`.
6. **`reservas_verificar_pago`** (reemplazada): exige `cumplimiento_estado = 'aprobado'` y que quien verifica no sea quien decidió Cumplimiento. Como `reservas_confirmar_pago` la llama, también queda cubierta la pantalla actual de revisión de pagos.

Es el único punto de control del pago, y vive en la base de datos, no en los botones.

## 5. Permisos y separación de funciones

| Perfil | Puede | No puede |
|---|---|---|
| Vendedor (asesor) | Solicitar reserva, subir documentos, reenviar tras observación, pedir vencimiento de su apartado | Revisar Cumplimiento, verificar pagos, prorrogar |
| Supervisor | Autorizar **una** prórroga (`reservas.prorrogar`) | Aprobar o verificar |
| Oficial de Cumplimiento | Revisar, aprobar, observar o rechazar la documentación (`cumplimiento.revisar`), desde la bandeja de Cumplimiento | Verificar pagos; aprobar lo que solicitó |
| Administrador | Lo mismo que el Oficial (ya tiene `cumplimiento.revisar`) | Aprobar lo que solicitó; verificar el pago sin aprobación previa |
| Finanzas | Ver comprobantes; verificar el pago de una operación **aprobada** | Verificar si no hay aprobación; verificar lo que aprobó |

Regla clave: la base revisa **quién** pidió, **quién** decidió y **si** hubo aprobación. El administrador no es un atajo: sin aprobación previa, el pago no se verifica, con independencia de su rol.

Los permisos ya existen en la semilla (`supabase/seed_roles.sql`: `cumplimiento.revisar` para administrador y oficial_cumplimiento). Vendedor y supervisor no lo tienen, así que no pueden aprobar documentos. La migración no cambia permisos de revisión.

**Alcance simplificado:** no se crean designaciones de suplentes, habilitaciones extraordinarias ni autorizaciones cruzadas entre administrador y Oficial. Ambos revisan desde la misma bandeja.

**Lo que no cambia:** la prórroga la autoriza el supervisor (`reservas.prorrogar`). La separación entre quien solicita, quien decide y quien verifica se mantiene. El control legal del contrato sigue siendo un paso aparte y posterior.

## 6. Pagos ya recibidos y rechazos

- Un comprobante **no se borra ni se anula automáticamente**.
- Si hay rechazo, el pago queda como registrado y se conserva la evidencia.
- Cualquier devolución exige resolución documentada de Cumplimiento y el procedimiento de Finanzas. El sistema no la genera.

## 7. Decisiones pendientes (antes de aplicar)

1. **Reservas anteriores a la regla.** Las que están en «solicitada» quedan sin revisión de Cumplimiento y Finanzas no podrá verificarlas. ¿Se revisan una por una, se reenvían o se anulan con motivo?
2. **Plazo.** Propuesta: 48 h de apartado, 48 h tras observación y una prórroga. ¿Son esos valores?
3. **Vencimiento automático.** La propuesta libera el departamento cuando alguien pide vencer el apartado. ¿Se quiere un proceso automático que lo haga al cumplirse el plazo?
4. **Pagador.** El sistema no guarda quién pagó (titular o tercero). El cambio de pagador exige nueva revisión, pero hoy no hay dato que lo compare. Hace falta definir el campo.
5. **Estado `pago_verificado`.** El código lo usa, pero no pude confirmarlo en las migraciones del enum `estado_reserva`. Hay que verificarlo en la base antes de aplicar.
6. **Orden de contrato.** Se propone generarla antes de la solicitud de reserva. Hay que confirmar si Legal la necesita para la revisión de Cumplimiento.

## 8. Impacto en pruebas

Las pruebas actuales verifican pagos de reserva sin aprobación previa, así que **33 archivos (136 pruebas) fallan** si la propuesta se aplica tal cual. Ejemplos: `cobranza`, `comisiones-app`, `integracion-completa`, `clientes-crm`, `ventas-contratos`, `pagos-anticipados`, `calendario-fijo-db` y `notificaciones`.

Por eso la propuesta no está en `migrations/`. Al aprobarla:
- hay que agregar a esas pruebas el paso de aprobación de Cumplimiento antes de verificar el pago;
- y agregar las pruebas nuevas de la sección 9.

Eso es parte de la implementación, no de esta propuesta.

## 9. Plan de pruebas

Casos pedidos, con su resultado esperado:

| # | Caso | Resultado esperado |
|---|---|---|
| 1 | Reserva recién solicitada | Estado pendiente, apartado de 48 h, departamento en trámite |
| 2 | Documentación observada | Estado observado, apartado extendido 48 h; el vendedor reenvía y vuelve a pendiente |
| 3 | Cumplimiento aprueba y luego Finanzas verifica | Reserva confirmada, departamento reservado |
| 4 | Cumplimiento rechaza | Reserva anulada con motivo; comprobantes conservados; sin devolución automática |
| 5 | Finanzas intenta verificar sin aprobación | Error: «Cumplimiento debe aprobar la operación» |
| 6 | Administrador intenta verificar sin aprobación | Mismo error; no se salta el control |
| 7 | Quien solicitó intenta aprobar (administrador u Oficial) | Error: no puede revisar su propia reserva |
| 7b | Administrador aprueba una reserva de otro usuario | Aprobada; la bandeja de Cumplimiento muestra fecha, usuario y resultado |
| 7c | Oficial aprueba una reserva de otro usuario | Aprobada con el mismo registro |
| 7d | Vendedor o supervisor intenta aprobar, observar o rechazar | Error de permiso; sin cambios |
| 8 | Quien aprobó intenta verificar el pago (administrador u Oficial) | Error: separación de funciones |
| 9 | Apartado vencido sin decisión | Solo vence con pedido de quien solicitó o de Cumplimiento; reserva anulada; departamento libre |
| 10 | Prórroga | Solo una; solo con observados; solo supervisor |
| 11 | Cambio de departamento, precio, monto o cliente tras aprobación | Error: requiere nueva revisión |
| 12 | Comprobante antes de aprobar | Se registra y queda visible; no cuenta como reserva confirmada |

Estado actual: solo está probada la migración (4 pruebas: columnas, historial y permiso, funciones, y que la verificación exige aprobación). Los casos 1–12 quedan pendientes hasta aprobar la propuesta.

Para A103 se usarán datos de prueba identificables (prefijo `PRUEBA-`), creados en Supabase real con autorización expresa, y limpiados al final con procedimiento documentado. La prueba no altera pagos ni aprobaciones reales.

## 10. Segunda fase: promesa de compraventa

- **No existe** un módulo ni una plantilla de promesa de compraventa aprobada por Legal.
- No se usará la Orden de Contrato como sustituto.
- Empieza cuando Legal entregue la plantilla y las cláusulas aprobadas.
- Incluye el cronograma contractual.

## 11. Próximos pasos

1. Responder las decisiones de la sección 7.
2. Aprobar la propuesta.
3. Implementar: ajustar las pruebas existentes, agregar los casos de la sección 9, y mover la migración a `migrations/` con su copia en `sql_produccion/` como PENDIENTE.
4. Autorizar la ejecución en producción por separado, con respaldo y revisión previa.
