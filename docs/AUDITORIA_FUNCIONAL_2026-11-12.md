# Auditoría funcional AMURA · 2026-11-12

Alcance: los tres problemas ALTO y el proceso comercial con los registros ficticios: cliente **Cliente Prueba Vendedor AMURA 002**, cotización **COT-2026-0008** y reserva **RES-2026-0004**.

Método: lectura de producción (base y registros de la API) y del código. Sin cambios en datos, permisos ni pagos.

**Límite:** no tengo las contraseñas de las cuentas de prueba, así que no navegué la app como cada rol. Lo que depende de la pantalla queda como PENDIENTE, para hacerlo con las cuentas de prueba (usuario o Codex).

## 1. Los tres problemas ALTO

### H-01 · Menú del Vendedor con más módulos de los necesarios — MEDIO (no bloquea)
- **Rol:** Vendedor (`asesor`).
- **Observado:** ve 15 módulos.
  - Dashboard, Plan de implementación, Atender cliente, Inventario, Financiamiento, Precios, Cotizaciones y Clientes.
  - Avance de obra, Gestión comercial, Reservas, Ventas y contratos, Cobranzas, Comisiones y Centro de recursos.
  - Calculado con los permisos reales de producción.
- **Esperado:** solo lo de su función comercial.
- **Causa:** no es un error de código. La plantilla del rol incluye `plan.ver`, `plan.avance` y `plan.exportar` (Plan de implementación), `recursos.ver` (Centro de recursos, que todavía es un marcador "Próximamente"), `obra.resumen`, `cobranzas.ver` y `ventas.ver`.
- **Corrección recomendada (decisión tuya):**
  - quitar Plan de implementación y Centro de recursos al Vendedor;
  - mantener Cobranzas y Ventas en consulta de sus propios clientes, o quitarlos.
  - Se aplica como un SQL numerado nuevo, después de tu decisión.

### H-02 · "Registrar pago" deshabilitado — NO ES ERROR (restricción intencional); falta confirmarlo con la pantalla
- **Rol:** Vendedor, sobre RES-2026-0004.
- **Datos reales:** la reserva está `solicitada`, sin comprobante, por USD 500, vigente hasta el 26/11, y el cliente es del Vendedor de prueba.
- **Reglas del código:**
  - El botón **Registrar pago** aparece si la reserva está `solicitada`, sin comprobante, y el rol tiene `reservas.solicitar`. El Vendedor lo tiene: el botón se ve y queda habilitado. Solo se inhabilita mientras otra acción está en curso.
  - Dentro del diálogo, el botón **Registrar** se habilita recién con monto mayor que 0, fecha, banco (2 caracteres o más), referencia (3 o más) y el **comprobante adjunto** (PDF, JPG o PNG, hasta 10 MB). Es un control deliberado: sin comprobante no se registra un pago.
- **Conclusión:** no es un problema de permisos. Lo más probable es que faltara el archivo o la referencia. Si el que se ve deshabilitado es el botón exterior y no el del diálogo, necesito la captura.
- **No continué ese paso:** registrar el pago crea un comprobante y una constancia de un pago que no existe, y pediste detenerse ante pagos.

### H-03 · El Oficial de Cumplimiento "no accede" a Ventas ni a Atender cliente — NO ES ERROR DE PERMISOS
- **Atender cliente:** exige `cotizaciones.crear`. El Oficial no cotiza ni reserva: es **intencional**.
- **Ventas y contratos:**
  - En producción el rol tiene `ventas.ver`, así que el menú lo muestra.
  - Los registros de la API muestran 404 en las tablas del expediente y de excedentes solo a las 02:15–02:16 UTC, **antes de aplicar 0002 y 0003**. Desde entonces no hay ningún error.
  - El Oficial sí trabajó a las 02:43: revisó y observó la cédula del cliente de prueba.
- **Causa probable:**
  1. Si probó antes de las 02:16 UTC, faltaban las tablas.
  2. En producción hay **0 contratos**. Ventas y contratos no le muestra nada que revisar, porque Cumplimiento actúa sobre el contrato, y RES-2026-0004 todavía no tiene pago, aprobación ni contrato.
- **Corrección:** ninguna en permisos. Volver a probar con las cuentas de prueba. Si sigue sin verse el módulo, enviar la captura.

## 2. Proceso comercial con el registro ficticio

| Etapa | Quién | Condición para avanzar | Estado RES-2026-0004 |
|---|---|---|---|
| Cliente | Vendedor | Ficha con teléfono o correo | Aprobado: cliente del Vendedor de prueba |
| Documentación | Vendedor carga; Oficial revisa | Cada documento obligatorio cargado y aprobado; quien carga no revisa | En curso: 5 de 5 cargados, cédula **observada** (la identidad no corresponde), 4 por revisar |
| Cotización | Vendedor | Unidad disponible | Aprobado: COT-2026-0008 aceptada (USD 163.918) |
| Reserva | Vendedor solicita | Cotización aceptada | Aprobado: RES-2026-0004 solicitada (USD 500) |
| Pago de reserva | Vendedor registra comprobante; Finanzas verifica en banco | Comprobante real | **Bloqueado a propósito**: pago ficticio, requiere tu autorización |
| Aprobación de reserva | Gerencia | Pago verificado | Pendiente (depende del paso anterior) |
| Contrato | Legal genera | Reserva aprobada | Pendiente |
| Cumplimiento | Legal envía; Oficial resuelve | Documentos aprobados; quien prepara no aprueba | Pendiente |
| Firma | Legal | Cumplimiento aprobado | Pendiente |
| Pagos | Vendedor o Finanzas registran; Finanzas verifica; otra persona confirma | Comprobante real | Pendiente |
| Comisiones | Gerencia o Administración | Contrato firmado y política aprobada (hoy: **no** aprobada) | Pendiente |
| Seguimiento y notificaciones | Automático | Tarea diaria desplegada | Pendiente: `cobranza-diaria` no está desplegada |

## 3. Otros hallazgos

| ID | Nivel | Módulo / rol | Observado | Esperado | Causa | Corrección | ¿Bloquea? |
|---|---|---|---|---|---|---|---|
| H-04 | ALTO | Notificaciones / todos | La cola de avisos está vacía y nada se envía | Avisos de cada evento e historial | La función `cobranza-diaria` no está desplegada y faltan sus secretos. Desde que se aplicó 0004 no hubo hechos que generen avisos | Desplegar la función en modo prueba y hacer una prueba controlada | Sí, para notificaciones; no para el resto |
| H-05 | MEDIO | Cobranzas / Finanzas | Un comprobante de reserva (RES-2026-0003) espera verificación desde el 11/11 sin aviso | Recordatorio a las 24 h | El recordatorio de 24 h solo cubre pagos de contratos, no comprobantes de reservas. Además, ese comprobante es anterior a 0004 | Agregar el recordatorio de reservas (SQL numerado) | No |
| H-06 | MEDIO | Comisiones / Gerencia | La política de liquidación no está aprobada | Aprobada antes de la primera venta | Pendiente de negocio | Aprobarla en Comisiones | Sí, para liquidar comisiones |
| H-07 | BAJO | Cobranzas / Vendedor | El comprobante de RES-2026-0003 no tiene número de constancia | — | Se registró antes de existir las constancias | Ninguna: los nuevos sí lo tienen | No |
| H-08 | MEDIO | Sistema / todos | Centro de recursos y Reportes aparecen en el menú, pero dicen "Próximamente" | Ocultos hasta existir | Módulos sin desarrollar | Ocultarlos o terminarlos | No |
| H-09 | ALTO | Datos / Oficial | Hay un documento observado porque la cédula pertenece a otra persona ("Ana Ejemplo") | — | Dato de prueba deliberado | El Vendedor debe reemplazarlo | Sí, para aprobar el expediente |

## 4. Matriz de pruebas

| Prueba | Rol | Resultado |
|---|---|---|
| Menú por rol (calculado con permisos reales) | Todos | APROBADA como cálculo. El ajuste del Vendedor queda como decisión (H-01) |
| El Oficial no ve Cobranzas, Comisiones ni Configuración | Oficial | APROBADA (permisos reales) |
| El Oficial revisa un documento con observación obligatoria | Oficial | APROBADA (02:43 UTC) |
| Separación: quien carga no revisa | Vendedor y Oficial | APROBADA (cargó el Vendedor, revisó el Oficial) |
| Carga de los 5 documentos | Vendedor | APROBADA |
| Cotización y reserva | Vendedor | APROBADA |
| Registrar pago de RES-2026-0004 | Vendedor | BLOQUEADA a propósito (pago ficticio, sin tu autorización) |
| Verificar pago | Finanzas | PENDIENTE (depende del anterior; RES-2026-0003 espera) |
| Aprobar reserva | Gerencia | PENDIENTE |
| Contrato, Cumplimiento, firma | Legal y Oficial | PENDIENTE (no hay contratos). Además, no hay cuenta de prueba de Legal |
| Pagos de contrato, saldo a favor, estado de cuenta | Vendedor y Finanzas | PENDIENTE |
| Comisiones | Gerencia y Administración | PENDIENTE (H-06) |
| Notificaciones | Todos | FALLIDA (H-04) |
| Navegación en pantalla por rol | Todos | PENDIENTE (requiere las cuentas de prueba) |

## 5. Correcciones priorizadas

**Impiden operar:**
1. **H-04:** desplegar `cobranza-diaria` con sus secretos en modo prueba.
2. **Cuenta de prueba de Legal:** crearla. Sin ella no se puede probar contrato, Cumplimiento ni firma.
3. **H-06:** aprobar la política de liquidación de comisiones antes de la primera venta.

**No impiden operar:**
4. **H-01:** decidir el menú del Vendedor.
5. **H-05:** recordatorio de comprobantes de reserva sin verificar.
6. **H-08:** ocultar los módulos "Próximamente".

**Para seguir el recorrido** necesito tu autorización para registrar en RES-2026-0004 un comprobante de pago ficticio marcado PRUEBA. Lo haría el Vendedor de prueba y luego lo verificaría Finanzas de prueba, que debe ser otra persona.

## 6. Datos de prueba

**Decisión del usuario (2026-11-12):** no se desarrolla ningún mecanismo para aislar datos de prueba. Mientras AMURA no esté en operación comercial, todos los datos se consideran de prueba. Antes del lanzamiento se hará una limpieza controlada que conserve la estructura, los usuarios necesarios, la configuración y los permisos.

Queda autorizado registrar y verificar un pago ficticio en RES-2026-0004. Consecuencias aceptadas: consume CP-2026-0001 y REC-2026-0001, suma al cobrado y deja avisos en la cola.

## 7. Notificaciones: despliegue de `cobranza-diaria`

Intenté desplegarla de forma segura:
- primero el buzón de pruebas (`CORREO_PRUEBA_DESTINO`) y un secreto de acceso generado al azar;
- **sin** clave de Resend, de modo que no pudiera enviar ningún correo;
- después, una sola llamada de verificación.

El control de seguridad de esta sesión **bloqueó** el comando, porque cambia secretos y despliega en producción. No lo rodeé. Queda como **configuración pendiente**: necesito que apruebes ese comando o que lo ejecutes tú (procedimiento en `docs/PENDIENTES_PRODUCCION.md`).

## 8. Error de sesión corregido (H-10, ALTO)

- **Módulo / rol:** inicio de sesión, todos los roles.
- **Acción:** con AMURA abierta, alguien entra con otra cuenta en el mismo navegador (por ejemplo, en otra pestaña).
- **Observado:** la pestaña abierta cambia de usuario y de menú, pero conserva en memoria los clientes, el inventario y las reservas del usuario anterior hasta recargar. Un rol podía ver datos que no le corresponden.
- **Causa:** los almacenes de datos se montaban una sola vez y no se reiniciaban al cambiar de usuario.
- **Corrección (aplicada en el código, 2026-11-12):** al cambiar de usuario se descartan los datos cargados y se vuelven a leer con los permisos de la cuenta nueva. Hay una prueba automática que falla sin la corrección.
- **Pendiente:** no hay SQL. Falta comprobarlo en la app: entrar con dos cuentas de prueba en dos pestañas.

## 9. Qué puede hacer cada rol (permisos reales de producción)

| Acción | Vendedor | Corredor | Supervisor | Gerencia | Finanzas | Legal | Oficial | Admin |
|---|---|---|---|---|---|---|---|---|
| Crear/editar cliente | Sí | Sí | Sí | Sí | — | — | — | Sí |
| Cargar documentos del expediente | Sí | Sí | Sí | Sí | — | Sí | — | Sí |
| Revisar documentos | — | — | — | — | — | — | Sí | Sí |
| Emitir cotización | Sí | Sí | Sí | Sí | — | — | — | Sí |
| Autorizar descuento | — | — | — | Sí | — | — | — | Sí |
| Solicitar reserva | Sí | Sí | Sí | Sí | — | — | — | Sí |
| Registrar pago de reserva | Sí | Sí | Sí | Sí | Sí | — | — | Sí |
| Verificar pago de reserva | — | — | — | — | Sí | — | — | Sí |
| Aprobar reserva | — | — | — | Sí | — | — | — | Sí |
| Generar contrato / enviar a Cumplimiento | — | — | — | — | — | Sí | — | Sí |
| Resolver Cumplimiento | — | — | — | — | — | — | Sí | Sí |
| Registrar firma | — | — | — | — | — | Sí | — | Sí |
| Registrar pago de cuota | — | — | — | — | Sí | — | — | Sí |
| Verificar pago de cuota | — | — | — | — | Sí | — | — | Sí |
| Aplicar excedente al 80 % | — | — | — | — | Sí | — | — | Sí |
| Calcular comisiones | — | — | — | Sí | — | — | — | Sí |
| Aprobar/habilitar comisiones | — | — | — | Sí | — | — | — | Sí |
| Confirmar pago de comisión | — | — | — | — | Sí | — | — | Sí |
| Crear usuarios | — | — | — | — | — | — | — | Sí |

Hallazgos que salen de la matriz:

| ID | Nivel | Tipo | Hallazgo | Recomendación |
|---|---|---|---|---|
| H-11 | ALTO | Configuración pendiente | No hay cuentas de prueba de **Legal** ni de **Corredor**. Sin Legal no se prueban contrato, envío a Cumplimiento ni firma con el rol real. Administración puede hacerlo, pero entonces no se prueba el rol | Crear "PRUEBA QA Legal AMURA" y "PRUEBA QA Corredor AMURA" |
| H-12 | MEDIO | Restricción intencional con efecto operativo | Quien registra un pago no puede confirmarlo. Las cuotas solo las registra Finanzas, así que con **una sola persona en Finanzas** cada pago de cuota necesita a Administración para confirmarse | Definir quién confirma: un segundo usuario de Finanzas o Administración |
| H-13 | BAJO | Restricción intencional | El Vendedor no puede registrar pagos de cuotas: solo de la reserva | Confirmar que así se quiere |
| H-14 | MEDIO | Mejora | Finanzas entra al Dashboard comercial y no a Cobranzas | Incluido en la propuesta de menús (`docs/PROPUESTA_MENUS_POR_ROL.md`) |

## 10. Guion del recorrido de pago y contrato (RES-2026-0004)

Lo ejecuta cada cuenta de prueba en la app. Después de cada paso, Claude verifica en producción, en modo solo lectura, los registros que deben aparecer.

| Paso | Cuenta | Acción en la app | Qué se verifica |
|---|---|---|---|
| 1 | Vendedor de prueba | Clientes → Cliente Prueba Vendedor AMURA 002 → reemplazar la cédula observada | Versión nueva *cargado* y la anterior *reemplazado* |
| 2 | Oficial de prueba | Clientes → el mismo cliente → aprobar los 5 documentos | 5 documentos *aprobado*; el Oficial no cargó ninguno |
| 3 | Vendedor de prueba | Reservas → RES-2026-0004 → Registrar pago (USD 500, transferencia, referencia PRUEBA-0004, PDF de prueba) | Comprobante *reportado* con constancia CP-2026-0001; aviso "pago por verificar" en cola para Finanzas |
| 4 | Finanzas de prueba | Cobranzas → Reservas → revisar y confirmar | Recibo REC-2026-0001; reserva *pago_verificado*; aviso "reserva por aprobar" en cola |
| 5 | Gerencia o Admin | Reservas → aprobar RES-2026-0004 | Reserva *confirmada*; unidad E1-P1-A2 reservada |
| 6 | Legal de prueba (o Admin) | Ventas y contratos → generar el contrato | Contrato en borrador; cuotas; aviso "contrato por documentar" |
| 7 | Legal de prueba (o Admin) | Enviar a Cumplimiento | Revisión *pendiente*; aviso al Oficial |
| 8 | Oficial de prueba | Ventas y contratos → resolver: aprobar | Revisión *aprobado*; aviso "contrato listo para firma" |
| 9 | Legal de prueba (o Admin) | Registrar firma con una referencia de prueba (sin firma electrónica) | Contrato *firmado*; comisión creada; cronograma exigible |
| 10 | Finanzas de prueba + Admin | Cobranzas → registrar el pago de una cuota (Finanzas) y confirmarlo (Admin) | Recibo; saldo; estado de cuenta PDF |
| 11 | Gerencia o Admin | Comisiones → ver la comisión de la venta | Comisión pendiente; no se puede liquidar sin política aprobada (H-06, decisión aparte) |

## 11. Avance del 2026-11-12 (segunda parte)

**Corregido en el código y probado** (no requiere SQL):

| ID | Tipo | Cambio |
|---|---|---|
| H-14 | Mejora aprobada | Menú de Finanzas con solo 5 módulos; entra a **Pagos por verificar**. Conserva sus permisos de lectura |
| H-15 | Mejora aprobada | Pantalla **Pagos por verificar**: cliente, proyecto y unidad, reserva o contrato, monto reportado, confirmado y saldo por separado, fecha, comprobante, estado y "Revisar pago". Confirmar y rechazar usan las mismas reglas: quien registró no decide |
| H-16 | Mejora aprobada | **Dashboard financiero**: cobrado confirmado, saldo de la entrada, vencido, pagos por verificar (sin sumarlos), mora por tramos y desembolso bancario esperado |
| H-08 | Funcionalidad no desarrollada | Reportes y Centro de recursos ocultos para todos los roles |
| H-17 | Error real (encontrado al probar) | El rol se llama `constructor`, igual que una propiedad interna de los objetos de JavaScript, y el menú por rol lo confundía. Corregido antes de que llegara a la app |

Pruebas: 998 pasan, con pruebas nuevas de menú por rol, inicio de Finanzas y bandeja (el vendedor reporta, Finanzas confirma, se emite el recibo y la reserva queda verificada).

**Recorrido comercial con RES-2026-0004:** sigue **pendiente de ejecución en la app con las cuentas de prueba** (guion en la sección 10). Desde la bandeja nueva, el paso 4 (Finanzas verifica) se hace en *Pagos por verificar*.

**Control financiero (punto 7):** se mantiene. Quien registra un pago no lo verifica. Con un solo usuario de Finanzas, Administración actúa como segundo aprobador: tiene `cobranzas.verificar` y `reservas.verificar_pago`, y ve la bandeja.

## 12. Avance del 2026-11-12 (tercera parte)

**Corregido en el código y probado** (no requiere SQL):

| ID | Tipo | Cambio |
|---|---|---|
| H-01 | Mejora aprobada (cerrado) | Menús definitivos para los 10 perfiles (detalle en `docs/PROPUESTA_MENUS_POR_ROL.md`). Vendedor y Corredor sin Plan, Precios, Avance de obra, Ventas ni Cobranzas en el menú; conservan los permisos que usa su operación |
| H-18 | Mejora aprobada | Inicio por perfil: Finanzas → Pagos por verificar; Legal → Ventas y contratos; Oficial → Bandeja de Cumplimiento; Constructor → Avance de obra; los demás → Dashboard |
| H-03 | Mejora aprobada (cerrado) | **Bandeja de Cumplimiento**, inicio del Oficial. Pestañas *Por revisar*, *Por corregir*, *Aprobados* e *Historial*. Documentos y contratos enviados, con el expediente del cliente o del contrato en un panel lateral. Aprobar, observar y rechazar usan las mismas funciones de siempre |

**Límite conocido del historial:** el historial muestra cada envío y resolución del contrato y la última decisión de cada versión de documento. Si un documento se observa y después se aprueba **sin reemplazarlo**, la observación anterior queda solo en Auditoría (Configuración). Para mostrarla en la bandeja haría falta un SQL nuevo; no se preparó porque el flujo normal es reemplazar el documento observado.

**Pruebas:** 1007 pasan (998 anteriores y 9 nuevas). Cubren el menú y el inicio de cada perfil, que cada menú solo liste módulos que el rol puede abrir, que Vendedor y Corredor conserven ventas, cobranzas y reservas, y la bandeja completa (el Oficial observa, el corredor reemplaza, el Oficial aprueba los documentos y el contrato, y todo queda en el historial).

**Producción (solo lectura, hoy):** el Oficial verá en su bandeja 4 documentos *Por revisar* y 1 *Por corregir* (la cédula observada del cliente de prueba). Hay 4 reservas en *solicitada* y 0 contratos. No hay cuentas de prueba de Legal ni de Corredor: Admin cubre a Legal.

**Ninguna etapa del recorrido comercial está aprobada:** ninguna se ha ejecutado todavía desde la interfaz.

### 12.1 Pasos manuales para terminar el recorrido comercial (RES-2026-0004)

Entrar con cada cuenta en una ventana privada distinta, o cerrar sesión entre cuentas. Anotar la hora de cada paso. Claude verifica cada paso en producción (solo lectura).

| Paso | Cuenta | Dónde | Qué hacer | Resultado esperado |
|---|---|---|---|---|
| 1 | Vendedor de prueba | Clientes → *Cliente Prueba Vendedor AMURA 002* → Documentos del expediente | Reemplazar la cédula observada con un PDF de prueba | La cédula vuelve a *Por revisar* |
| 2 | Oficial de prueba | Bandeja de Cumplimiento → *Por revisar* → **Revisar expediente** | Aprobar los 5 documentos (o observar uno con comentario) | Pestaña *Aprobados* con los 5; *Por revisar* en 0 |
| 3 | Vendedor de prueba | Reservas → RES-2026-0004 → **Registrar pago** | USD 500, transferencia, referencia PRUEBA-0004, PDF de prueba | Constancia CP-2026-…; el pago aparece en *Pagos por verificar* |
| 4 | Finanzas de prueba | Pagos por verificar (inicio) → **Revisar pago** | Confirmar contra el estado bancario ficticio | Recibo REC-2026-…; la fila sale de la bandeja; reserva verificada |
| 5 | Gerencia o Admin | Reservas → RES-2026-0004 | Aprobar la reserva | Reserva *confirmada*; la unidad queda reservada |
| 6 | Admin (en lugar de Legal) | Ventas y contratos | Generar el contrato de RES-2026-0004 | Contrato CON-… en borrador con cuotas |
| 7 | Admin (en lugar de Legal) | Ventas y contratos → el contrato → Cumplimiento | **Enviar a Cumplimiento** | El contrato aparece en la bandeja del Oficial |
| 8 | Oficial de prueba | Bandeja de Cumplimiento → **Revisar contrato** → Resolver revisión | Aprobar | Contrato en *Aprobados*; la firma se habilita |
| 9 | Admin (en lugar de Legal) | Ventas y contratos → el contrato | Registrar la firma con una referencia de prueba (sin firma electrónica real) | Contrato *firmado*; cronograma exigible; comisión creada |
| 10 | Finanzas de prueba, luego Admin | Cobranzas → cuota 1 → Registrar pago (Finanzas); Pagos por verificar → Revisar pago (Admin) | Pago ficticio de una cuota | Finanzas ve "Ver pago" y no puede confirmarlo; Admin confirma; se emite el recibo |
| 11 | Gerencia o Admin | Comisiones | Consultar la comisión de la venta | Comisión pendiente. No liquidar: la política sigue sin aprobar (H-06) |

Control adicional en el paso 3: con la cuenta del Vendedor, el menú no debe mostrar Ventas y contratos ni Cobranzas. Desde el Dashboard, la tarjeta *Contratos firmados* debe seguir abriendo Ventas y contratos, solo con sus clientes.

## 13. Equipo del Supervisor, clientes duplicados y pagos rechazados (cuarta parte)

Estados: **Corregido** (código listo), **Probado** (pruebas automáticas aprobadas), **Pendiente** (falta una acción en producción o una prueba desde la interfaz). Ninguna etapa se marca aprobada sin probarla en la interfaz.

### 13.1 Hallazgos

| ID | Prioridad | Hallazgo | Causa | Estado |
|---|---|---|---|---|
| H-19 | ALTA | El Supervisor de prueba no ve a su equipo | **Configuración**: en producción no hay ningún equipo y el Vendedor de prueba no tiene equipo ni supervisor (consulta de solo lectura). Además, el campo Equipo estaba escondido en «Opciones avanzadas» del usuario | Corregido y probado (código). **Pendiente**: crear el equipo y asignar al Vendedor de prueba (13.4, paso A2) |
| H-20 | ALTA | Dos vendedores pueden registrar al mismo cliente con la misma cédula | La base solo impedía repetir teléfono y correo; el documento no se validaba ni era único | Corregido y probado. **Pendiente**: ejecutar `0005_clientes_unicos_reasignacion.sql` |
| H-21 | ALTA | No hay forma ordenada de pedir un cliente ajeno ni historial del cambio de vendedor | Solo existía la reasignación directa, con una nota de texto | Corregido y probado. **Pendiente**: ejecutar 0005 |
| H-22 | ALTA | El Vendedor no ve por qué Finanzas rechazó su comprobante | El rechazo quedaba guardado (motivo y fecha), pero Reservas solo volvía a mostrar «Registrar pago» | Corregido y probado (sin SQL) |
| H-23 | MEDIA | Menú del Supervisor con módulos que no le corresponden | El menú se armaba por permisos | Corregido y probado (sin SQL) |
| H-24 | MEDIA | Contratos bloqueados | **No es un error de permisos.** Un contrato solo se genera desde una reserva aprobada, y en producción las 5 reservas están en *solicitada*, ninguna con pago verificado. El contrato lo genera Legal o Administración (`ventas.preparar`) y no hay cuenta de prueba de Legal. Los registros de Postgres de las últimas 24 h no muestran accesos denegados a usuarios de la app | Sin cambio de código. Se destraba con los pasos de 13.4 |
| H-25 | MEDIA | Ruta de carga documental del Vendedor | En producción el Vendedor de prueba sí cargó 5 documentos, desde Clientes → ficha → Documentos del expediente. Faltaba un acceso desde la reserva | Corregido: botón **Documentos** en cada reserva, que abre la ficha del cliente |

### 13.2 Qué se implementó

**Sin SQL**

- **Menú del Supervisor.** Entra a **Dashboard de equipo**. Ve: Dashboard de equipo, Mi equipo, Cotizaciones, Clientes del equipo, Gestión comercial, Reservas y Ventas del equipo. Conserva sus permisos de datos. Gerencia también ve Dashboard de equipo y Mi equipo.
- **Dashboard de equipo.**
  - Muestra por vendedor y en total: clientes asignados, clientes nuevos, cotizaciones, reservas (solicitadas, aprobadas, y rechazadas o anuladas), ventas, monto vendido, actividades y seguimientos vencidos.
  - Incluye la actividad reciente del equipo.
  - Se puede ver *Este mes* o *Todo*.
- **Mi equipo.** Se elige un vendedor y se ven sus clientes con etapa y próxima acción, sus cotizaciones, reservas, ventas, oportunidades por etapa y actividades.
- **Alcance.** Lo aplica la base. El Supervisor solo recibe a los vendedores de los equipos que supervisa; un vendedor de otro equipo no aparece aunque se pida por la dirección.
- **Equipo visible al editar un usuario.** En Configuración → Usuarios → Cambiar rol, el Equipo ya no está en opciones avanzadas.
- **Pago rechazado.** En Reservas, el Vendedor ve *Pago rechazado el (fecha)*, el motivo y el comprobante. El botón **Reemplazar comprobante y reenviar** lo envía de nuevo a *Pagos por verificar*. El comprobante rechazado se conserva.

**Con el SQL 0005** (la base lo garantiza)

- **Clientes únicos.**
  - El documento se normaliza. Se acepta cédula con dígito verificador, RUC o pasaporte. El RUC de persona natural cuenta como la misma persona que su cédula.
  - Antes de crear o editar un cliente, la base detiene el duplicado por documento, teléfono o correo.
  - A quien puede ver al cliente le muestra: «Este cliente ya se encuentra registrado en AMURA (nombre) y está asignado al vendedor X».
  - A quien no puede verlo le muestra, sin datos personales: «… lo atiende otro vendedor. Puedes solicitar su revisión o reasignación».
  - La ficha avisa al salir del campo y no deja guardar.
- **Reasignación con trazabilidad.**
  - El vendedor la solicita desde el aviso, indicando un motivo.
  - La resuelve un Supervisor que tenga a ambos vendedores en su equipo, o Gerencia. Nunca quien la pidió.
  - Cada cambio de responsable queda en el historial: vendedor anterior, vendedor nuevo, fecha, quién lo hizo, motivo y solicitud.
  - Cotizaciones, reservas y contratos conservan a su autor. Las comisiones no se transfieren.
- **Trazabilidad en la ficha del cliente.** Muestra quién lo registró, el vendedor responsable, el equipo, el supervisor, las reasignaciones y quién generó cada cotización y reserva.

**Mientras 0005 no se ejecute**, las pantallas funcionan como hoy, sin errores, pero sin el aviso previo de duplicado ni la trazabilidad.

### 13.3 Pruebas automáticas

Se aprueban 1024 pruebas: las 1007 anteriores más 17 nuevas. Las nuevas cubren:

1. El Supervisor ve solo a sus vendedores, con indicadores y totales.
2. Consulta los clientes y cotizaciones de su vendedor.
3. No ve un equipo ajeno, ni siquiera pidiéndolo por la dirección.
4. El Vendedor A registra un cliente.
5. El Vendedor B recibe el aviso sin datos personales y no puede guardar.
6. La base no duplica al cliente aunque el documento se escriba de otra forma o se use el RUC.
7. Gerencia aprueba la reasignación. No pueden hacerlo el Supervisor que no tiene a ambos vendedores ni el propio solicitante.
8. Se conservan el historial y la trazabilidad; la cotización mantiene a su autor.
9. El Vendedor ve el rechazo con motivo y fecha, reemplaza el comprobante y lo reenvía.

La prueba de despliegue confirma que 0005 no modifica a los clientes existentes. Incluye una cédula de prueba inválida, como las de producción, que se conserva tal cual: solo se valida un documento nuevo o modificado.

Pruebas existentes ajustadas:
- Las que registraban varios clientes con la misma cédula inválida (`1712345678`) ahora usan cédulas válidas y distintas.
- Las dos que esperaban el mensaje anterior de duplicado ahora esperan el nuevo.

### 13.4 Pasos manuales pendientes

| Paso | Quién | Qué hacer | Resultado esperado |
|---|---|---|---|
| A1 | Usuario | Ejecutar `supabase/sql_produccion/0005_clientes_unicos_reasignacion.sql` en el SQL Editor y después `VERIFICAR_DESPLIEGUE.sql` | 0 FALTA y 0 DISTINTO. Avisar el resultado para marcarlo en CONTROL_EJECUCION |
| A2 | Admin | Configuración → Equipos → **Nuevo equipo** «Equipo de prueba», con Supervisor *PRUEBA QA Supervisor AMURA*. Después, Usuarios → *PRUEBA QA Vendedor AMURA* → Cambiar rol → **Equipo** = Equipo de prueba | El Vendedor de prueba queda en el equipo |
| A3 | Admin | Crear un segundo vendedor ficticio, *PRUEBA QA Vendedor B AMURA* (rol Vendedor), sin equipo | Permite probar duplicados entre equipos |
| 1 | Supervisor de prueba | Iniciar sesión | Se abre **Dashboard de equipo** con el Vendedor de prueba y sus clientes. El menú tiene 7 opciones |
| 2 | Supervisor de prueba | Mi equipo → Vendedor de prueba | Aparecen sus clientes, cotizaciones, reservas (RES-2026-0004 y 0005) y actividades |
| 3 | Supervisor de prueba | Clientes del equipo | No aparecen los clientes de Administración ni de Gerencia |
| 4 | Vendedor de prueba | Clientes → Nuevo cliente ficticio, con cédula **1710034065** | El cliente se registra |
| 5 | Vendedor B | Nuevo cliente con la misma cédula | Aparece el aviso «ya se encuentra registrado… lo atiende otro vendedor» y **Registrar** queda deshabilitado |
| 6 | Vendedor B | Solicitar revisión o reasignación, con un motivo | Aparece «Solicitud enviada». El cliente sigue con el Vendedor de prueba |
| 7 | Gerencia (Liam) o Admin | Dashboard de equipo → Solicitudes → Resolver → aprobar o rechazar | Se resuelve la solicitud. El Supervisor de prueba no puede resolverla porque el Vendedor B no está en su equipo. La ficha del cliente muestra el cambio en *Responsable y trazabilidad* |
| 8 | Vendedor de prueba | Reservas → RES-2026-0004 | Aparece *Pago rechazado el 12/11/2026* con el motivo de Finanzas. Usar **Reemplazar comprobante y reenviar** con un PDF de prueba |
| 9 | Finanzas de prueba | Pagos por verificar → Revisar pago → confirmar | Se emite el recibo. Después seguir los pasos 5 a 11 de la sección 12.1: aprobar la reserva, contrato, Cumplimiento, firma de prueba y cuota |

## 14. Precios, tres estados y guía de venta (quinta parte)

Estados: **Corregido** (código listo y con pruebas automáticas), **Verificado** (comprobado en producción, solo lectura), **Pendiente de comprobar** (falta probarlo en la app con las cuentas de prueba).

### 14.1 Precios e inventario

| Tema | Estado |
|---|---|
| SQL 0006: lista oficial del 12/11/2026 en las 72 unidades, patio a USD 230/m², una sola lista | **Verificado.** 72 unidades, `usd_m2 = usd_m2_lista`, total USD 11.129.503 (redondeo dentro de la tolerancia) |
| SQL 0007: solo DISPONIBLE, RESERVADO y VENDIDO | **Verificado.** 72 disponibles, restricción `inventory_units_estado_tres` presente, VERIFICAR_DESPLIEGUE sin diferencias |
| Pantallas con tres estados (Inventario, Dashboard, cotización, PDF, reservas, contratos) | **Corregido.** Pendiente de comprobar en la app |

Las reservas de prueba RES-2026-0001 a 0006 siguen en *solicitada* y conservan el precio con el que se cotizaron.

### 14.2 Guía visual del vendedor

Se integró en las pantallas existentes, sin un módulo nuevo:

- **Atender cliente y Financiamiento.** Muestran el recorrido completo en 12 pasos: Cliente, Departamento, Plan de pagos, Cotización, Solicitud de reserva, Pago, Verificación (Finanzas), Aprobación (Gerencia), Contrato (Legal), Cumplimiento, Firma (Legal), y Cobranzas y comisión.
  - Los pasos terminados aparecen en verde y el actual, resaltado. Se indica «Paso N de 12».
- **Botón destacado.** El botón que toca usar se ilumina con un borde y un pulso suave, y aparece «Haz clic aquí para continuar». Aplica a: Registrar nuevo cliente, elegir departamento, Continuar en Financiamiento, Usar este plan, Emitir cotización, Solicitar reserva, Registrar pago y Emitir nueva versión.
- **Esperando a otro rol.** Si el paso es de otro rol, se lee «Esperando a Finanzas» (o Gerencia, Legal o Cumplimiento) y «No necesitas hacer nada ahora».
  - Si quien mira tiene permiso para ese paso, ve el botón destacado que lo lleva a su bandeja.
- **Qué falta y dónde corregirlo.**
  - **Pago rechazado:** muestra el motivo y destaca «Registrar un comprobante nuevo».
  - **Cumplimiento con observaciones:** destaca «Abrir los documentos del cliente».
  - **Monto acordado inválido:** dice qué corregir.
- **Ficha del cliente.** Arriba aparece «Siguiente paso: crear cotización» o «Venta en curso», con el paso en que quedó y el botón destacado para continuar.
  - Se calcula con lo guardado en la base, así que se retoma igual al volver a entrar o desde otro equipo.
  - Se quitó el botón duplicado «Preparar cotización».
- **Seguridad.** La guía solo orienta: cada botón sigue validando permisos y datos en el servidor.
- **Celular.** Los pasos se desplazan horizontalmente en pantallas pequeñas.

### 14.3 Problemas comerciales pendientes del informe anterior

| Problema | Resultado de la revisión | Estado |
|---|---|---|
| Inicio de sesión según el rol | Cada rol ya entraba a su pantalla. **Causa nueva encontrada:** al cerrar sesión, el siguiente usuario volvía a la última pantalla del anterior (por ejemplo, Finanzas caía en Atender cliente). Corregido: al salir se vuelve al inicio, y una pantalla sin permiso lleva a la pantalla de inicio del rol | **Corregido** (prueba automática). Pendiente de comprobar en la app |
| Finanzas y Cumplimiento en Ventas y contratos | Ambos tienen el módulo en su menú y permiso `ventas.ver`. El desvío a Atender cliente era el problema anterior | **Corregido.** Pendiente de comprobar en la app |
| Supervisor ve vendedores y operaciones | Resuelto en 13 (H-19, H-23). En producción falta crear el equipo y asignar al vendedor de prueba (13.4, paso A2) | **Pendiente de comprobar** tras A2 |
| Motivo de rechazo del pago | En Reservas (H-22). Ahora también en la guía de Atender cliente y Financiamiento | **Corregido.** Pendiente de comprobar con RES-2026-0004, que tiene un pago rechazado |
| Programación de actividades futuras | Se guarda bien: nueva prueba automática que programa en la ficha, comprueba la base y vuelve a abrir la sesión. Se limitó el selector a hoy o fechas futuras | **Corregido.** Pendiente de comprobar en la app |

### 14.4 Recorrido completo pendiente en la app

Se usan las cuentas de prueba y registros ficticios. No se confirman ingresos bancarios reales ni se generan firmas con efecto legal. En cada paso se comprueba que la guía destaque la acción correcta y muestre «Esperando a …» cuando le toca a otro rol.

| Paso | Quién | Qué hacer | Qué debe mostrar la guía |
|---|---|---|---|
| 1 | Vendedor de prueba | Clientes → ficha de un cliente ficticio | «Siguiente paso: crear cotización» o «Venta en curso», con el botón destacado |
| 2 | Vendedor de prueba | Atender cliente → departamento → Financiamiento → Usar este plan → Emitir cotización | Cada botón se destaca en orden. Al emitir, 4 pasos en verde y «Solicitar reserva» destacado |
| 3 | Vendedor de prueba | Solicitar reserva | «Registrar pago» destacado |
| 4 | Vendedor de prueba | RES-2026-0004 → Continuar la venta | «Finanzas rechazó el pago», con el motivo. «Registrar un comprobante nuevo» destacado (PDF de prueba) |
| 5 | Vendedor de prueba | Misma operación | «Esperando a Finanzas» |
| 6 | Finanzas de prueba | Iniciar sesión | Entra a Pagos por verificar, no a Atender cliente. Verifica con el estado bancario ficticio |
| 7 | Gerencia | Reservas → aprobar | La unidad pasa a RESERVADO. El vendedor ve «Esperando a Legal» |
| 8 | Admin (como Legal) | Ventas y contratos → generar contrato → enviar a Cumplimiento | El vendedor ve «Esperando a Cumplimiento» |
| 9 | Oficial de prueba | Iniciar sesión → bandeja → observar un documento | Entra a su bandeja. El vendedor ve «Cumplimiento pidió correcciones» y el botón destacado a los documentos |
| 10 | Oficial de prueba | Aprobar | El vendedor ve «Esperando a Legal: formaliza la firma» |
| 11 | Admin (como Legal) | Formalizar con una referencia de prueba (sin firma electrónica) | La unidad pasa a VENDIDO. El vendedor ve «Venta formalizada», con Ver cobranzas y Ver mi comisión |
| 12 | Finanzas de prueba y Admin | Cobranzas → cuota de prueba | Recibo y saldo. La comisión aparece en Comisiones |

Antes del paso 7, conviene anular las reservas de prueba que no se usarán, para que no queden solicitudes con precios anteriores.

## 15. Reservas sin aprobación de Gerencia y guía de cinco etapas (sexta parte)

### 15.1 Reglas que dependían de la aprobación de Gerencia

| Regla actual | Dónde | Cambio |
|---|---|---|
| La unidad pasa a RESERVADO solo al aprobar | `reservas_aprobar` | Con condiciones normales, pasa al verificar el pago (`reservas_verificar_pago`), con la unidad bloqueada (`FOR UPDATE`) |
| El cliente pasa a etapa Reserva y la negociación a «aprobación» al aprobar | `reservas_aprobar` | Se hace en la misma confirmación automática |
| Quien verificó el pago no puede aprobar | `reservas_aprobar` | Se mantiene para las excepciones. En la confirmación automática nadie aprueba: `aprobado_por` queda vacío y la auditoría registra «Confirmar reserva automáticamente» |
| Descuento con autorización registrada, precio igual a la cotización, cotización aceptada y vigente | `reservas_aprobar` | Son las condiciones de una reserva normal. Si alguna falla, la reserva queda como excepción |
| Aviso «Reserva por aprobar» a Gerencia en cada pago verificado | `notif_reservas` | Solo se envía para las excepciones, con el motivo. Nuevo aviso «Reserva confirmada» a Legal (generar contrato) y al vendedor |
| Recordatorio diario de reservas por aprobar | `notificaciones_recordatorios` | Sin cambio: solo quedan las excepciones en ese estado |
| El contrato exige una reserva confirmada | `contratos_crear` | Sin cambio |
| Anular o desistir según el estado | `reservas_anular`, desistimientos | Sin cambio: una reserva confirmada con dinero sigue requiriendo Gerencia y Finanzas |
| Pantallas: «Aprobar», «Pagos verificados · esperan aprobación de gerencia» | Reservas, Cobranzas, Dashboard, Equipo | Ahora dicen «Autorizar excepción» y «Excepciones por autorizar», con el motivo a la vista |

### 15.2 Qué es una reserva normal

El pago debe estar verificado por Finanzas, que no puede ser quien solicitó la reserva, y se deben cumplir todas estas condiciones:
- La unidad está disponible y no tiene otra reserva confirmada.
- La cotización está aceptada y vigente.
- No hay descuento.
- El precio cotizado es el oficial vigente (la lista del 12/11/2026).
- No hay cuotas extraordinarias.
- El precio de la reserva coincide con el de la cotización.

Una reserva normal se confirma sola. Si falla alguna condición, queda como **excepción por autorizar** y Gerencia ve el motivo. Las reservas de prueba RES-2026-0001 a 0006 tienen precios anteriores a la lista nueva: al verificarse quedarán como excepción.

El Supervisor sigue viendo las reservas de su equipo, pero no aprueba nada.

### 15.3 Guía de cinco etapas

La guía de Atender cliente y Financiamiento muestra 5 etapas: **Cliente, Departamento, Cotización, Reserva y Venta**.
- La verificación de Finanzas y la autorización de excepciones ocurren dentro de Reserva.
- El contrato, Cumplimiento, la firma y la cobranza ocurren dentro de Venta.
- La guía solo indica a quién se espera («Esperando a Finanzas», «Esperando a Legal»). Gerencia aparece únicamente cuando hay una excepción.

Cada responsable recibe su tarea en su bandeja: Finanzas en Pagos por verificar, Gerencia en Reservas (solo excepciones), Legal en Ventas y contratos (reservas confirmadas sin contrato) y Cumplimiento en su bandeja.

### 15.4 Estado

| Tema | Estado |
|---|---|
| Código y pruebas automáticas (1034) | **Corregido** |
| SQL `0008_reserva_confirmacion_automatica.sql` | **Pendiente de ejecutar** por el usuario, después de 0007 |
| Recorrido desde la interfaz con las cuentas de prueba | **Pendiente de comprobar** después de 0008 (guion 14.4: el paso 7 de Gerencia desaparece en una reserva normal) |
