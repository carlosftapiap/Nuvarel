# Acceso a AMURA: inicio de sesión y administrador principal

Ninguna contraseña se guarda en el código, en los scripts SQL, en variables `VITE_` ni en el repositorio. La contraseña del administrador se escribe solo en el panel de Supabase.

## 1. Configurar Supabase Authentication (una vez)

1. **Authentication → Sign In / Providers → Email**: deja activo *Email*.
2. **Authentication → Sign In / Providers**: desactiva **Allow new users to sign up**. Con esto el registro público queda cerrado: solo un administrador crea cuentas.
3. **Authentication → URL Configuration**:
   - *Site URL*: la dirección de la app (por ejemplo `https://amura.tudominio.com`).
   - *Redirect URLs*: agrega `http://localhost:5173/login`, `http://127.0.0.1:5173/login` y `https://<tu dominio>/login` (enlace de recuperación de contraseña).
4. **Authentication → Policies / Password**: longitud mínima recomendada 10 caracteres.

## 2. Base de datos

En el SQL Editor, si aún no lo hiciste:

1. `supabase/migrations/20261029010000_conexion_app.sql` (función `mi_sesion`, necesaria para entrar).
2. `supabase/migrations/20261029030000_cuentas.sql` (listar y habilitar cuentas desde Configuración).
3. `supabase/seed_roles.sql` (catálogo de permisos y perfiles; idempotente).

## 3. Crear el administrador principal

1. **Authentication → Users → Add user → Create new user**
   - Email: `carlosftapiap@gmail.com`
   - Password: la que elijas (se escribe solo aquí)
   - Marca **Auto Confirm User**
2. **SQL Editor**: abre `supabase/instalacion/primer_administrador.sql`, cambia
   - `v_email` → `carlosftapiap@gmail.com`
   - `v_nombre` → `Carlos Tapia`

   y ejecútalo. El script crea el perfil activo con el rol **Administrador** (todos los permisos del catálogo) y lo registra en auditoría. Se niega si ya existe un administrador activo, así que no puede usarse después para darse privilegios.

## 4. Comprobar el acceso de administrador

1. Abre la app y entra en `/login` con ese correo y contraseña. Debe llevarte al Dashboard.
2. En el menú deben aparecer todos los módulos, incluidos **Plan de implementación** y **Configuración**.
3. En **Configuración → Usuarios** debe aparecer tu cuenta como *Activo* con rol Administrador, marcada “(tú)” y sin botones para cambiar tu propio rol o estado.
4. Consulta de verificación (SQL Editor):

```sql
select p.nombre, p.email, p.estado, p.rol_id,
       (select count(*) from public.role_permissions rp where rp.role_id = p.rol_id) as permisos_del_rol,
       (select count(*) from public.permissions) as permisos_del_catalogo
from public.profiles p where p.email = 'carlosftapiap@gmail.com';
```

Esperado: `Carlos Tapia · activo · administrador` y `permisos_del_rol = permisos_del_catalogo`.

## 5. Altas de otros usuarios

Desde **Configuración → Usuarios** (solo quien tiene `config.usuarios`):

- **Habilitar**: para una cuenta creada en *Authentication → Users*; se elige nombre, rol y motivo.
- **Crear usuario**: el administrador indica nombre, correo, contraseña inicial y rol; la cuenta queda activa, sin correos ni confirmación. Requiere desplegar la función del servidor:
  `supabase functions deploy crear-usuario`.
  La clave `service_role` la provee Supabase dentro de la función; nunca va al navegador. 
- **Cambiar rol**, **Activar / Desactivar** y **Restablecer contraseña**, siempre con motivo y auditoría.

Reglas que aplica la base de datos (no solo la pantalla): nadie se crea un perfil ni cambia su propio rol o estado; nadie concede un rol con permisos que no tiene; desactivar quita el acceso a los datos de inmediato y conserva el historial.
