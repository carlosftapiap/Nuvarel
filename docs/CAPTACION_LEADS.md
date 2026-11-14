# Captación de leads de AMURA (página web, Facebook e Instagram)

Estado al 13/11/2026:
- **En producción:** la base, el programador cada 5 minutos y las funciones `leads-web` y `leads-meta`.
- **En el repositorio, sin publicar en A2 Hosting:** la nueva interfaz.
- **Listo para instalar en la web:** el conector `integraciones/web/amura-leads.js`.
- **Falta conectar:** el dominio de la web y los accesos de Meta.

## Direcciones de entrada

| Fuente | URL | Respuesta actual |
|---|---|---|
| Página web | `https://sjjjlnqgcaqtkmzdcmog.supabase.co/functions/v1/leads-web` | 403 «Origen no autorizado», hasta habilitar el dominio |
| Facebook e Instagram (webhook) | `https://sjjjlnqgcaqtkmzdcmog.supabase.co/functions/v1/leads-meta` | 503 «Integración con Meta no configurada», hasta cargar los accesos |

## Recorrido de un lead

1. Llega un formulario: de la web (función `leads-web`) o de Meta (función `leads-meta`). La base lo valida con `leads_ingresar`: nombre, celular, correo y consentimiento.
2. **¿Ya es cliente (por celular o correo)?** Entonces:
   - No se crea otro cliente.
   - Se mantiene su vendedor.
   - La consulta queda registrada con su origen y se avisa al vendedor.
3. **Si es nuevo, se asigna por turnos** entre quienes estén disponibles (horario de Ecuador): participan, no están en pausa ni de vacaciones, y es su día y su hora. Recibe quien lleva más turnos sin recibir.
4. **Al asignarse:**
   - Aparece en Clientes como PROSPECTO, en etapa «nuevo».
   - Su próxima acción es «Primer contacto» para ese día.
   - El vendedor recibe un aviso: un contador en «Clientes» y un correo, que queda en cola mientras los correos sigan en modo prueba.
5. **Si nadie está disponible**, queda en la bandeja de pendientes. Se asigna por orden de llegada:
   - al entrar otro lead;
   - al cambiar la configuración;
   - cada 5 minutos (pg_cron).
6. **Primer contacto:** se registra con la primera llamada, mensaje o visita. Asignar no es contactar; abrir WhatsApp tampoco, si el vendedor no confirma que se comunicó.
7. **Sigue el proceso de siempre:** Cliente → Departamento → Cotización y financiamiento → Reserva → Venta. La captación no crea comisiones.

## Dónde se ve

| Quién | Qué ve |
|---|---|
| Administrador | **Configuración → Distribución de leads:** participantes, horario, vacaciones, pausa, bandeja de pendientes, asignación manual y entradas con error. Indicadores del proyecto en el Dashboard. |
| Supervisor | Leads de su equipo y sus ventas propias en el Dashboard de equipo. |
| Vendedor | Sus prospectos por contactar: contador en el menú y lista en el Dashboard. En la ficha, «Contactar por WhatsApp» y el bloque «Captación». |

**Bloque «Captación» de la ficha:**
- Web: fuente, campaña, formulario y página.
- Facebook e Instagram: fuente, campaña y anuncio.

**Indicadores:**
- Leads recibidos, por fuente y por campaña.
- Leads asignados por vendedor y pendientes de contacto.
- Tiempo hasta el primer contacto.
- Conversión a cotización, reserva y venta.

## Página web

- **Conector:** `integraciones/web/amura-leads.js`.
  - Se instala con una etiqueta `<script>`.
  - Conecta los formularios marcados con `data-amura-lead` y el botón de WhatsApp, con captura previa.
  - Muestra la confirmación a la persona.
  - Guarda la página, el formulario y la campaña (UTM) de procedencia.
- **Guía para quien programe la web:** `integraciones/web/README.md`. Ejemplo: `integraciones/web/formulario-leads.html`.
- **Habilitar el dominio:** con los dominios exactos de la web se configura el secreto `LEADS_ORIGENES`, por ejemplo `https://DOMINIO,https://www.DOMINIO`.
- **Consentimiento:** el texto propuesto está en `docs/CONSENTIMIENTO_DATOS_LEADS.md` y falta aprobarlo.
- **Protección:**
  - Campo trampa.
  - Se descartan los envíos hechos en menos de 2,5 segundos.
  - Hasta 5 envíos cada 10 minutos por origen de red.
  - La IP no se guarda: solo un resumen con sal secreta.

## Facebook e Instagram (Meta Lead Ads)

La función `leads-meta` ya está desplegada y espera los accesos. Mientras falten, responde 503 y no procesa nada.

Instagram usa el mismo webhook de la página de Facebook vinculada. AMURA distingue Facebook de Instagram por el campo `platform` del lead.

Con quien administre el portafolio comercial de Meta:

1. **App:** una app de tipo *Business* en developers.facebook.com, del mismo portafolio que la página de Facebook y la cuenta de Instagram de AMURA.
   - Debe estar publicada (modo *Live*): en modo desarrollo, la herramienta de pruebas de Meta no funciona.
2. **Permisos:** `leads_retrieval`, `pages_manage_metadata`, `pages_show_list` y `pages_read_engagement`. Meta puede pedir la verificación del negocio o la revisión de la app.
3. **Acceso a clientes potenciales:** en la configuración del negocio, darle acceso a la app (*Leads Access Manager*).
4. **Token de página** de larga duración, de preferencia de un *usuario del sistema* del portafolio, con esos permisos.
5. **Secretos:** se cargan directamente en Supabase, en *Edge Functions → Secrets*.
   - Nunca van por correo, chat, navegador ni repositorio.
   - Claude solo comprueba que existan, sin ver su valor.

   | Secreto | Valor |
   |---|---|
   | `META_APP_SECRET` | El App Secret de la app. |
   | `META_PAGE_TOKEN` | El token de página. |
   | `META_PAGE_IDS` | El ID de la página o páginas, separados por comas. |
   | `META_VERIFY_TOKEN` | Una frase larga al azar. Se escribe igual en el paso 6. |
   | `META_GRAPH_VERSION` | Opcional; por omisión, `v21.0`. |
6. **Webhook:** en el producto *Webhooks* de la app, con el objeto *Page*:
   - URL de devolución: `https://sjjjlnqgcaqtkmzdcmog.supabase.co/functions/v1/leads-meta`.
   - Token de verificación: el mismo `META_VERIFY_TOKEN`.
   - Suscribir el campo `leadgen`.
   - Suscribir también la app a la página: `POST /{page-id}/subscribed_apps` con `subscribed_fields=leadgen`.
7. **Formularios instantáneos:** cada uno con la URL de la política de privacidad y la casilla de consentimiento (ver el documento de consentimiento).

## Verificación de cada fuente

**Antes de probar:**
- Hacer un respaldo lógico (`node scripts/respaldo-logico.mjs`).
- Tener al menos un vendedor habilitado y en horario en Configuración → Distribución de leads.

| Fuente | Prueba | Resultado esperado en AMURA |
|---|---|---|
| Base de datos | `supabase/sql_produccion/verificacion/verificar_captacion_leads.sql` en el SQL Editor | Rotación, duplicado, pendiente y primer contacto correctos. No deja datos. |
| Web · cada formulario | Una persona del equipo lo envía con su celular | Confirmación en la web. En Clientes, un prospecto en etapa «nuevo» con:<br>• origen «Página web», formulario, página y campaña;<br>• vendedor asignado y aviso en su menú;<br>• próxima acción «Primer contacto». |
| Web · botón de WhatsApp | La misma persona usa el botón | Se abre el chat de AMURA. Como su celular ya existe, no se crea otro cliente: queda una nueva consulta, con el mismo vendedor. |
| Web · sin vendedores | Un envío fuera del horario configurado | Queda en la bandeja de pendientes. Se asigna al iniciar el horario (revisión cada 5 minutos) o con «Asignar a…». |
| Facebook · conexión | Herramienta de pruebas de Lead Ads de Meta | Si el lead trae los datos de relleno de Meta, llega a «Entradas que no se pudieron registrar» como «Lead de prueba de Meta: la conexión funciona». No crea cliente. |
| Facebook e Instagram · recorrido completo | Una persona del equipo llena el formulario real de cada anuncio | Prospecto con origen Facebook o Instagram, campaña y anuncio, y vendedor asignado. |
| Pipeline | El vendedor registra la llamada o el mensaje | Queda el primer contacto. El prospecto sigue a cotización, reserva y venta como cualquier cliente. |

**Después de las pruebas:** los prospectos de prueba se eliminan con un SQL numerado, con respaldo previo y con autorización.

## Operación y reversión

**SQL de producción:**
- `0013_captacion_leads.sql`: la base.
- `0014_programar_leads_pendientes.sql`: el programador cada 5 minutos.
- `verificacion/verificar_captacion_leads.sql`: verificación sin dejar datos.

**Detener la asignación automática:**
- Desmarcar «Recibe leads» a todos en Configuración.
- Quitar el programador: `select cron.unschedule('amura-leads-pendientes');`

**Detener las entradas:** borrar la función `leads-web` o `leads-meta` en Supabase. Las tablas y los datos se conservan.
