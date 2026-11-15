# Nomenclatura comercial de AMURA

Estado al 15/11/2026: implementación en el repositorio; SQL 0016 PENDIENTE de ejecución manual. El 0015 es un antecedente incorporado íntegramente en 0016: no ejecutarlo por separado. No se ha publicado en A2 Hosting como parte de este cambio.

## Identidad de las unidades

`inventory_units.codigo` conserva la clave técnica (por ejemplo `E1-PB-A1`). Las siete relaciones existentes no se renumeran. `dpt` es el número comercial canónico de Supabase; `dpt_anterior` conserva la equivalencia anterior mediante una columna generada y única. `edificio` sigue siendo 1/2 para precios y cuotas; su nombre comercial es A/B.

Las equivalencias nunca crean unidades. Excel, enlaces y búsquedas aceptan el número comercial, el anterior y la clave técnica; dos alias de la misma unidad son un duplicado de importación. Las RPC y la asignación de leads normalizan a la clave técnica.

## Documentos existentes y nuevos

- Los PDF, Word y documentos firmados contractuales se descargan desde su ruta original y se comprueba su hash. No se reescriben instantáneas ni plantillas aprobadas.
- Las cotizaciones, simulaciones y recibos nuevos reciben `unidad_snapshot` desde un trigger del servidor. La constancia guarda `constancia_snapshot` con comprador, emisor, unidad, datos bancarios y estado de emisión.
- Las instantáneas no pueden sustituirse por UPDATE ni rellenarse retrospectivamente con Inventario actual. Tampoco puede reemplazarse un PDF de recibo registrado.
- Un recibo con archivo se descarga íntegro incluso anulado. Su estado y motivo se consultan en pantalla; no se produce otro PDF con el mismo número utilizando datos nuevos.
- Si el histórico no tiene instantánea ni archivo original, la aplicación pide conservar el original y emitir una nueva versión para actualizarlo. No inventa los datos originales a partir de una fecha o del inventario actual.
- Las cotizaciones locales anteriores que incluyen los datos de unidad conservan el número y nombre del edificio de esa instantánea.
- Los estados de cuenta, exportaciones y reportes generados ahora son documentos nuevos de consulta con sus datos y fecha de corte vigentes. Los archivos descargados anteriormente no se modifican.
- Los modelos Word con nombres fijos anteriores requieren una nueva versión revisada por Legal; no se sustituyen textos en documentos firmados ni plantillas históricas.

## Ejecución manual en producción

1. Detener las operaciones y conservar la versión publicada. Crear un respaldo externo reciente de esquema, datos y Storage; verificar su restauración y conservar hashes de originales. Los respaldos internos de las migraciones no sustituyen ese respaldo.
2. Ejecutar `supabase/sql_produccion/verificacion/verificar_nomenclatura_comercial.sql` y conservar el resultado. Confirmar 72 unidades, distribución 30/42 y siete FK. Revisar plantillas y archivos históricos externos a Storage.
3. Ejecutar únicamente `0016_nomenclatura_documentos_seguros.sql` completo. Incorpora 0015 y la protección documental en una sola transacción, evitando cualquier estado intermedio. Si 0015 ya se hubiera aplicado, también es compatible. Si falla, no continuar ni publicar. No ejecutar fragmentos.
4. Comparar el control de 0015 antes/después y ejecutar `verificacion/verificar_nomenclatura_documentos.sql` y `VERIFICAR_DESPLIEGUE.sql`. Deben conservarse los campos anteriores de Inventario y las siete FK. Los históricos con snapshot nulo son intencionales: nunca rellenarlos para habilitar una descarga.
5. El usuario comunica los resultados; solo entonces se actualiza `CONTROL_EJECUCION.md`. Publicar la aplicación y las Edge Functions requiere autorización. Los correos mantienen `CORREO_PRUEBA_DESTINO`.
6. Comprobar búsquedas nuevas/anteriores, mapa A/B, flujos por perfil, Excel y documentos. No crear operaciones ficticias en producción: usar el entorno de pruebas o datos reales autorizados.

`cobranza-diaria` queda preparada para consultar los números canónicos al generar avisos; no se desplegó como parte de este cambio. Las colas anteriores no se reescriben. Meta puede enviar `unidad`, `departamento` o `codigo_de_departamento`; el servidor resuelve el código conservando el payload original.

## Recuperación

Antes de emitir documentos nuevos se puede ejecutar, con operaciones detenidas y respaldo verificado, `reversion/0016_revertir_nomenclatura_documentos.sql` y luego `reversion/0015_revertir_nomenclatura_comercial.sql`. Se restauran definiciones y textos exactos respaldados. Si un texto fue editado después, la reversión aborta para no sobrescribirlo. Las columnas, instantáneas y protecciones aditivas no se eliminan.

Después de emitir documentos nuevos ambas reversiones se bloquean. Se requiere una corrección compatible hacia adelante: conservar códigos, snapshots, archivos, hashes y relaciones. No restaurar un backup completo sobre operaciones posteriores ni desplegar un generador antiguo que ignore las instantáneas.

## Mapeo aprobado

| Clave técnica conservada | Número anterior | Número comercial |
|---|---|---|
| E1-PB-A1 | 1001 | A001 |
| E1-PB-A2 | 1002 | A002 |
| E1-PB-A3 | 1003 | A003 |
| E1-PB-A4 | 1004 | A004 |
| E1-PB-A5 | 1005 | A005 |
| E1-P1-A1 | 1101 | A101 |
| E1-P1-A2 | 1102 | A102 |
| E1-P1-A3 | 1103 | A103 |
| E1-P1-A4 | 1104 | A104 |
| E1-P1-A5 | 1105 | A105 |
| E1-P2-A1 | 1201 | A201 |
| E1-P2-A2 | 1202 | A202 |
| E1-P2-A3 | 1203 | A203 |
| E1-P2-A4 | 1204 | A204 |
| E1-P2-A5 | 1205 | A205 |
| E1-P3-A1 | 1301 | A301 |
| E1-P3-A2 | 1302 | A302 |
| E1-P3-A3 | 1303 | A303 |
| E1-P3-A4 | 1304 | A304 |
| E1-P3-A5 | 1305 | A305 |
| E1-P4-A1 | 1401 | A401 |
| E1-P4-A2 | 1402 | A402 |
| E1-P4-A3 | 1403 | A403 |
| E1-P4-A4 | 1404 | A404 |
| E1-P4-A5 | 1405 | A405 |
| E1-P5-A1 | 1501 | A501 |
| E1-P5-A2 | 1502 | A502 |
| E1-P5-A3 | 1503 | A503 |
| E1-P5-A4 | 1504 | A504 |
| E1-P5-A5 | 1505 | A505 |
| E2-PB-A1 | 2001 | B001 |
| E2-PB-A2 | 2002 | B002 |
| E2-PB-A3 | 2003 | B003 |
| E2-PB-A4 | 2004 | B004 |
| E2-PB-A5 | 2005 | B005 |
| E2-PB-A6 | 2006 | B006 |
| E2-PB-A7 | 2007 | B007 |
| E2-P1-A1 | 2101 | B101 |
| E2-P1-A2 | 2102 | B102 |
| E2-P1-A3 | 2103 | B103 |
| E2-P1-A4 | 2104 | B104 |
| E2-P1-A5 | 2105 | B105 |
| E2-P1-A6 | 2106 | B106 |
| E2-P1-A7 | 2107 | B107 |
| E2-P2-A1 | 2201 | B201 |
| E2-P2-A2 | 2202 | B202 |
| E2-P2-A3 | 2203 | B203 |
| E2-P2-A4 | 2204 | B204 |
| E2-P2-A5 | 2205 | B205 |
| E2-P2-A6 | 2206 | B206 |
| E2-P2-A7 | 2207 | B207 |
| E2-P3-A1 | 2301 | B301 |
| E2-P3-A2 | 2302 | B302 |
| E2-P3-A3 | 2303 | B303 |
| E2-P3-A4 | 2304 | B304 |
| E2-P3-A5 | 2305 | B305 |
| E2-P3-A6 | 2306 | B306 |
| E2-P3-A7 | 2307 | B307 |
| E2-P4-A1 | 2401 | B401 |
| E2-P4-A2 | 2402 | B402 |
| E2-P4-A3 | 2403 | B403 |
| E2-P4-A4 | 2404 | B404 |
| E2-P4-A5 | 2405 | B405 |
| E2-P4-A6 | 2406 | B406 |
| E2-P4-A7 | 2407 | B407 |
| E2-P5-A1 | 2501 | B501 |
| E2-P5-A2 | 2502 | B502 |
| E2-P5-A3 | 2503 | B503 |
| E2-P5-A4 | 2504 | B504 |
| E2-P5-A5 | 2505 | B505 |
| E2-P5-A6 | 2506 | B506 |
| E2-P5-A7 | 2507 | B507 |
