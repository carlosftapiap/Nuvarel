# Promesa de compraventa AMURA: borrador para revisión jurídica

**Para:** el abogado de AMURA (Legal).
**Estado:** borrador. No es una plantilla aprobada. La aplicación no deja emitir una promesa con ella hasta que Legal la apruebe en Ventas > Plantillas.
**Archivo de la plantilla:** `supabase/plantillas/promesa_compraventa_AMURA_borrador.txt` (formato texto de la aplicación).

## 1. Qué es y qué no es

- Es una **estructura** de promesa de compraventa de un departamento en proyecto, con los datos comerciales y financieros que el sistema ya valida.
- **No** contiene cláusulas copiadas de otras empresas. Todo lo que depende de una decisión jurídica quedó como **dato legal** para que usted lo redacte o lo apruebe.
- **No** asume quién es la parte vendedora. Los datos salen de la «Entidad vendedora» que se configura en la aplicación. NUVAREL S.A.S. figura solo si se confirma y se registra como parte contractual o como representante facultado.

## 2. Fuentes consultadas y límites

- **Minuta de García & Asociados** (enlace indicado): el archivo PDF no estaba disponible (error 404). No se usó.
- **Ecuador Legal Online, minuta de promesa de compraventa:** la página solo muestra la lista resumida de cláusulas típicas, que se usó como guía de estructura. El modelo completo requiere descarga y no se consultó.
- **Código Civil, artículo 1570:** no se pudo obtener el texto oficial. La plantilla no cita el artículo. Antes de aprobarla, conviene verificar los requisitos de validez de la promesa, en especial si debe otorgarse por escritura pública (dato legal `formalizacion_notarial`).

## 3. Estructura

1. Comparecientes y facultades de representación.
2. Antecedentes: dominio del terreno, proyecto, permisos, propiedad horizontal y reserva pagada.
3. Objeto: departamento, edificio, piso, tipología, áreas, bodega, parqueo, linderos y alícuota.
4. Precio final aprobado (en número y en letras).
5. Forma de pago:
   - Entrada total del 20 %: 6 % inicial, que incluye la reserva y el pago a la firma, más 14 % en cuotas durante la construcción.
   - Saldo del 80 % previsto con crédito hipotecario, sujeto a aprobación.
   - Pagos solo en cuentas oficiales; pagos anticipados; mora.
6. Origen lícito de los fondos y pagos de terceros.
7. Construcción y entrega.
8. Plazo y condiciones de la escritura definitiva.
9. Obligaciones de la parte vendedora.
10. Obligaciones del comprador.
11. Incumplimiento, cláusula penal, desistimiento y devoluciones.
12. Gastos e impuestos.
13. Controversias.
14. Notificaciones.
15. Formalización y aceptación.
- Firmas: las agrega la aplicación para todos los compradores y apoderados.
- Anexo 1: cronograma de pagos, generado automáticamente.

## 4. Datos que llena el sistema

Salen de Clientes, Cotizaciones, Reservas, Inventario y Financiamiento, con el calendario de cuotas de cada edificio, que no cambia:

- **Parte vendedora:** razón social, RUC, domicilio y representante.
- **Comprador o compradores:** nombre, documento, nacionalidad, estado civil y domicilio.
- **Departamento:** número, edificio, piso, tipología, áreas, bodega y parqueo.
- **Pagos:** precio, reserva, pago a la firma, 6 % inicial, cuotas del 14 %, entrada del 20 % y saldo del 80 %, cada monto también en letras.
- **Anexo 1:** el cronograma completo.

Ejemplo verificado con A103 (precio USD 119.729), en prueba automática:

| Concepto | Monto (USD) |
|---|---|
| Reserva | 500,00 |
| Pago a la firma | 6.683,74 |
| Pago inicial (6 %) | 7.183,74 |
| Cuotas (14 %) | 16.762,06 |
| Entrada total (20 %) | 23.945,80 |
| Saldo por crédito hipotecario (80 %) | 95.783,20 |

## 5. Datos legales que usted debe redactar o aprobar

Se completan en cada promesa o se fijan en la plantilla aprobada:

| Campo | Contenido esperado |
|---|---|
| `lugar_firma` | Ciudad de suscripción |
| `comparecencia_adicional` | Cónyuge, apoderados u otros comparecientes, si aplica |
| `antecedente_dominio` | Título de propiedad del terreno: escritura, notaría, fecha e inscripción |
| `antecedente_proyecto` | Descripción jurídica del proyecto y del promotor o constructor, si son distintos de la vendedora |
| `antecedente_permisos` | Licencia de construcción y aprobación de planos |
| `antecedente_propiedad_horizontal` | Estado de la declaratoria y compromiso de obtenerla |
| `linderos_alicuota` | Linderos y alícuota según la declaratoria |
| `condicion_credito` | Qué pasa si el banco niega el crédito: plazo, alternativas y efectos |
| `condicion_mora` | Interés o recargo por atraso, si se pacta |
| `fecha_entrega_estimada` / `plazo_gracia_entrega` | Fecha prevista de entrega y prórrogas admisibles |
| `condicion_cambios_obra` | Cambios técnicos admitidos durante la construcción |
| `plazo_escritura` / `notaria` | Plazo y notaría de la escritura definitiva |
| `obligaciones_vendedora_adicionales` / `obligaciones_comprador_adicionales` | Obligaciones adicionales, si las hay |
| `clausula_penal` | Monto o porcentaje y su aplicación |
| `condicion_desistimiento` / `condicion_devoluciones` | Desistimiento y devoluciones: plazos, descuentos y forma de pago. La aplicación no hace devoluciones automáticas |
| `condicion_incumplimiento_vendedora` | Efectos del incumplimiento de la parte vendedora |
| `reparto_gastos` | Gastos notariales, registro, plusvalía, alcabala y otros, según la ley |
| `solucion_controversias` | Mediación, arbitraje o jueces competentes |
| `formalizacion_notarial` | Si la promesa se otorga por escritura pública o con reconocimiento de firmas |

## 6. Cómo se usa en la aplicación

1. Legal carga el texto en Ventas > Plantillas como **promesa de compraventa** y la guarda en borrador.
2. Usted la revisa, la ajusta y la **aprueba**. Sin esa aprobación, la emisión queda bloqueada; la prueba A103 lo comprueba.
3. Con la reserva confirmada, Legal prepara el contrato de la operación y genera la promesa. El sistema arma el PDF con los datos validados y guarda la versión.
4. Estados del documento:
   - **Borrador:** versión generada en revisión.
   - **Pendiente de firma:** emitida.
   - **Firmado:** se adjunta el documento firmado y se valida.
   - Cada paso queda en el historial con fecha, usuario y motivo.
5. El cronograma de la promesa es el mismo que usa Cobranzas. Las cuotas solo se vuelven exigibles con la formalización.

## 7. Decisiones pendientes de Legal

- Confirmar la parte vendedora y sus facultades (no se asume NUVAREL S.A.S.).
- Redactar o aprobar los datos legales de la sección 5.
- Verificar la forma de la promesa según el Código Civil vigente.
- Aprobar la plantilla en la aplicación.
