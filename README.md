# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## Módulo de Inventario

- **Datos**: 72 departamentos (E1: 30, E2: 42) en `src/features/inventario/data/amura-units.ts`, generados desde
  `AMURA_Edificio1_Precios_vs_Competencia.xlsx` (simulador, 28/10/2026) y verificados contra `Lista_precios_AMURA_Base.pdf`,
  `SEGREGACIÓN DE BODEGAS.docx` y los planos de Edificio 1 y 2.
- **Regla de precio**: `redondeo(USD/m² × (área + bodega)) + patio × USD 230/m²`. Pago: 6% reserva + 14% en 30/42 cuotas + 80% contra entrega.
- **Datos por confirmar**: estado comercial de las 72 unidades (`por_confirmar`), bodega A de pisos 1–5 del E1 (segregación 2,10 m² vs lista/plano 1,98 m²),
  patios (tomados del simulador), planos individuales e imágenes.
- **Permisos**: precios y estados sólo Administrador/Gerencia; parámetros sólo Administrador. El rol del encabezado es de demostración.
  La autorización real está en `supabase/migrations/20261028120000_inventario.sql` (RLS + RPC), pendiente de aplicar.
- **Persistencia actual**: navegador (`localStorage`) hasta conectar Supabase. Semilla SQL: `node scripts/generar-seed-inventario.mjs` → `supabase/seed.sql`.
- **Pruebas**: `npm test` (precio y plan de pagos de las 72 unidades contra el PDF, ajustes, permisos, estados, importación/exportación Excel y flujo de UI).

## Fase 1 de ventas: precios, financiamiento y cotizaciones

- **Precios** (`/precios`): simulación por % o USD/m² con impacto por unidad, valor total y posición frente a FRATELLI.
  Gerencia envía propuestas; solo administración las aprueba y pasan a precio oficial (con historial).
- **Competencia**: 60 unidades de FRATELLI de su lista del 26/10/2026. Reproduce el 0 · 58 · 14 (bajo · dentro · sobre) del PDF. No visible para corredores.
- **Financiamiento** (`/financiamiento`): 6% reserva, 14% en 30 (E1) o 42 (E2) cuotas, 80% contra entrega; cronograma con fechas y exportación a Excel.
- **Cotizaciones** (`/cotizaciones`): PDF con identidad AMURA, datos del cliente y del asesor, descuento autorizado (solo gerencia/administración), vigencia y cronograma.
  Solo se cotizan unidades disponibles o por confirmar.
- **Supabase**: `supabase/migrations/20261028160000_precios_cotizaciones.sql` agrega parqueo, propuestas y cotizaciones con RLS.

## Clientes y gestión comercial

- **Clientes** (`/clientes`): tablero Nuevo → Contactado → Calificado → Visita → Cotización → Negociación → Reserva, más Perdido (con motivo) y Seguimiento futuro (con fecha).
  Ficha con datos, origen, interés (departamentos, presupuesto, vivir/invertir), forma de pago (contado, banco, BIESS), asesor, próxima actividad e historial.
- **Reglas**: sin duplicados por teléfono o correo; Cotización, Negociación y Reserva exigen departamento; Reserva exige una cotización; la primera llamada pasa a Contactado.
  Reasignar exige `clientes.asignar`, alcance y motivo; los corredores ven solo sus clientes.
- **Cotizaciones por cliente**: desde la ficha se prepara la cotización; queda en el historial y el cliente avanza a Cotización.
- **Gestión comercial** (`/comercial`): agenda del asesor (vencidas, hoy, 7 días, sin siguiente paso), embudo y origen.
- **Supabase**: `supabase/migrations/20261028180000_clientes.sql` y `20261031000000_clientes_crm.sql`. Con Supabase configurado, Clientes lee y guarda en la base de datos (ver `supabase/instalacion/CLIENTES.md`); sin configuración sigue en el navegador.
- **Negociaciones**: `clients.etapa` es el seguimiento general; cada negociación por unidad o tipología es una oportunidad. Un cliente puede tener varias.

## Reservas

- **Solicitud**: desde una cotización vinculada a un cliente. Requiere cotización vigente y unidad con disponibilidad confirmada. No bloquea la unidad.
- **Confirmación** (gerencia o administración): exige comprobante y monto igual o mayor a la reserva acordada. En la misma operación bloquea la unidad en Inventario y pasa al cliente a Reserva.
- **Anulación**: una solicitud se cierra sin tocar el inventario; una reserva confirmada libera la unidad y devuelve al cliente a Negociación.
- Una sola reserva activa por unidad, también en la base de datos (índice único).
- Migración: `supabase/migrations/20261028200000_reservas.sql`.

## Usuarios, roles y permisos

- **Configuración** (`/configuracion`): Usuarios (invitar, editar, activar/desactivar, excepciones), Roles y permisos (perfiles editables y nuevos), Equipos (supervisor y gerencias) y Auditoría (accesos, precios, estados y reservas).
- **Permisos** = rol + excepciones individuales (heredar, permitir, denegar; denegar prevalece; lo no definido se deniega). Catálogo por módulo y acción en `src/app/permissions.ts`.
- **Alcance de datos**: propio, equipo o empresa, comparando identificadores de usuario (nunca nombres). Un vendedor ve por defecto solo lo suyo.
- **Controles**: menú y rutas directas verifican permisos; nadie amplía sus propios permisos ni concede los que no tiene; no se puede quedar sin administrador activo; desactivar conserva el historial; el aviso de duplicado no revela datos de otro equipo.
- **Servidor**: `supabase/migrations/20261028220000` a `20261028220400` (cinco archivos idempotentes: perfiles, roles, excepciones, equipos, proyectos, auditoría, `tiene_permiso`, `en_alcance` y políticas por alcance) + `supabase/seed_roles.sql` (generado; una prueba verifica que coincide con la app) + función `supabase/functions/invitar-usuario`.
- **Modo local**: hasta conectar Supabase Auth se trabaja como un usuario del directorio (selector superior). El directorio empieza con un único "Administrador inicial".
