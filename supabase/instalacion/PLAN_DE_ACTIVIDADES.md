# Plan de actividades: instalación y puesta en marcha

Proyecto Supabase existente con las tablas `plan_*` ya creadas y sin usuarios en `auth.users`. No se recrean tablas ni se repiten migraciones.

## 1. Verificar qué falta (solo lectura, SQL Editor)

```sql
select to_regprocedure('public.mi_sesion()') is not null              as conexion_app,
       to_regprocedure('public.plan_importar(uuid, text, text, jsonb)') is not null as plan,
       (select count(*) from public.permissions where clave like 'plan.%') as permisos_plan,
       (select count(*) from public.roles)                              as roles,
       (select count(*) from auth.users)                                as cuentas;
```

| Resultado | Qué ejecutar |
|---|---|
| `conexion_app = false` | `supabase/migrations/20261029010000_conexion_app.sql` (sin él no se puede iniciar sesión en la app) |
| `permisos_plan < 11` o `roles < 8` | `supabase/seed_roles.sql` (idempotente; agrega los permisos `plan.*` y los perfiles Finanzas, Legal y JARVAL) |

`plan = true` confirma que `20261029020000_plan_implementacion.sql` ya está aplicado: no lo vuelvas a ejecutar.

## 2. Primer administrador (procedimiento seguro)

1. En Supabase: **Authentication → Users → Add user → Create new user**. Escribe tu correo y una contraseña robusta y marca **Auto Confirm User**. La contraseña solo se escribe ahí: nunca en archivos ni en el SQL.
2. En el SQL Editor abre `supabase/instalacion/primer_administrador.sql`, escribe ese correo en `v_email` y ejecútalo. Crea el perfil activo con rol Administrador y lo deja en auditoría. Se niega si ya existe un administrador.
3. En **Authentication → URL Configuration** agrega la dirección de la app (por ejemplo `http://localhost:5173` y el dominio de producción) para que funcione el enlace de recuperación de contraseña.

Otros usuarios: mientras la pantalla **Configuración** no esté conectada a Supabase (pendiente), créalos con el paso 1 y luego ejecuta `supabase/instalacion/alta_usuario.sql` con su correo, nombre y rol.

## 3. Configuración de la app

`.env.local` (no se sube al repositorio) solo con valores públicos:

```
VITE_SUPABASE_URL=https://<proyecto>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<clave publicable o anon>
```

Con esas dos variables la app exige iniciar sesión. Nunca uses la clave `service_role` en el navegador.

## 4. Cargar las 147 actividades (elige una alternativa)

**A · Desde la app (recomendado).** Plan de implementación → si no hay plan, *Crear plan* → pestaña **Importar** → elige `Gantt_AMURA.xlsx`. La hoja *1 TRABAJAR AQUI* y sus columnas se proponen solas. Revisa estados, responsables (vincúlalos a usuarios o déjalos sin vincular) y fases, mira la vista previa y confirma. Se aplica en una sola transacción.

**B · Script SQL.** `supabase/carga/plan_amura_inicial.sql`: escribe el correo del administrador en `v_email` y ejecuta el archivo completo. Crea el plan `PLAN-AMURA`, 6 frentes sin peso, 14 fases (los grupos originales, sin frente), 147 actividades, 142 dependencias y 5 evidencias (enlaces). Puede ejecutarse dos veces sin duplicar. No se ejecuta automáticamente.

En ambos casos: no se inventan pesos, los responsables quedan como texto hasta vincularlos, se conservan las fechas originales como línea base, y "Completado" o "Por validar" entran en ejecución (cerrar exige fecha real de fin y evidencias). Las dependencias cuya sucesora empieza el mismo día (o antes) del fin de su predecesora se listan en el encabezado del script y en el Resumen del plan para revisarlas; no se cambian.

## 5. Comprobación

```sql
select count(*) as actividades,
       count(*) filter (where responsable_id is null) as sin_responsable_vinculado,
       count(*) filter (where peso is null)           as sin_peso,
       count(*) filter (where estado = 'completada')  as cerradas
from public.plan_activities a join public.plan_plans p on p.id = a.plan_id
where p.codigo = 'PLAN-AMURA';
```

Resultado esperado tras la carga: 147 · 147 · 147 · 0.

## Convenciones

- Avance 0–100; vacío = sin dato (distinto de 0). Duración en días calendario inclusivos.
- Dependencia fin a inicio: la sucesora empieza el día siguiente al fin de su predecesora.
- Avance de un frente = Σ(peso × avance) / Σ(pesos); el consolidado solo se habilita con todos los pesos de frentes definidos y validados. Comercial y Construcción se calculan por separado.
