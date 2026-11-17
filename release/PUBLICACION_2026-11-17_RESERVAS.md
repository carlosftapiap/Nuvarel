# Publicación AMURA · 2026-11-17 · Reservas con Cumplimiento

**Estado:** preparada, **no publicada**. Requiere la autorización expresa del administrador.

**Paquete:** `release/sistema-gestion-inmobiliaria-a2hosting-2026-11-17-reservas.zip`
- 169 archivos. Rutas con `/`, aptas para el extractor de cPanel. `.htaccess` e `index.html` en la raíz.
- SHA-256: `C24FB45AE1857D5B88CA806D50CBFD986A66803BAF6A915B76545DC92E67FD10`
- Proyecto Supabase del paquete: `sjjjlnqgcaqtkmzdcmog` (producción). Sin claves privadas ni archivos `.env`.
- Código: último commit `56cfecc` más cambios locales **sin commit**. Antes de publicar conviene guardarlos en un commit, para saber exactamente qué se publicó y poder volver a esa versión.

## 1. Módulos incluidos

| Módulo | Qué cambia para el usuario |
|---|---|
| Cumplimiento y reservas | La bandeja de Cumplimiento muestra las solicitudes de reserva para aprobar, observar o rechazar, junto a los documentos del cliente. El vendedor registra al pagador junto con el comprobante, con la cédula del cliente prellenada. Finanzas ve «Espera a Cumplimiento» y no puede confirmar hasta la aprobación. |
| Cobros | Configuración muestra las cuentas bancarias oficiales (no acepta cuentas personales). Pagos por verificar avisa de posibles pagos duplicados. |
| Planos | Carga directa con reemplazo confirmado y eliminación. Ya estaba en la base (0022). |
| Inicio de vendedores y supervisores | El mapa por edificio aparece arriba al ingresar. |
| Promesa de compraventa | Usa el módulo existente de Documentos contractuales. La emisión sigue bloqueada hasta que Legal apruebe una plantilla. No se publica ninguna plantilla. |

## 2. Compatibilidad con producción (verificada en solo lectura, 2026-11-17)

- Las **166 funciones** y las **67 tablas** que usa la app nueva existen en producción.
- Las funciones de Cumplimiento (0023) y de cuentas receptoras (0024) tienen huellas idénticas al repositorio.
- **No requiere migraciones adicionales.** La 0025 (retira una función antigua de Planos) y la 0026 (campos del catálogo de la promesa) son independientes y se revisan después; la app funciona sin ellas.

## 3. Permisos en producción (solo lectura)

| Permiso | Perfiles |
|---|---|
| Revisar Cumplimiento | Administrador, Oficial de Cumplimiento |
| Solicitar reserva | Vendedor, Supervisor, Corredor, Gerencia, Administrador |
| Verificar pago de reserva | Finanzas, Administrador |
| Prórroga por observación | Supervisor, Administrador |
| Cuentas de cobro | Administrador |

- Ningún usuario tiene excepciones individuales.
- Separación de funciones: quien solicita no revisa ni verifica. Quien aprueba Cumplimiento no verifica el pago. Un administrador tampoco puede saltarse la aprobación.

## 4. Pruebas

- **Suite completa:** 124 archivos y 1278 pruebas aprobadas. Revisión de tipos sin errores. Compilación de producción correcta.
- **Recorrido completo de A103** (base local aislada, datos ficticios, precio de referencia USD 119.729):
  1. Cotización aceptada y orden de contrato.
  2. Solicitud de reserva de USD 500, registro del pagador y del comprobante.
  3. Finanzas bloqueada sin Cumplimiento.
  4. Aprobación del Oficial.
  5. Verificación de Finanzas.
  6. Departamento reservado.
  7. Contrato con cronograma: 6 % + 14 % + 80 % = precio.
  8. Cuotas no exigibles antes de la firma.
  9. Promesa bloqueada sin plantilla aprobada.
- **Reglas de Cumplimiento** (12 pruebas): permisos, observación y reenvío, prórroga única, rechazo con comprobantes conservados, liberación automática, cambio de precio bloqueado.
- **Pantallas** (pruebas automáticas): bandeja de Cumplimiento, Pagos por verificar, Reservas, Cobranzas, comprobantes y la decisión de Cumplimiento.
- **Pendiente:** revisión visual en navegador y celular. No hubo un navegador disponible en esta sesión, y la app requiere iniciar sesión con usuarios reales. Hay que hacerla tras publicar (sección 6).

## 5. Tarea automática de 48 horas: recomendación

La tarea `reservas-liberar-apartados` (todos los días, 05:15) anula las solicitudes vencidas solo si **no** tienen comprobantes reportados ni confirmados. No considera otras situaciones pendientes:
- un comprobante **rechazado** por Finanzas que el cliente debe corregir;
- **documentos del cliente esperando revisión** de Cumplimiento.

**Recomendación:** pausarla antes de publicar y reactivarla cuando se acuerde la regla.

| Paso | Archivo |
|---|---|
| Revisar qué liberaría hoy (solo lectura) | `supabase/sql_produccion/operacion/revisar_liberacion_apartados.sql` |
| Pausar | `supabase/sql_produccion/operacion/pausar_liberacion_apartados.sql` |
| Reanudar | `supabase/sql_produccion/operacion/reanudar_liberacion_apartados.sql` |

- La pausa solo desactiva la tarea con `cron.alter_job(active := false)`. No la borra ni cambia reservas.
- Hoy no hay solicitudes vencidas.

## 6. Cómo publicar (cuando se autorice)

1. **Pausar la tarea** con `pausar_liberacion_apartados.sql`. Confirmar que devuelve `active = false`.
2. **Respaldar lo publicado:** en cPanel → File Manager → carpeta raíz del sitio → seleccionar todo → Compress, y descargar ese ZIP. **Es el respaldo para revertir.**
3. Retirar el contenido anterior. Conservar `cgi-bin` y `.well-known`.
4. Subir `sistema-gestion-inmobiliaria-a2hosting-2026-11-17-reservas.zip` y extraerlo en esa carpeta. `index.html`, `.htaccess` y `assets/` deben quedar en la raíz. Borrar el ZIP del servidor.
5. Recargar el navegador sin caché (Ctrl+F5).
6. **Comprobación con usuarios reales**, en computadora y celular. No usar datos de clientes reales para probar sin acordarlo antes.

| Usuario | Comprobación |
|---|---|
| Vendedor | Ingresa, ve el mapa por edificio, abre «Registrar pago» de una reserva y ve la sección «Quién hizo el pago» |
| Oficial | Bandeja de Cumplimiento → pestaña «Por revisar» muestra la sección de reservas (vacía si no hay) |
| Finanzas | Pagos por verificar abre sin errores |
| Administrador | Configuración → Cobros muestra «Cuentas bancarias oficiales». Configuración → Planos abre |

## 7. Cómo revertir si algo falla

1. En cPanel, retirar el contenido nuevo y extraer el ZIP de respaldo del paso 2.
2. **La base no cambia con esta publicación:** no hay nada que revertir en Supabase.
3. Dejar **pausada** la tarea de 48 horas. La app anterior no tiene las pantallas de Cumplimiento, así que con ella no se pueden verificar reservas nuevas.

**Aviso:** no usar como respaldo el ZIP del 11/11 (`…-2026-11-11-fase1.zip`). Tiene 146 rutas con barra invertida (`\`) y en un servidor Linux puede extraerse mal. El respaldo confiable es la copia descargada del servidor (paso 2).

## 8. Lo que esta publicación no hace

- No ejecuta los SQL 0025 ni 0026.
- No elimina el plano pendiente.
- No altera reservas existentes.
- No emite promesas.
- No envía correos reales: siguen en modo prueba.
