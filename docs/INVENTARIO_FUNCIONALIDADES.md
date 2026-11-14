# Inventario de funcionalidades — AMURA

Última actualización: 2026-11-13 (captación de leads)

Documento de solo lectura. Cuando se agregue, cambie o quite una funcionalidad, actualizar este archivo.

## General

- **Dashboard** (`/`): resumen de inventario, ventas, cobranzas y avance por edificio.
- **Plan de implementación** (`/plan`): cronograma, asignaciones, avance, dependencias, reprogramación, cierre, reportes, importación y exportación.

## Ventas

- **Atender cliente** (`/venta`): flujo guiado para atender a un cliente desde la unidad.
- **Inventario** (`/inventario`): unidades por edificio, piso, tipología y estado; vista de planos; cambio de estado; parámetros de pago; herramientas de precio; importación y exportación de Excel.
- **Financiamiento** (`/financiamiento`): simulación de crédito con condiciones aprobadas; administración de tasas y productos bancarios; PDF integral.
- **Precios** (`/precios`): lista de precios, simulador, comparables de competencia, propuestas de cambio y aprobación.
- **Cotizaciones** (`/cotizaciones`): cotización en PDF con precio, condiciones de pago, cronograma y vigencia; autorización de descuentos.
- **Clientes** (`/clientes`): alcance por asesor, asignación y reasignación, actividades, exportación.
  - Documentos del expediente en la ficha del cliente (fase 3; **en el repositorio, falta aplicar en producción**): tipo de persona (natural o jurídica), carga y reemplazo por versión de los documentos habilitantes, estado de revisión.
- **Captación de leads**: base y funciones en producción (SQL 0013 y 0014); **interfaz sin publicar en A2 Hosting**. Guía: `docs/CAPTACION_LEADS.md`.
  - **Fuentes:** formularios de la página web, con el conector `integraciones/web/amura-leads.js` y captura previa al botón de WhatsApp; Facebook e Instagram Lead Ads, por el webhook `leads-meta`.
  - **Registro:** cada lead entra a Clientes como prospecto, con su fuente, campaña, formulario y página.
  - **Asignación:** por turnos según la disponibilidad de cada vendedor; bandeja de pendientes; sin duplicar clientes (por celular o correo).
  - **Seguimiento:** primer contacto, «Contactar por WhatsApp» en la ficha e indicadores por fuente, campaña y vendedor.
  - **Configuración:** Configuración → Distribución de leads, solo el administrador.

## Construcción

- **Avance de obra** (`/obra`): avance por partida, documentos, evidencias, validación, importación, exportación y reportes.

## Seguimiento

- **Gestión comercial** (`/comercial`): tablero de clientes por etapa.
- **Reservas** (`/reservas`): solicitud, verificación de pago, confirmación y anulación.
- **Ventas y contratos** (`/ventas`): expediente, documentos contractuales desde plantillas Word, aprobación de plantillas, emisión, datos legales del comprador, desistimientos.
  - Cumplimiento (fase 3; **en el repositorio, falta aplicar en producción**): documentos obligatorios de cada comprador, envío a revisión (Legal), revisión por documento y resolución del expediente (Oficial de Cumplimiento), historial con persona y fecha, descarga individual o completa con auditoría. Sin la aprobación de Cumplimiento el contrato no se puede marcar como firmado, tampoco llamando la función directamente.
- **Corredores** (`/corredores`): aliados comerciales, acuerdos y atribución.

## Finanzas

- **Pagos por verificar** (`/pagos-por-verificar`): bandeja de comprobantes reportados de reservas y cuotas, con monto reportado, confirmado y saldo por separado y acceso a la revisión. Pantalla de inicio de Finanzas.
- **Bandeja de Cumplimiento** (`/cumplimiento`): documentos y contratos por revisar, por corregir y aprobados, con historial de decisiones; abre el expediente del cliente o del contrato para decidir. Pantalla de inicio del Oficial de Cumplimiento.
- **Dashboard de equipo** (`/equipo`) y **Mi equipo** (`/mi-equipo`): indicadores por vendedor y totales del equipo; detalle de clientes, cotizaciones, reservas, ventas, oportunidades y actividades de cada vendedor. Inicio del Supervisor; también para Gerencia.
- **Clientes únicos y reasignación** (SQL 0005): documento normalizado y único (cédula, RUC, pasaporte), aviso antes de guardar, solicitud de reasignación resuelta por Supervisor o Gerencia, historial del vendedor responsable y trazabilidad en la ficha.
- **Pago rechazado en Reservas**: estado, motivo, fecha y «Reemplazar comprobante y reenviar».
- **Dashboard financiero** (`/finanzas`): cobrado confirmado, saldos, vencido, pagos por verificar, mora y desembolso esperado.

- **Cobranzas** (`/cobranzas`): registro de comprobantes, verificación y conciliación de ingresos, tablero.
  - Medio de pago (transferencia, depósito o cheque) y constancia provisional `CP-AAAA-####` al registrar un comprobante (fase 1; en producción).
  - Recibo definitivo con los datos completos de la unidad (fase 1).
  - Pagos anticipados (fase 2; **en el repositorio, falta aplicar en producción**): lo verificado cubre primero la reserva y luego la entrada en orden de vencimiento. El excedente queda como saldo a favor y solo reduce el saldo contra entrega (80 %) con autorización de Finanzas (permiso `cobranzas.aplicar_excedente`), con motivo y soporte. Se anula con motivo y queda el historial.
  - Estado de cuenta PDF desde el detalle del contrato (fase 2): entrada, pagos confirmados, pendientes aparte, saldo a favor y 80 %.
- **Comisiones** (`/comisiones`): cálculo, revisión, aprobación, liquidación y confirmación de pagos. Cada asesor ve las suyas.
- **Reportes** (`/reportes`): **en construcción** (marcador "Próximamente").

## Sistema

- **Centro de recursos** (`/recursos`): **en construcción** (marcador "Próximamente").
- **Configuración** (`/configuracion`): usuarios, roles y permisos, equipos, auditoría, multimedia y cobros.
  - Rol Oficial de Cumplimiento (fase 3): Clientes y Ventas y contratos en consulta, más `cumplimiento.ver` y `cumplimiento.revisar`. Sin cobranzas, comprobantes, comisiones ni configuración.
  - Documentos del expediente (fase 3): lista provisional de documentos obligatorios, configurable por administración y versionada (cada cambio guarda una versión completa; nada se borra, se desactiva).
  - Notificaciones (fase 5; **en el repositorio, falta aplicar en producción**): historial de avisos con evento, destinatario original, buzón que lo recibió (modo prueba), estado de envío, errores y enlace al registro.

## Transversal

- Inicio de sesión con Supabase; cada perfil entra a su primer módulo autorizado.
- Permisos por rol en cada módulo (catálogo en `src/app/permissions.ts`).
- Menú lateral por rol, separado de los permisos (`MENU_POR_ROL` en `src/app/navigation.ts`). Hoy definido para Finanzas. Reportes y Centro de recursos ocultos mientras estén en construcción.
- Al cambiar de cuenta en el mismo navegador, los datos del usuario anterior se descartan.
- Mensajes de bienvenida y presentación del proyecto (`src/features/marca/`).
- Notificaciones internas por correo (fase 5): se encolan con cada hecho (reserva por aprobar, pago por verificar, contrato por documentar, expediente por revisar, observado, rechazado o aprobado, contrato listo para firma, anulaciones y excedentes) y con recordatorios diarios de lo que sigue esperando. Sin duplicados. Solo usuarios internos; nunca compradores ni corredores. Se envían con la función `cobranza-diaria` y respetan el modo prueba.
