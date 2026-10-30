# Entornos de prueba

Producción no se toca desde ninguno de estos entornos. El proyecto real está en `.env.local`: **no apliques migraciones usando esas credenciales.**

## A. Local, en este equipo (ya disponible)

Postgres real (PGlite) con todas las migraciones, RLS y funciones, detrás de un servidor que responde como Supabase Auth y su API REST. Los datos se pierden al detenerlo.

```bash
npm run entorno:pruebas
# en otra terminal: la variable de entorno tiene prioridad sobre .env.local
VITE_SUPABASE_URL=http://127.0.0.1:54399 VITE_SUPABASE_PUBLISHABLE_KEY=local npx vite --port 5174
```

Abre http://127.0.0.1:5174. Contraseña de todos: `Prueba123`.

| Usuario | Rol |
|---|---|
| `admin@prueba.local` | Administrador |
| `gerente@prueba.local` | Gerencia |
| `finanzas@prueba.local` | Finanzas |
| `supervisora@prueba.local` | Supervisor del Equipo Norte |
| `corredor1@prueba.local` | Corredor del Equipo Norte |
| `corredor2@prueba.local` | Corredor sin equipo |

**Qué no comprueba:** el Auth y la API REST reales de Supabase, correos de invitación, almacenamiento de archivos, funciones Edge ni los límites del proyecto alojado. Para eso está el entorno B.

## B. Proyecto de pruebas en Supabase (pendiente: lo crea el responsable de la cuenta)

1. Crea un proyecto nuevo en Supabase, separado del real. No copies datos reales de clientes.
2. En el SQL Editor, ejecuta en este orden:
   - todos los archivos de `supabase/migrations/` por nombre, hasta `20261029060000_financiamiento_catalogo.sql`, con `seed.sql` después de `20261028120000_inventario.sql` y `seed_roles.sql` después de `20261028220000_usuarios_tablas.sql` (ver `ACCESO_Y_ADMINISTRADOR.md` para el administrador inicial);
   - `20261031000000_clientes_crm.sql`;
   - `20261031010000_integracion_comercial.sql`.

   `20261030000000_plan_responsable_externo.sql` es del Gantt y es independiente: aplícala aparte cuando se autorice. Clientes no la necesita.
3. Crea un archivo `.env.test.local` con la URL y la clave publicable del proyecto de pruebas, y arranca con `npx vite --mode test.local --port 5174`. Comprueba en las herramientas del navegador que las peticiones van al proyecto de pruebas.
4. Recorre la lista de `CLIENTES.md`, sección 3.
5. En Configuración, define el receptor de pagos antes de probar la verificación de una reserva.
