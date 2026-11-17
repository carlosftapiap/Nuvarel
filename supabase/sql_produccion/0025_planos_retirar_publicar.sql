-- AMURA · SQL de producción 0025. Copia exacta de supabase/migrations/20261204000000_planos_retirar_publicar.sql: no editar aquí.
-- Ejecutar completo en el SQL Editor de Supabase, en orden numérico. Registrar el resultado en CONTROL_EJECUCION.md.

-- AMURA · Planos: retira la función planos_publicar(uuid, boolean), que quedó en producción de una versión
-- intermedia de la 0021 y que la 0022 no eliminó (solo quitaba planos_publicar(uuid)).
-- Verificado en producción (solo lectura, 2026-11-17): no tiene objetos dependientes, ninguna función la llama
-- y la aplicación ya no la usa (la carga de planos publica con planos_registrar).
-- Solo elimina esa función. No toca la tabla planos ni sus filas.
drop function if exists public.planos_publicar(uuid, boolean);
