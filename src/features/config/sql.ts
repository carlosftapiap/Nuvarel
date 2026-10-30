import { CATALOGO, PLANTILLAS_ROL } from '@/app/permissions'

const q = (s: string) => `'${s.replace(/'/g, "''")}'`

/** SQL de los perfiles iniciales y del catálogo de permisos, generado desde las mismas definiciones que usa la app. */
export function generarSqlRoles() {
  const permisos = CATALOGO.flatMap((m) => m.permisos.map(([k, l]) => `  (${q(k)}, ${q(m.modulo)}, ${q(l)})`))
  const roles = PLANTILLAS_ROL.map((r) => `  (${q(r.id)}, ${q(r.nombre)}, ${q(r.descripcion)}, ${q(r.alcance)}, true)`)
  const rp = PLANTILLAS_ROL.flatMap((r) => r.permisos.map((p) => `  (${q(r.id)}, ${q(p)})`))
  return `-- Generado desde src/app/permissions.ts (catálogo y perfiles iniciales). No editar a mano.
-- Ejecutar después de 20261028220000_usuarios_tablas.sql y antes de 20261028220100_usuarios_funciones.sql.
insert into public.permissions (clave, modulo, descripcion) values
${permisos.join(',\n')}
on conflict (clave) do update set modulo = excluded.modulo, descripcion = excluded.descripcion;

insert into public.roles (id, nombre, descripcion, alcance, sistema) values
${roles.join(',\n')}
on conflict (id) do nothing;

insert into public.role_permissions (role_id, permiso) values
${rp.join(',\n')}
on conflict do nothing;
`
}
