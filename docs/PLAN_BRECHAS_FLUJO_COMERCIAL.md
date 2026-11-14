# Plan técnico: brechas del flujo comercial

Fecha: 2026-11-11 · Fases 0, 1, 2, 3 y 5 autorizadas; la 4 no. Avance:
- Fase 1: constancia aplicada en producción; falta `destinatario_efectivo`.
- Fase 2: desarrollada y probada en el repositorio; falta aplicar en producción.
- Fase 3: desarrollada y probada en el repositorio; falta aplicar en producción.
- Fase 5: avisos internos desarrollados y probados en el repositorio; falta aplicar en producción. Los avisos al comprador (recibo, constancia, estado de cuenta) quedan para después del dominio de correo, el consentimiento y el texto legal.

Alcance: completar el flujo comercial actual dentro de los módulos existentes (Clientes, Reservas, Ventas y contratos, Cobranzas, Configuración). No se crean módulos, rutas principales ni otro flujo.

## Reglas para todas las fases

- Una migración aditiva por fase, con encabezado de orden, cómo revertir y "ejecutar con respaldo verificado", como las actuales.
- Ninguna migración borra ni reescribe datos existentes. Los contratos firmados, las cuotas y los recibos emitidos no se modifican.
- Cada fase se prueba en PGlite (`supabase/tests/`) y en la app (`src/**/__tests__`) antes de pedir autorización.
- El usuario aplica en producción pegando el archivo completo en el editor SQL de Supabase. Después, Codex valida por roles en el navegador.
- Los datos de prueba en Supabase real se registran y se borran al final, con confirmación.
- Al cerrar cada fase se actualiza `docs/INVENTARIO_FUNCIONALIDADES.md`.

## Resumen de fases

| Fase | Contenido | Migración | Depende de |
|---|---|---|---|
| 0 | Verificar el envío real de correos | No | — |
| 1 | Recibo con datos de la unidad y constancia provisional | Sí (pequeña) | — |
| 2 | Pagos anticipados y estado de cuenta PDF | Sí | 1 |
| 3 | Rol Oficial de Cumplimiento, expediente y revisión antes de la firma | Sí | — (el formulario Jarval solo afecta 3.3) |
| 4 | Modificación de cuotas extraordinarias después de firmar | Sí | 2 |
| 5 | Notificaciones al comprador y a responsables internos | Sí | 0, 1, 2, 3 |

Orden recomendado: 0 y 1 a la vez; luego 2, 3, 4 y 5.

---

## Fase 0 · Verificar el envío real de correos (decisión 9)

Objetivo: confirmar que el correo funciona de verdad antes de ampliar automatizaciones.

Trabajo (solo verificación; cada paso en producción requiere tu autorización):
1. Revisar en el panel de Supabase si están desplegadas `cobranza-diaria` y `crear-usuario`. Según el último registro (2026-11-01), estaban pendientes.
2. Revisar en Resend que el dominio remitente esté verificado (SPF y DKIM).
3. Confirmar los secretos de la función: `RESEND_API_KEY`, `COBRANZA_REMITENTE`, `CRON_SECRET`, `APP_ORIGIN`, `COBRANZA_ENVIO_REAL`.
4. Confirmar que el programador (`pg_cron` + `pg_net`) llama a la función a las 08:00 de Ecuador.
5. Enviar una prueba controlada a un correo interno, nunca a clientes.

Archivos: ninguno, salvo corregir `supabase/instalacion/DESPLIEGUE_PRODUCCION.md` si algún paso no coincide.

Riesgos: activar `COBRANZA_ENVIO_REAL=true` con alertas acumuladas en la cola enviaría correos atrasados. Antes hay que revisar la cola (`cobranza_alertas` pendientes) y cancelar lo que no corresponda.

Aceptación:
- Un correo de prueba llega a la bandeja de entrada, no a spam.
- Queda en `cobranza_alertas` con estado `enviada` y `proveedor_id`.
- Una segunda ejecución el mismo día no duplica el envío.

---

## Fase 1 · Recibo con datos de la unidad y constancia provisional (decisiones 1 y 10)

### 1.1 Datos de la unidad en el recibo definitivo

El PDF del recibo se arma en el navegador (`construirReciboPdf`) y se guarda una sola vez con su hash. Al generarlo se leerán los datos de Inventario: edificio, piso, tipología, área, bodega, parqueo y patio. No hace falta migración ni copiar datos en la tabla de recibos.

- `src/features/cobranza/comprobantes.ts`: `construirReciboPdf` recibe la unidad (`Unit`) y agrega el bloque "Unidad".
- `src/pages/CobranzaPage.tsx` y `src/pages/ReservasPage.tsx`: pasan la unidad desde el store de Inventario al generar o descargar.
- Los recibos que ya tienen PDF guardado no cambian. Los que no lo tienen se generan con los datos completos.

### 1.2 Constancia provisional

Se basa en el registro existente `comprobantes_pago` (estado `reportado`), sin tabla nueva.

Migración `20261112000000_constancia_provisional.sql`:
- `comprobantes_pago.medio` (`transferencia | deposito | cheque`, por defecto `transferencia`). Para cheque: número de cheque en `referencia` y banco girador en `banco`.
- `comprobantes_pago.constancia_numero` (`CP-AAAA-0001`), asignado en la misma transacción de `reservas_reportar_pago` y `cobranzas_reportar_pago`, que se redefinen agregando solo este paso.
- Los comprobantes anteriores quedan sin número de constancia.

Aplicación:
- Nueva función `construirConstanciaPdf` en `src/features/cobranza/comprobantes.ts`. Título "CONSTANCIA PROVISIONAL DE RECEPCIÓN DE COMPROBANTE" y leyenda fija: *"Este documento no acredita dinero recibido. El pago se acredita solo con el recibo definitivo numerado, una vez verificado por Finanzas."*
- Botón "Constancia" en `src/features/reservas/components/RegistrarPagoDialog.tsx`, `src/features/cobranza/components/RegistrarPagoCuota.tsx` y en el detalle del pago mientras esté `reportado`.
- Selector de medio (transferencia, depósito o cheque) en los mismos diálogos.

Permisos: ninguno nuevo. Usa `reservas.solicitar`, `cobranzas.registrar` y la política `pago_visible` actual.

Riesgos:
- Que la constancia se confunda con un recibo. Se mitiga con otro título, otra numeración y la leyenda.
- Un comprobante rechazado conserva su constancia: el PDF debe mostrar "RECHAZADO" si se descarga después.

Aceptación:
- Registrar un pago genera la constancia `CP-…` con la leyenda.
- Confirmar ese pago emite el recibo definitivo con el número actual (`RP-…`), con edificio, piso, tipología y demás datos de la unidad.
- Un pago rechazado no tiene recibo, y su constancia indica que fue rechazado.
- Pruebas: `supabase/tests/comprobantes-recibos-app.test.tsx` (ampliar) y una nueva `constancia-provisional.test.ts` (PGlite).

---

## Fase 2 · Pagos anticipados y estado de cuenta PDF (decisiones 2 y 8)

### 2.1 Hallazgo

Hoy los pagos verificados se aplican en orden de cuota hasta la última, que es el **saldo contra entrega del 80 %**. Esto ocurre en la vista `installment_status` y en `aplicarPagos` (`supabase/functions/_shared/cobranza.ts`). Por eso un excedente sobre la entrada (20 %) reduce el 80 % sin autorización. Eso contradice la decisión 2.

### 2.2 Regla nueva de aplicación

1. Primero se cubren la reserva (con su propio pago) y las obligaciones vencidas, en orden de vencimiento. La reserva va primero porque su fecha es la de confirmación, que puede ser posterior a cuotas de un contrato con fecha anterior.
2. Después, las próximas cuotas de la entrada (reserva, pago a la firma, mensuales y extraordinarias), en orden de vencimiento.
3. Lo que exceda la entrada queda como **saldo a favor**. Solo se aplica al saldo de financiamiento (80 %) con una autorización financiera registrada.
4. Las cuotas y los contratos firmados no se modifican: cambia la aplicación de los pagos, no el cronograma.

Migración `20261113000000_pagos_anticipados.sql`:
- Nueva tabla `aplicaciones_excedente`: contrato, monto, motivo, soporte (archivo en el bucket `comprobantes-pagos`), autorizado por, fecha, y anulación con motivo. No se borran filas.
- Funciones `cobranzas_autorizar_excedente(contrato, monto, motivo, archivo)` y `cobranzas_anular_aplicacion(id, motivo)`. Validan que el monto no supere el saldo a favor disponible y dejan auditoría.
- La vista `installment_status` se redefine así:
  - Lo verificado se aplica primero a las cuotas de la entrada (todas menos el saldo contra entrega).
  - El saldo contra entrega solo recibe lo autorizado en `aplicaciones_excedente`.
- `contract_balances` agrega tres columnas: `saldo_entrada`, `aplicado_financiamiento` y `saldo_financiamiento`. Se conservan las columnas actuales.
- `aplicarPagos` en `_shared/cobranza.ts` se cambia de la misma forma, porque la usan el tablero y el correo diario.

Permiso nuevo: `cobranzas.aplicar_excedente` ("Autorizar la aplicación de excedentes al saldo de financiamiento"). Se asigna a **Finanzas**, más Administrador por regla general. Se agrega en `src/app/permissions.ts` (catálogo, plantilla de Finanzas, `ACCION_PERMISO`) y en la migración (tabla `permissions` y `role_permissions` del rol `finanzas`).

Riesgo principal: contratos en producción que ya pagaron por encima de la entrada pasarían a mostrar el excedente como saldo a favor en vez de aplicado al 80 %. Antes de aplicar la migración:
- Consulta de solo lectura para listar esos contratos.
- Si hay alguno, se decide contigo si se registra una aplicación autorizada con fecha histórica.

### 2.3 Estado de cuenta PDF

Se genera con los datos existentes, sin guardar copias:
- Fuentes: `contracts`, `installments`, `payments` verificados, `installment_status`, `contract_balances`, `aplicaciones_excedente` e Inventario para la unidad.
- Generador compartido `supabase/functions/_shared/estadoCuenta.ts`, con jsPDF, usable desde el navegador y desde la función de correo de la fase 5. Ya hay precedente: `tablero.ts` importa de `_shared`.
- Contenido:
  - Datos del comprador y de la unidad.
  - **Entrada (20 %)**: pactado, pagado y saldo pendiente.
  - **Pagos confirmados**: fecha, concepto, referencia y número de recibo.
  - Pagos pendientes de verificación, aparte y sin sumar.
  - **Saldo a favor** sin aplicar.
  - **Financiamiento (80 %)**: monto, aplicado con autorización y saldo pendiente.
  - Fecha de corte y leyenda de que no es un documento tributario.
- Botón "Estado de cuenta" en el detalle del contrato en `src/pages/CobranzaPage.tsx`, con el permiso `cobranzas.ver` existente.

Aceptación:
- Un pago anticipado cubre primero lo vencido y luego las próximas cuotas.
- Un pago que supera la entrada deja saldo a favor y **no** reduce el 80 % hasta que Finanzas lo autoriza con motivo y soporte.
- Un usuario sin `cobranzas.aplicar_excedente` no puede autorizar, ni desde la app ni llamando la función.
- Los contratos firmados conservan sus cuotas idénticas, con comparación antes y después.
- La suma entrada pagada + saldo a favor + aplicado a financiamiento es igual al total verificado.
- Pruebas: `supabase/tests/pagos-anticipados.test.ts` (nueva) y ajustes en `cobranza.test.ts`, `cobranza-logica.test.ts` y `cobranza-app.test.tsx`.

---

## Fase 3 · Oficial de Cumplimiento, expediente y revisión antes de la firma (decisiones 3, 4 y 7)

### 3.1 Rol y permisos

Permisos nuevos (módulo "Cumplimiento" en la matriz de Configuración):
- `cumplimiento.ver`: consultar el expediente de cumplimiento y sus documentos.
- `cumplimiento.revisar`: observar, aprobar o rechazar documentos y expedientes.

Plantilla nueva `oficial_cumplimiento` en `PLANTILLAS_ROL` y en la migración, con alcance de todo el proyecto. Permisos: `clientes.ver`, `reservas.ver`, `ventas.ver`, `ventas.documentos_ver`, `cumplimiento.ver` y `cumplimiento.revisar`.
- **Sin** acceso a cobranzas, comprobantes, precios, comisiones ni configuración.
- No hay módulo nuevo: entra por Clientes y por Ventas y contratos.

Finanzas: se reutiliza el rol existente, sin duplicarlo. Solo recibe `cobranzas.aplicar_excedente` (fase 2) y no ve el expediente de cumplimiento.

Archivos:
- `src/app/permissions.ts`.
- `supabase/seed_roles.sql`.
- `src/app/navigation.ts`: sin cambios, porque los permisos existentes ya muestran Clientes y Ventas.

### 3.2 Expediente: documentos habilitantes

Migración `20261114000000_cumplimiento.sql`:
- Una sola tabla, `expediente_documentos`:
  - cliente, comprador (`contract_buyers`, opcional) y contrato (opcional).
  - `tipo`, según el catálogo por tipo de persona.
  - archivo (ruta, nombre, mime, tamaño, hash) y vigencia.
  - `estado`: `cargado`, `observado`, `aprobado` o `rechazado`, con observación, quién revisó y cuándo.
  - Reemplazo por versión: el documento anterior queda `reemplazado` y no se borra.
- Catálogo de tipos en la base (`expediente_tipos`) para ajustarlo cuando llegue la lista de Jarval sin tocar código:
  - Persona natural: cédula, certificado de votación, planilla de servicio básico, declaración de origen de fondos y formulario Conozca a su Cliente.
  - Persona jurídica: RUC, escritura de constitución, nombramiento del representante, cédula del representante, nómina de accionistas, declaración de origen de fondos y formulario Conozca a su Cliente.
- Bucket privado `expediente-clientes` (máx. 10 MB, PDF, JPG o PNG).
  - Lectura: solo `cumplimiento.ver`, o quien lo cargó dentro de su alcance.
  - Carga: `clientes.editar` o `ventas.datos_comprador`, dentro de su alcance.
  - Finanzas y Gerencia no lo ven salvo que se les asigne el permiso.
- Funciones `expediente_cargar`, `expediente_revisar(id, estado, observacion)` y `expediente_reemplazar`, con auditoría.

### 3.3 Formulario Conozca a su Cliente (Jarval)

Mientras no llegue el formato validado, se trata como **un tipo de documento más**: el formulario firmado se sube en PDF y Cumplimiento lo revisa. Así no se construye un formulario digital que luego haya que rehacer. Cuando llegue el formato de Jarval se decide si conviene digitalizarlo. Eso sería una ampliación aparte.

### 3.4 Revisión de Cumplimiento en Ventas y contratos

En la misma migración:
- Tabla `cumplimiento_revisiones`: contrato, estado (`pendiente`, `observado`, `aprobado` o `rechazado`), observaciones, quién y cuándo. Cada cambio es una fila nueva, así que el historial completo es la trazabilidad.
- `cumplimiento_enviar(contrato)`: la usa Legal (`ventas.preparar`). Exige que estén cargados (no rechazados ni vencidos) todos los documentos obligatorios de cada comprador. Para aprobar el expediente, todos deben estar aprobados.
- `cumplimiento_resolver(contrato, estado, observaciones)`: la usa `cumplimiento.revisar`. Las observaciones son obligatorias para `observado` y `rechazado`.
- Un disparador en `contracts` rechaza pasar de borrador a firmado si la última revisión no es `aprobado` (no se reescribe `contratos_firmar`). Los contratos ya firmados no se tocan.
- Recomendación: que quien prepara el contrato no pueda aprobar su propio cumplimiento.

Aplicación:
- `src/pages/VentasPage.tsx`: sección "Cumplimiento" en el expediente de la venta, con estado, historial, documentos y acciones según el permiso. "Marcar como firmado" queda deshabilitado con el motivo visible.
- `src/features/clientes/components/ClienteSheet.tsx`: pestaña "Documentos" para cargar y ver el estado de los habilitantes.
- Funciones de acceso a datos en `src/features/ventas/remoto.ts` y `src/features/clientes/remoto.ts`.

Riesgos:
- Contratos en borrador al aplicar la migración quedarán sin poder firmarse hasta pasar cumplimiento. Hay que listarlos antes y avisar a Legal.
- La lista de documentos obligatorios está pendiente de Jarval. Se carga en el catálogo y se ajusta sin migración.
- Datos personales sensibles: bucket privado, acceso mínimo y auditoría de descargas.

Aceptación:
- El Oficial de Cumplimiento entra y ve solo Clientes y Ventas y contratos. No ve Cobranzas, Precios ni Comisiones.
- Puede ver y descargar documentos del expediente. No puede ver comprobantes de pago.
- Finanzas no puede abrir documentos del expediente (lo comprueba la política del bucket, no solo la pantalla).
- Sin aprobación de Cumplimiento, `contratos_firmar` falla también si se llama directamente.
- Observar exige comentario. El historial muestra cada cambio con persona y fecha.
- Pruebas: `supabase/tests/cumplimiento.test.ts` (nueva), `perfiles-permisos.test.ts`, `ventas-contratos.test.ts` y `ventas-app.test.tsx`.

---

## Fase 4 · Modificación de cuotas extraordinarias después de firmar (decisión 6)

En la cotización todo sigue igual. Después de firmar, un cambio solo se aplica con solicitud, aprobación y adenda firmada.

Migración `20261115000000_modificacion_cuotas.sql`:
- Tabla `modificaciones_cuotas`:
  - contrato y motivo.
  - cuotas extraordinarias propuestas (mismo formato jsonb y validación que `cuotas_con_extraordinarias`).
  - estado: `solicitada`, `aprobada`, `rechazada`, `aplicada` o `anulada`.
  - quién solicitó, aprobó y aplicó.
  - adenda vinculada (`contract_document_versions`, tipo `adenda`, estado `firmado`).
- Funciones:
  - `modificacion_solicitar`: Legal o Finanzas.
  - `modificacion_resolver`: Gerencia.
  - `modificacion_aplicar`: exige aprobación y adenda firmada. Recalcula solo las cuotas **futuras no pagadas** de la entrada, conserva el total del 14 % y deja intactas las cuotas pagadas o vencidas.
- Las cuotas reemplazadas no se borran: se marcan como reemplazadas y se crean las nuevas, con auditoría.

Permiso nuevo: `ventas.modificacion_aprobar` ("Aprobar modificaciones de cuotas de contratos firmados"), para Gerencia. Solicitar usa los permisos existentes `ventas.preparar` y `cobranzas.verificar`.

Aplicación: sección "Modificaciones" en el expediente de `src/pages/VentasPage.tsx` y aviso en el detalle de Cobranzas.

Riesgos:
- Recalcular afecta los vencimientos y las alertas de cobranza. Al aplicar se cancelan las alertas pendientes de las cuotas reemplazadas.
- No se aplica sin la adenda firmada.

Aceptación:
- Sin adenda firmada no se puede aplicar.
- El total de la entrada no cambia, y las cuotas pagadas y vencidas quedan iguales.
- El estado de cuenta refleja el nuevo cronograma.
- Pruebas: `supabase/tests/modificacion-cuotas.test.ts` (nueva).

---

## Fase 5 · Notificaciones (decisión 5)

Requiere que la fase 0 esté aprobada. Se reutiliza la cola actual (`cobranza_alertas`) y su envío con reintentos y sin duplicados.

Migración `20261116000000_notificaciones.sql`:
- `cobranza_alertas` agrega `adjunto_ruta`, `adjunto_nombre` y `destinatario_tipo` (`interno` o `comprador`).
- Los avisos por evento se encolan dentro de la misma función que registra el hecho, con una clave única para no duplicar.
- `clients.acepta_notificaciones` (por defecto verdadero) y la fecha de consentimiento, para que el comprador pueda dejar de recibirlas.

Avisos al comprador (correo de `contract_buyers` o, si no hay, de `clients`):
- Constancia provisional registrada (adjunta la constancia).
- Pago confirmado con recibo definitivo (adjunta el recibo).
- Estado de cuenta (adjunto): mensual el día 1, y a pedido desde Cobranzas.
- Recordatorio de cuota: 5 días antes y el día del vencimiento.

Avisos internos:
- Contrato enviado a revisión → Oficial de Cumplimiento.
- Revisión resuelta (aprobada, observada o rechazada) → Legal y el asesor.
- Comprobante registrado → Finanzas (ya existe el aviso de 24 h sin verificar).
- Excedente pendiente de autorizar → Finanzas.
- Modificación de cuotas solicitada → Gerencia.

Envío:
- `supabase/functions/cobranza-diaria/index.ts` mantiene la planificación diaria.
- La parte de **envío** pasa a ejecutarse cada 15 minutos, para que los avisos por evento no esperen al día siguiente.
- Los adjuntos se leen del bucket con la clave de servicio y se envían por la API de Resend.
- Los PDF de recibo y estado de cuenta usan los generadores compartidos de las fases 1 y 2.

Archivos:
- `supabase/functions/_shared/cobranza.ts` (nuevos tipos y plantillas de correo).
- `supabase/functions/cobranza-diaria/index.ts`.
- Una pantalla en Configuración para ver la cola de envíos (estado y errores), con `config.auditoria`.

Riesgos:
- Correos a clientes con datos financieros: confirmar el destinatario antes de adjuntar. Nunca enviar un estado de cuenta a un correo no registrado del comprador.
- Protección de datos personales (LOPDP): consentimiento y opción de baja.
- Si se cae el proveedor, los avisos quedan en la cola y se reintentan. Tras 3 fallos quedan como fallidos y visibles.

Aceptación:
- Cada evento genera un solo correo, aunque la función corra dos veces.
- El comprador recibe el recibo y el estado de cuenta correctos (unidad, montos y fecha de corte).
- Un comprador que se dio de baja no recibe avisos. Los responsables internos sí.
- El Oficial de Cumplimiento recibe el aviso de revisión y el enlace lo lleva al expediente después de iniciar sesión.
- Pruebas: `cobranza-logica.test.ts` (planificación y deduplicación) y una prueba real controlada a correos internos.

---

## Permisos: resumen de cambios

| Permiso nuevo | Para | Fase |
|---|---|---|
| `cobranzas.aplicar_excedente` | Finanzas | 2 |
| `cumplimiento.ver` | Oficial de Cumplimiento | 3 |
| `cumplimiento.revisar` | Oficial de Cumplimiento | 3 |
| `ventas.modificacion_aprobar` | Gerencia | 4 |

Rol nuevo: **Oficial de Cumplimiento** (fase 3). El rol Finanzas se reutiliza. El Administrador recibe todos los permisos, como hoy.

## Pendientes externos

- Formulario Conozca a su Cliente de Jarval y su lista de habilitantes por tipo de persona (fase 3; no bloquea el desarrollo).
- Dominio remitente verificado en Resend (fase 0).
- Texto legal de la leyenda de la constancia y de los correos, revisado por Legal (fases 1 y 5).
