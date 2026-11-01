# Publicar AMURA en A2 Hosting

**Paquete:** `sistema-gestion-inmobiliaria-a2hosting-2026-11-01-v2.zip`

**Dirección prevista:** `https://carlostapiapro.amura.com`

El paquete no lleva el dominio escrito: funciona en cualquier dominio o subdominio, siempre que se instale en su carpeta raíz y no en una subcarpeta.

## Orden recomendado
1. Sección 1: dominio y SSL.
2. Secciones 4 y 5: Supabase Auth y funciones.
3. Secciones 2 y 3: subir y extraer el ZIP.
4. Sección 6: comprobar.

## 1. Dominio y SSL

**Antes de empezar:** el 01/11/2026, `carlostapiapro.amura.com` no existía en DNS. Ese subdominio solo se puede crear si administras `amura.com`. Si no es tu dominio, usa uno que sí administres, por ejemplo un subdominio de `carlostapiapro.com`, y emplea esa dirección en todos los pasos siguientes.

1. Entra a cPanel → **Domains** y crea el subdominio.
2. Anota su **carpeta raíz** (Document Root). El ZIP se extrae ahí.
3. Espera a que el subdominio abra en el navegador. Puede tardar unas horas.
4. Ve a cPanel → **SSL/TLS Status**, selecciona el subdominio y pulsa **Run AutoSSL**.
5. Espera a que el certificado aparezca como activo. El paquete obliga a usar HTTPS, así que sin certificado la página no abrirá.

## 2. Dónde subir el ZIP
1. Entra a cPanel → **File Manager** y abre la carpeta raíz del subdominio.
2. En **Settings**, activa **Show Hidden Files**, para poder ver `.htaccess`.
3. Si la carpeta ya tiene contenido, descarga una copia y retira lo anterior. Conserva `cgi-bin` y `.well-known`.
4. Pulsa **Upload** y sube el ZIP a esa carpeta.

## 3. Cómo extraerlo
1. Haz clic derecho sobre el ZIP → **Extract** y deja como destino esa misma carpeta.
2. Comprueba que `index.html`, `.htaccess`, `assets`, `brand`, `fonts` y `media` quedaron directamente en la carpeta raíz, no dentro de otra carpeta.
3. Borra el ZIP del servidor.

No subas archivos `.env` ni la carpeta `docs/`: el hosting no los necesita.

## 4. Qué configurar en Supabase Auth

En Supabase → **Authentication**:

| Lugar | Qué hacer |
|---|---|
| **Sign In / Providers** | Desactiva **Allow new users to sign up**. Es obligatorio: hoy el registro público sigue activo. |
| **URL Configuration → Site URL** | `https://carlostapiapro.amura.com` |
| **URL Configuration → Redirect URLs** | `https://carlostapiapro.amura.com/login` |
| **Emails → SMTP Settings** | Configura un servidor de correo propio. El correo incluido en Supabase tiene un límite bajo de envíos, y de él dependen los enlaces de contraseña. |

## 5. Funciones y secretos de Supabase

Las claves secretas se guardan solo en Supabase, nunca en el hosting ni en este paquete. Hoy **ninguna de las dos funciones está desplegada**.

Ejecuta esto en la raíz del repositorio, en tu computadora:

```powershell
npx supabase login
npx supabase secrets set APP_ORIGIN=https://carlostapiapro.amura.com --project-ref sjjjlnqgcaqtkmzdcmog
npx supabase functions deploy crear-usuario --project-ref sjjjlnqgcaqtkmzdcmog
```

Sin `crear-usuario`, el botón «Crear usuario» no funciona.

### Cobranza diaria

```powershell
npx supabase secrets set CRON_SECRET=<valor largo generado por ti> --project-ref sjjjlnqgcaqtkmzdcmog
npx supabase functions deploy cobranza-diaria --no-verify-jwt --project-ref sjjjlnqgcaqtkmzdcmog
```

La opción `--no-verify-jwt` es necesaria porque la tarea programada se identifica con `CRON_SECRET`, y la función comprueba ese secreto.

La programación diaria (`pg_cron` y `pg_net`) está en `supabase/instalacion/COBRANZA.md`, sección 3.

### Correos de cobranza

Sin estos secretos, las alertas se guardan como pendientes y no se envían:

| Secreto | Valor |
|---|---|
| `COBRANZA_ENVIO_REAL` | `true` |
| `COBRANZA_REMITENTE` | Una dirección de un dominio verificado en Resend |
| `RESEND_API_KEY` | Una clave nueva creada en Resend |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` las entrega Supabase a las funciones; no hay que configurarlas.

## 6. Cómo comprobar que funciona

**Página y rutas**
1. Abre `https://carlostapiapro.amura.com/inventario` sin iniciar sesión: debe llevarte a **Iniciar sesión**, con la foto de las torres.
2. Abre `http://carlostapiapro.amura.com`: debe cambiar sola a `https://`.
3. Abre `/.htaccess` y `/assets/no-existe.js`: deben responder 403 y 404, sin mostrar la aplicación.
4. Entra con tu usuario administrador y comprueba que aparece el Dashboard.
5. Abre `/cobranzas` y `/configuracion`, y recarga el navegador en cada una: debe seguir la misma página, sin error 404.

**Recursos**
6. En **Atender cliente**, reproduce el video de la presentación y revisa las fotos.
7. En Cotizaciones, descarga un PDF y confirma que aparece el logotipo.
8. Repite el inicio de sesión y una pantalla desde un celular.

**Usuarios**
9. En **Configuración → Usuarios**, crea un usuario del rol Finanzas con un correo real. Debe recibir el enlace y poder crear su contraseña.
10. Sal de tu cuenta y usa **¿Olvidaste tu contraseña?**: el enlace debe volver a `/login`.

**Cuando exista la primera venta real**
11. Registra un pago con su comprobante y verifícalo con el otro usuario. El saldo debe bajar y debe poder descargarse el recibo PDF.

**Si algo falla**
- Error 404 al recargar: `.htaccess` no quedó en la carpeta raíz.
- Página que no carga por certificado: el SSL todavía no está activo.
- Enlace de contraseña que no vuelve a la aplicación: revisa **Redirect URLs**.
