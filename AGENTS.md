# Instrucciones para asistentes (Claude, Codex y otros)

## SQL en producción
- Todo SQL que se ejecuta a mano en producción vive en `supabase/sql_produccion/`, numerado `NNNN_nombre.sql` en orden de dependencias. Reglas y estado de cada archivo: `supabase/sql_produccion/CONTROL_EJECUCION.md`.
- Un cambio de base de datos se escribe como migración en `supabase/migrations/`, se registra con el siguiente número en `SQL_PRODUCCION` (`supabase/tests/sql-produccion.test.ts`) y se genera su copia con `REGENERAR=1 npx vitest run supabase/tests/sql-produccion.test.ts`. Nunca se reutiliza un número.
- El usuario ejecuta los SQL en el SQL Editor de Supabase y comunica el resultado; recién entonces se actualiza el estado en el control (PENDIENTE, EJECUTADO, VERIFICADO o ERROR).
- No se piden contraseñas de la base ni se configuran conexiones automáticas para ejecutar SQL.

## Restricciones
- No publicar ni actualizar AMURA en A2 Hosting sin autorización expresa del usuario.
- Los correos se mantienen en modo prueba (`CORREO_PRUEBA_DESTINO`).
- Nada que borre o reescriba datos existentes sin autorización específica.

## Inventario de funcionalidades
- `docs/INVENTARIO_FUNCIONALIDADES.md` se actualiza con cada funcionalidad nueva o cambiada.
