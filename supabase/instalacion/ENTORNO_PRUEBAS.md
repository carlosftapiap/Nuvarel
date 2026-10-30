# Entornos de prueba

Producción no se toca desde estos entornos. El proyecto real está en `.env.local`: **nunca apliques estas migraciones usando sus credenciales.** No uses datos personales reales. No guardes contraseñas ni claves en Git: los archivos `.env.*` ya están ignorados.

## A. Local, en este equipo (ya disponible)

Postgres real (PGlite) con todas las migraciones, RLS y funciones, detrás de un servidor que responde como Supabase Auth y su API REST. Los datos se pierden al detenerlo.

```bash
npm run entorno:pruebas
# en otra terminal: la variable de entorno tiene prioridad sobre .env.local
VITE_SUPABASE_URL=http://127.0.0.1:54399 VITE_SUPABASE_PUBLISHABLE_KEY=local npx vite --port 5174
```

Abre http://127.0.0.1:5174. Contraseña de todos: `Prueba123` (solo existe en este servidor local). Usuarios: los de la tabla del paso 4.

No comprueba el Auth y la API REST reales de Supabase, correos, archivos ni funciones Edge. Para eso está el entorno B.

## B. Proyecto de pruebas en Supabase (lo crea el responsable de la cuenta)

### 1. Crear el proyecto

En https://supabase.com/dashboard → **New project**. Nómbralo `amura-pruebas`, en la misma región que producción y con una contraseña de base de datos nueva. No copies datos de producción. Si tu plan no admite otro proyecto gratuito, pausa uno que no uses o crea otra organización.

### 2. Configurar la app

En **Project Settings → API** copia la URL y la clave *publishable* o *anon* (nunca `service_role`). Crea en la raíz del proyecto el archivo `.env.staging.local`:

```
VITE_SUPABASE_URL=https://<id-del-proyecto-de-pruebas>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<clave-publicable>
```

Arranca con `npm run dev:pruebas` y abre http://localhost:5174. En las herramientas del navegador (pestaña Red), comprueba que las peticiones van al `<id-del-proyecto-de-pruebas>`, no al de producción.

### 3. Aplicar las migraciones

En el **SQL Editor**, abre cada archivo de `supabase/` y ejecútalo, en este orden exacto. Si uno falla, detente: no sigas con el siguiente.

| # | Archivo |
|---|---|
| 1 | `migrations/20261028120000_inventario.sql` |
| 2 | `seed.sql` |
| 3 | `migrations/20261028160000_precios_cotizaciones.sql` |
| 4 | `migrations/20261028180000_clientes.sql` |
| 5 | `migrations/20261028200000_reservas.sql` |
| 6 | `migrations/20261028220000_usuarios_tablas.sql` |
| 7 | `seed_roles.sql` |
| 8 | `migrations/20261028220100_usuarios_funciones.sql` |
| 9 | `migrations/20261028220200_usuarios_perfiles_existentes.sql` |
| 10 | `migrations/20261028220300_usuarios_administracion.sql` |
| 11 | `migrations/20261028220400_alcance_por_permisos.sql` |
| 12 | `migrations/20261029000000_flujo_comercial.sql` |
| 13 | `migrations/20261029010000_conexion_app.sql` |
| 14 | `migrations/20261029020000_plan_implementacion.sql` |
| 15 | `migrations/20261029030000_cuentas.sql` |
| 16 | `migrations/20261029040000_administrador_inicial.sql` |
| 17 | `migrations/20261029050000_cobranza_cronograma.sql` |
| 18 | `migrations/20261029050000_precios_remotos.sql` |
| 19 | `migrations/20261029060000_financiamiento_catalogo.sql` |
| 20 | `seed_roles.sql` (otra vez: agrega los permisos nuevos) |
| 21 | `migrations/20261031000000_clientes_crm.sql` |
| 22 | `migrations/20261031010000_integracion_comercial.sql` |
| 23 | `migrations/20261031020000_ventas_contratos.sql` |
| 24 | `migrations/20261031030000_desistimiento.sql` |

`migrations/20261030000000_plan_responsable_externo.sql` es del Gantt y va aparte, cuando se autorice. Nada de lo anterior la necesita.

### 4. Crear los usuarios de prueba

En **Authentication → Users → Add user → Create new user**, con **Auto Confirm User** marcado, crea estas cuentas con una contraseña que solo tú conozcas:

| Correo | Rol | Para qué |
|---|---|---|
| `admin@prueba.local` | Administrador | Todo, reasignar, trazabilidad |
| `gerente@prueba.local` | Gerencia | Aprobar reservas |
| `finanzas@prueba.local` | Finanzas | Verificar ingresos, cobranzas |
| `legal@prueba.local` | Legal / Operaciones | Generar y firmar contratos |
| `supervisora@prueba.local` | Supervisor | Ve a su equipo |
| `corredor1@prueba.local` | Corredor, en el equipo | Vende |
| `corredor2@prueba.local` | Corredor, sin equipo | No debe ver lo de otros |

Luego ejecuta `instalacion/usuarios_prueba.sql` en el SQL Editor. Crea los perfiles, el equipo y el receptor de pagos, y **se niega a correr si encuentra cuentas que no sean `@prueba.local`**.

### 5. Validar RLS

Ejecuta `instalacion/validar_rls.sql` en el SQL Editor. Actúa como cada usuario y deshace todo al terminar. **Todas las filas deben mostrar `ok = true`.** Si alguna falla, no sigas y envíame el resultado.

### 6. Comprobar desde dos navegadores

Usa dos navegadores distintos, o uno normal y otro en incógnito, para que no compartan sesión.

| Paso | Navegador 1 | Navegador 2 | Esperado |
|---|---|---|---|
| 1 | `corredor1` crea un cliente | `corredor2` entra a Clientes | El 2 no lo ve |
| 2 | | `supervisora` entra | Lo ve |
| 3 | `admin` lo reasigna a `corredor2`, con motivo | `corredor1` recarga | `corredor1` deja de verlo |
| 4 | `corredor2` registra una llamada | `admin` vuelve a la pestaña | La ve sin recargar a mano (máximo 60 s) |
| 5 | `corredor2` cotiza y solicita la reserva | `corredor1` entra a Reservas | No la ve |
| 6 | `corredor2` registra el comprobante | `finanzas` verifica el ingreso | Pasa a Pago verificado; la unidad sigue libre |
| 7 | | `gerente` aprueba | La unidad queda reservada y el cliente en Reserva |
| 8 | `legal` genera el contrato en Ventas | `finanzas` abre Cobranzas | Aparece con su cronograma, no exigible |
| 9 | `legal` registra la firma | `finanzas` recarga Cobranzas | Es exigible y la unidad queda en promesa |
| 10 | `corredor2` busca Ventas en el menú | | No la ve: no tiene `ventas.ver` |
| 11 | `admin` reasigna el cliente otra vez | `legal` abre el contrato | Asesor, responsable y atribución de la venta no cambian |
| 12 | `legal` anula el contrato con motivo | `finanzas` recarga Cobranzas | Sale de la cartera; en Ventas sigue visible como anulado |

Cierra sesión y vuelve a entrar al terminar: todo debe seguir ahí.

### 7. Qué me envías

El resultado de `validar_rls.sql`, la tabla del paso 6 con lo que falló (si algo falló) y cualquier error de la pestaña Red. Con eso se puede decidir si pasar a producción.

## Datos locales antes de pasar a producción

Las cotizaciones y reservas creadas antes de conectar Supabase están solo en el navegador donde se hicieron. **No se han migrado ni borrado, y no se asumen demostrativas.**

Procedimiento, **en cada equipo y navegador que se haya usado, y en cada dirección** (`localhost`, `127.0.0.1` y la publicada guardan por separado):

1. Abre esa misma dirección con sesión iniciada y entra a **Cotizaciones** y a **Reservas**.
2. Si hay registros, aparece un aviso ámbar. Pulsa **Ver registros**: muestra cantidad, fechas, referencias, cliente y usuario.
3. Pulsa **Descargar copia** y guarda el archivo fuera del repositorio: contiene datos de clientes.
4. Anota cuáles son reales.

Si hay datos reales, hace falta un importador controlado antes de producción. Hoy existe solo para clientes (`CLIENTES.md`). Para cotizaciones y reservas está pendiente, porque deben pasar por el flujo autorizado y no pueden crearse como ya confirmadas sin revisar el pago.
