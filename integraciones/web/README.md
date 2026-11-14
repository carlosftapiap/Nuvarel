# Conectar la página web de AMURA con AMURA

Para quien construye o mantiene la página web de AMURA.

Con un script, cada formulario de contacto o de solicitud de información y el botón de WhatsApp registran a la persona en AMURA como prospecto, con un vendedor asignado.

## Qué pasa con cada envío

1. La persona llena el formulario y marca la casilla de consentimiento.
2. AMURA valida los datos y registra el prospecto en Clientes. Guarda el origen «Página web», el formulario, la página y la campaña (UTM).
3. El prospecto se asigna por turnos a un vendedor disponible. Si no hay nadie disponible, queda en la bandeja de pendientes hasta que alguien lo esté.
4. Si el celular o el correo ya pertenecen a un cliente, no se crea otro: la consulta se registra y se avisa a su vendedor.
5. La persona ve la confirmación en la misma página, o en la página de agradecimiento si se configura.

## Instalación

1. Copia `amura-leads.js` en la web, por ejemplo en `/js/amura-leads.js`.
2. Agrega esta etiqueta en todas las páginas, en el `<head>` o antes de `</body>`:

   ```html
   <script src="/js/amura-leads.js" defer
     data-whatsapp="5939XXXXXXXX"
     data-politica="https://DOMINIO/politica-de-privacidad"
     data-responsable="RAZÓN SOCIAL"
     data-correo-datos="CORREO DE PROTECCIÓN DE DATOS"
     data-version="v1-2026-11"></script>
   ```

   | Atributo | Qué es |
   |---|---|
   | `data-whatsapp` | WhatsApp de AMURA en formato internacional, sin `+` (593…). |
   | `data-politica` | URL pública de la política de privacidad. |
   | `data-responsable`, `data-correo-datos` | Razón social y correo de protección de datos, del texto de consentimiento aprobado. |
   | `data-version` | Versión del texto de consentimiento aprobado. |
   | `data-gracias` | Opcional: página de agradecimiento después de enviar. |

3. Marca cada formulario con `data-amura-lead` y un nombre corto. Ese nombre aparece en AMURA:

   ```html
   <form data-amura-lead="contacto">…</form>
   <form data-amura-lead="solicitud-de-informacion">…</form>
   ```

   Si el constructor de la web no permite atributos en el formulario, usa la clase `amura-lead`, en el formulario o en el bloque que lo contiene.

4. Envía al administrador de AMURA los dominios exactos de la web, con y sin `www`. Hasta que los habilite, AMURA rechaza los envíos («Origen no autorizado»).

## Campos

AMURA reconoce los campos por su nombre o su etiqueta: «Nombre», «Celular» o «Teléfono», «Correo», «Mensaje», «Departamento» y «Presupuesto». Para asegurarlo, usa estos nombres o pon el atributo `data-amura-campo="…"` en el campo:

| Campo | `name` | Obligatorio |
|---|---|---|
| Nombre completo, o «Nombres» y «Apellidos» | `nombre` y `apellido` | Sí |
| Celular | `celular` | Sí: 09XXXXXXXX, o con `+` y el código del país |
| Correo | `email` | No |
| Mensaje | `mensaje` | No |
| Departamento de interés | `unidad` | No |
| Presupuesto | `presupuesto` | No |

- **Otras preguntas:** se agregan al mensaje, con su etiqueta.
- **Consentimiento:** si el formulario no tiene casilla, el conector la agrega sin marcar, con el texto aprobado. Si la web usa su propia casilla, debe llevar ese mismo texto.
- **Campo contra robots:** el conector agrega uno invisible. No lo quites.
- **Confirmación:** aparece junto al botón. Para ponerla en otro lugar, agrega `<div data-amura-estado></div>` dentro del formulario.
- **Envío original:** el conector reemplaza el envío propio del formulario, como un correo o el envío a otro sistema.

## Botón de WhatsApp

- **Captura previa:** todo enlace a `wa.me` o `api.whatsapp.com` abre primero una ventana corta con nombre, celular y consentimiento.
  - Al confirmar, AMURA registra al prospecto y se abre el chat de AMURA con un mensaje escrito.
  - Si AMURA no responde, la persona igual puede continuar a WhatsApp.
- **Si el constructor solo permite un enlace:** usa `#amura-whatsapp`. Desde código: `AmuraLeads.abrirWhatsApp()`.
- **Enlace sin captura:** agrégale `data-amura-sin-captura`.
- **Botones flotantes de complementos:** si abren WhatsApp con su propio código, no se pueden interceptar. Reemplázalos por un enlace.

## Campañas y analítica

- Enlaza los anuncios con parámetros UTM, por ejemplo `https://DOMINIO/?utm_source=google&utm_medium=cpc&utm_campaign=lanzamiento`.
- La campaña se conserva durante la visita, aunque la persona cambie de página antes de escribir.
- Después de cada registro, el conector emite el evento `amura:lead`:

  ```js
  document.addEventListener('amura:lead', function (e) { /* e.detail.formulario; p. ej. fbq('track', 'Lead') */ });
  ```

## Compatibilidad

- **Funciona con:** formularios HTML propios, WordPress (Elementor, Contact Form 7, WPForms), Webflow y otros constructores que permitan agregar un script.
- **No funciona con formularios dentro de un iframe de otro servicio:** Google Forms, Typeform o los formularios de Wix. Hay que reemplazarlos por un formulario HTML.

## Probar

`formulario-leads.html` es un ejemplo con un formulario de contacto, una solicitud de información y el botón de WhatsApp.

Cada envío real crea un prospecto en AMURA. Coordina las pruebas con el administrador de AMURA y usa datos reales de alguien del equipo. Por cada formulario:

1. Envíalo con el celular de la persona de prueba.
2. Debe aparecer la confirmación.
3. En AMURA, Clientes muestra el prospecto con el origen «Página web», el formulario, la página y el vendedor asignado.

Desde el disco (`file://`) o desde un dominio no habilitado, AMURA responde «Origen no autorizado».
