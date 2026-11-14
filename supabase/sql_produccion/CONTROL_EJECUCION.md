# Control de ejecución de SQL en producción

Proyecto Supabase: NUVAREL (`sjjjlnqgcaqtkmzdcmog`). Última actualización: 2026-11-13.

## Reglas (para Claude, Codex y cualquier asistente)

1. Todo SQL que se ejecuta a mano en producción está en esta carpeta, `supabase/sql_produccion/`.
2. Nombre: `NNNN_nombre.sql`, con cuatro dígitos consecutivos. El orden respeta las dependencias, no la fecha. Un número nunca se reutiliza; uno nuevo va al final.
3. Cada `NNNN_*.sql` es una **copia exacta** de su migración en `supabase/migrations/`, que sigue siendo la fuente para las pruebas. No se edita aquí: se cambia la migración y se regenera con `REGENERAR=1 npx vitest run supabase/tests/sql-produccion.test.ts`. La prueba falla si alguna copia difiere.
4. El usuario ejecuta cada archivo **completo** en el SQL Editor de Supabase, en orden, y comunica el resultado. Después se actualiza esta tabla.
5. Estados: **PENDIENTE**, **EJECUTADO** (corrió sin error), **VERIFICADO** (`VERIFICAR_DESPLIEGUE.sql` lo confirma), **ERROR** (se anota el mensaje y no se sigue con el siguiente).
6. Un estado se cambia solo con evidencia: el resultado que comunica el usuario o una consulta a producción. Que el archivo exista no significa que esté ejecutado.
7. No se piden contraseñas ni se configuran conexiones automáticas para este procedimiento. No se publica en A2 Hosting y los correos siguen en modo prueba.

## Pendientes, en orden de ejecución

| N.º | Archivo | Objetivo | Estado | Fecha | Resultado |
|---|---|---|---|---|---|
| 0001 | `0001_correo_destinatario_efectivo.sql` | Historial de correos: a quién se entregó de verdad cada aviso (modo prueba) | VERIFICADO | 2026-11-11 | Ejecutado por el usuario. VERIFICAR_DESPLIEGUE: 0 FALTA, 0 DISTINTO. |
| 0002 | `0002_pagos_anticipados.sql` | Fase 2: aplicación de pagos, saldo a favor, autorización de excedentes al 80 % y soporte en Storage | VERIFICADO | 2026-11-11 | Ejecutado por el usuario. VERIFICAR_DESPLIEGUE: 0 FALTA, 0 DISTINTO. |
| 0003 | `0003_cumplimiento.sql` | Fase 3: Oficial de Cumplimiento, expediente, revisión obligatoria antes de la firma y catálogo versionado de documentos | VERIFICADO | 2026-11-11 | Ejecutado por el usuario (usuario Oficial creado en producción). VERIFICAR_DESPLIEGUE: 0 FALTA, 0 DISTINTO. |
| 0004 | `0004_notificaciones.sql` | Fase 5: avisos internos por evento, recordatorios diarios e historial de envíos | VERIFICADO | 2026-11-11 | VERIFICAR_DESPLIEGUE: 0 FALTA, 0 DISTINTO (incluye sus funciones, disparadores y políticas). |
| 0005 | `0005_clientes_unicos_reasignacion.sql` | Clientes únicos por documento (cédula, RUC, pasaporte) con mensaje claro, solicitudes de reasignación resueltas por Supervisor o Gerencia, historial del vendedor responsable y trazabilidad del cliente | VERIFICADO | 2026-11-12 | Aplicado en producción (confirmar quién y cuándo lo ejecutó). VERIFICAR_DESPLIEGUE: 0 FALTA, 0 DISTINTO, 0 ADICIONAL; huellas de funciones iguales al repositorio. |
| 0006 | `0006_precios_lista_oficial.sql` | Lista oficial de precios del 12/11/2026 en las 72 unidades (usd_m2, usd_m2_lista y precio_referencia); patio a USD 230/m²; total USD 11.129.497 | VERIFICADO | 2026-11-12 | Ejecutado por el usuario. Lectura: 72 unidades, una sola lista (usd_m2 = usd_m2_lista), total USD 11.129.503 con patio a 230 (diferencia de redondeo dentro de la tolerancia). |
| 0007 | `0007_inventario_tres_estados.sql` | Inventario con tres estados (disponible, reservado, vendido): normaliza las unidades según sus compromisos, restringe el campo y ajusta reservas, cotizaciones, contratos y precios | VERIFICADO | 2026-11-12 | Antes: 30 disponibles y 42 por confirmar sin reservas aprobadas ni contratos (lectura, 2026-11-12). Ejecutado por el usuario. Después: 72 disponibles; restricción inventory_units_estado_tres presente; VERIFICAR_DESPLIEGUE sin diferencias. |
| 0008 | `0008_reserva_confirmacion_automatica.sql` | Confirmación automática de reservas normales al verificar el pago (unidad disponible, precio oficial, sin descuento ni cuotas extraordinarias); Gerencia solo autoriza excepciones, con el motivo; aviso de reserva confirmada a Legal y al vendedor | VERIFICADO | 2026-11-12 | Ejecutado por el usuario. VERIFICAR_DESPLIEGUE sin diferencias. No modifica reservas existentes. Las RES-2026-0001 a 0006 tienen precios anteriores a la lista del 12/11: al verificarse quedarán como excepción para Gerencia. Ejecutar después de 0007. |
| 0009 | `0009_celular_unico_identificacion.sql` | Celular obligatorio, validado y único en toda la empresa (09XXXXXXXX y +5939XXXXXXXX son el mismo número; se guarda normalizado); identificación válida obligatoria para solicitar una reserva (persona jurídica con RUC; ecuatoriano con cédula) | VERIFICADO | 2026-11-13 | Verificado en producción (solo lectura): índice clients_celular_uk, celular_normalizado y reservas_exigir_identificacion presentes; ningún cliente sin celular.  No modifica datos existentes; producción no tiene celulares repetidos (lectura, 2026-11-12). Hacer respaldo antes. Ejecutar después de 0008. |
| 0010 | `0010_limpieza_datos_prueba.sql` | Limpieza de clientes, operaciones, cobranzas, comisiones, notificaciones y recibos de prueba; unidades a disponible. Conserva inventario, precios, usuarios, roles, configuración y auditoría. Script de una sola vez, no es migración | VERIFICADO | 2026-11-13 | Verificado en producción (solo lectura): 0 reservas, 0 cotizaciones, 0 oportunidades y 72 de 72 unidades disponibles; después se registró 1 cliente nuevo.  Ejecutar solo después del respaldo verificado. Aborta si hay contratos firmados o pagos verificados. |
| 0011 | `0011_supervisor_vende.sql` | El Supervisor también vende: no autoriza ni rechaza anulaciones de su propio cliente ni resuelve reasignaciones de sus clientes (las decide Gerencia). No cambia permisos ni roles; actualiza la descripción del perfil Supervisor | VERIFICADO | | Verificado en producción (solo lectura, 2026-11-12): funciones nuevas presentes. La descripción del perfil no cambió porque en producción tenía otro texto (cosmético). No modifica datos comerciales. Ejecutar después de 0009; independiente de 0010. |
| 0012 | `0012_comisiones_vendedor.sql` | PROPUESTA pendiente de formalización contractual. Comisión del vendedor: 2,60 % del precio total a nombre del responsable comercial de la venta (fijo al formalizar); lista para pago con promesa firmada y pagos verificados de al menos 6 %; sin tramos, factura ni IVA. Finanzas confirma el desembolso con comprobante. Pagos a vendedores BLOQUEADOS hasta resolver el beneficiario contractual. Las comisiones existentes conservan su esquema | VERIFICADO | | Verificado en producción (solo lectura, 2026-11-13): esquema vendedor, umbral 6 %, pagos a vendedores bloqueados, 2,60 %, política sin aprobar; funciones nuevas presentes y las de factura/IVA retiradas. Producción: 0 contratos y 0 comisiones (lectura, 2026-11-13). Una versión VELKROVA quedó aplicada en parte (error 23514 en la restricción de parámetros al ejecutar esta versión); esta versión convierte ese estado y retira sus funciones. Reversión: `reversion/0012_revertir_comisiones_vendedor.sql`. Hacer respaldo antes. |
| 0013 | `0013_captacion_leads.sql` | Captación de leads (web, Facebook, Instagram): bandeja de leads, participantes con días, horario, vacaciones y pausa, rotación por turnos con bloqueo, pendientes por orden de llegada, duplicados por celular o correo, primer contacto, avisos, orígenes facebook y web, permiso config.leads (solo administrador) | VERIFICADO | 2026-11-13 | Aplicado por Claude con autorización del usuario, en una transacción y después del respaldo lógico verificado (Respaldos-Supabase/logico-2026-11-13T12-48-04: 84 tablas, 1496 filas). VERIFICAR_DESPLIEGUE sin faltantes ni diferencias (solo las 14 columnas sin uso de la versión VELKROVA). Permisos: solo service_role registra leads. Verificación funcional pendiente: verificacion/verificar_captacion_leads.sql (no deja datos).  No modifica clientes, comisiones ni inventario existentes. Hacer respaldo antes. |
| 0014 | `0014_programar_leads_pendientes.sql` | Habilita pg_cron (solo si falta) y programa la asignación de leads pendientes cada 5 minutos. Script de una sola vez, no es migración | ERROR | 2026-11-13 | Al volver a ejecutarlo en el SQL Editor falló con 2BP01 («dependent privileges exist») al crear pg_cron otra vez. La instrucción no cambió nada: el trabajo sigue con jobid 1. Consulta de solo lectura (2026-11-13, 14:00 a 14:20 UTC): trabajo activo, cada 5 minutos, últimas 5 ejecuciones correctas; pg_cron 1.6.4. Corregido en el archivo: solo crea la extensión si falta y ya no otorga permisos sobre cron. Pendiente: ejecutar el archivo corregido completo y comunicar el resultado. Ejecutar después de 0013. Revertir: `select cron.unschedule('amura-leads-pendientes');` |

Dependencias: 0002 necesita Storage de comprobantes (aplicado). 0003 necesita Documentos contractuales (aplicado). 0004 necesita 0002 y 0003. 0005 necesita Clientes (aplicado) y va después de 0004. 0008 va después de 0007, 0009 después de 0008 y 0011 después de 0009 y 0012 después de 0011.

Ninguno borra ni reescribe datos existentes: agregan tablas, columnas con valor por defecto, funciones, disparadores, políticas, el rol y permisos. Redefinen sin tocar datos: las vistas `installment_status` y `contract_balances` (0002), las funciones `comprobante_puede_subir` y `comprobante_archivo_vinculado` (0002) y las políticas "comprobantes pagos consultar" (0002), "leer parametros" (0003) y "ver alertas" (0004).

## Verificación (solo lectura, se puede repetir)

| Archivo | Uso |
|---|---|
| `VERIFICAR_DESPLIEGUE.sql` | Compara producción con el repositorio. Ejecutar después de cada número. La meta es cero FALTA y cero DISTINTO. Se regenera con cada migración nueva (por eso no lleva número). |

Última medición: 2026-11-12 (después de 0001 a 0008): 0 FALTA, 0 DISTINTO y 0 ADICIONAL. Antes: 125 FALTA y 2 DISTINTO.

## Historial anterior a esta numeración

Aplicado en producción antes de 2026-11-11 desde el editor SQL. **VERIFICADO**: `VERIFICAR_DESPLIEGUE.sql` (consulta por CLI, 2026-11-11) no mostró diferencias para ninguno de estos.

| Migración (en `supabase/migrations/`) | Estado |
|---|---|
| `20261028120000_inventario` a `20261101000000_accesos_internos` (40 migraciones, en orden de nombre) | VERIFICADO |
| `20261112000000_constancia_provisional` | VERIFICADO |

## Otros SQL del proyecto (no forman parte de la secuencia)

| Archivo | Tipo | Estado |
|---|---|---|
| `supabase/instalacion/correctivo_clientes_produccion.sql` | Correctivo de Clientes | EJECUTADO (existe `client_access` en producción). No repetir. |
| `supabase/instalacion/primer_administrador.sql`, `alta_usuario.sql` | Alta inicial de cuentas | EJECUTADO (hay 1 administrador). Hoy los usuarios se crean desde la app. |
| `supabase/carga/plan_amura_inicial.sql` | Carga del plan de implementación | EJECUTADO (147 actividades en producción). No repetir. |
| `supabase/instalacion/diagnostico_solo_lectura.sql`, `diagnostico_pagos_anticipados.sql`, `impacto_acceso_clientes.sql`, `revisar_avances_pendientes.sql`, `verificar_correo.sql`, `verificar_dependencias.sql`, `verificar_storage_comprobantes.sql` | Consultas de solo lectura | Utilidades: se pueden ejecutar cuando haga falta. |
| `supabase/instalacion/revertir_documentos_contractuales.sql`, `revertir_fase1_constancia_correo.sql` | Recuperación | No ejecutar salvo una recuperación decidida con el usuario. |
| `supabase/seed.sql`, `supabase/seed_roles.sql` | Datos de una instalación nueva | Ya incluidos en producción; las pruebas los usan. No ejecutar en producción. |
| `supabase/tests/fixtures/*.sql` | Solo pruebas | Nunca en producción. |
