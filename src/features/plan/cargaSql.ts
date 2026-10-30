import * as XLSX from 'xlsx'
import { validarDependencias } from './calculo'
import { ESTADOS_SUGERIDOS, fasesDelArchivo, fechaExcel, leerFilas, mapeoGanttAmura, normalizar, type FilaImportacion } from './importar'
import type { Actividad } from './model'

/**
 * Script SQL de carga inicial del plan AMURA desde Gantt_AMURA.xlsx (alternativa a la importación desde la app).
 * Mismas reglas que la importación: 14 grupos como fases sin frente, sin pesos, responsables como texto,
 * fechas originales como línea base y vigentes, "Completado" en ejecución al 100% (no se cierra sin fecha real ni evidencia).
 * Idempotente (clave plan + código) y en una sola transacción. No se ejecuta automáticamente.
 */
const q = (v: unknown): string => {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return `'${String(v).replace(/'/g, "''")}'`
}

export function generarCargaSql(wb: XLSX.WorkBook, archivo = 'Gantt_AMURA.xlsx'): string {
  const m = mapeoGanttAmura()
  const filas = leerFilas(wb, m)
  const grupos = fasesDelArchivo(filas)
  const n = normalizar(filas, { ...m, estados: ESTADOS_SUGERIDOS, responsables: {}, fases: Object.fromEntries(grupos.map((g) => [g.texto, g.codigo])), vaciarConCeldasVacias: false })
  if (n.errores.length) throw new Error(`El archivo tiene errores: ${n.errores.map((e) => `fila ${e.fila} ${e.columna}: ${e.mensaje}`).join('; ')}`)
  const ajustes = wb.Sheets['5 Ajustes']
  const corte = fechaExcel(ajustes?.B5?.v) ?? fechaExcel(ajustes?.B4?.v)
  if (!corte) throw new Error('No se encontró la fecha de corte en la hoja "5 Ajustes" (B5).')

  const acts = n.filas
  const deps = acts.filter((f) => typeof f.predecesora === 'string').map((f) => ({ suc: f.codigo, pred: f.predecesora as string }))
  const evid = acts.filter((f) => typeof f.evidencia === 'string' && /^https?:\/\//.test(String(f.evidencia))).map((f) => ({ codigo: f.codigo, url: String(f.evidencia) }))

  // Dependencias cuya sucesora empieza el mismo día (o antes) del fin de la predecesora: se listan para revisión, no se cambian.
  const comoAct = (f: FilaImportacion) => ({ id: f.codigo, codigo: f.codigo, planInicio: (f.plan_inicio as string) ?? null, planFin: (f.plan_fin as string) ?? null }) as Actividad
  const revisar = validarDependencias(acts.map(comoAct), deps.map((x) => ({ predecesoraId: x.pred, sucesoraId: x.suc }))).filter((p) => p.tipo === 'fechas')

  const valores = acts.map((f) => `    (${[
    q(f.codigo), q(f.nombre), q(f.descripcion ?? ''), q(f.resultado_esperado ?? ''), q(f.tipo ?? 'actividad'), q(f.fase_codigo),
    q(f.responsable_texto ?? null), q(f.aprobador_texto ?? null), q(f.plan_inicio ?? null), q(f.plan_fin ?? null),
    q(f.avance ?? null), q(f.estado ?? 'pendiente'), q(f.bloquea_lanzamiento ?? null), q(f.observaciones ?? ''), q(f.fuente ?? ''),
  ].join(', ')})`).join(',\n')

  return `-- AMURA · Carga inicial del Plan de implementación desde ${archivo} (hoja "${m.hoja}").
-- Generado por src/features/plan/cargaSql.ts. No editar a mano: vuelve a generarlo si cambia el Excel.
-- NO SE EJECUTA AUTOMÁTICAMENTE. Requisitos: migraciones hasta 20261029020000_plan_implementacion.sql, seed_roles.sql
-- y un administrador activo (supabase/instalacion/primer_administrador.sql).
-- Cómo usarlo: escribe el correo del administrador en v_email y ejecuta todo el archivo en el SQL Editor.
--
-- Qué hace (idempotente: puede ejecutarse dos veces sin duplicar):
--   · Plan PLAN-AMURA (proyecto AMURA) con fecha de corte ${corte} (hoja "5 Ajustes", B5).
--   · Seis frentes sin peso: Comercial, Marketing, Legal, Tecnología, Finanzas y Construcción (avance "Incompleto" hasta definir pesos).
--   · ${grupos.length} fases = grupos originales del Excel, sin frente asignado (se asignan después en Configuración del plan).
--   · ${acts.length} actividades. Sin pesos. Responsables como texto (sin vincular a usuarios). Fechas originales como línea base y vigentes.
--   · "Completado" y "Por validar" quedan en ejecución (al avance del archivo): cerrar exige fecha real de fin y evidencias en la app.
--   · ${deps.length} dependencias fin a inicio y ${evid.length} evidencias (enlaces).
--   · No borra ni modifica actividades que ya existan con el mismo código.
--
-- Dependencias para revisar (la sucesora empieza el mismo día o antes del fin de la predecesora). No se cambian:
${revisar.map((p) => `--   ${p.texto}`).join('\n') || '--   (ninguna)'}

begin;

do $$
declare
  v_email text := 'REEMPLAZAR@correo.com';  -- ← correo del administrador que realiza la carga
  v_admin uuid;
  v_plan uuid;
  v_import uuid := gen_random_uuid();
  v_nuevas int;
  v_deps int;
  v_evid int;
begin
  if v_email like 'REEMPLAZAR%' then raise exception 'Escribe en v_email el correo del administrador'; end if;
  select p.id into v_admin
  from public.profiles p join public.role_permissions rp on rp.role_id = p.rol_id and rp.permiso = 'plan.importar'
  where lower(p.email) = lower(trim(v_email)) and p.estado = 'activo'
    and not exists (select 1 from public.user_permission_overrides o where o.user_id = p.id and o.permiso = 'plan.importar' and o.valor = 'denegar');
  if v_admin is null then
    raise exception 'El correo no corresponde a un perfil activo con permiso plan.importar (¿ejecutaste seed_roles.sql y primer_administrador.sql?)';
  end if;

  insert into public.plan_plans (project_id, codigo, nombre, fecha_corte, created_by)
  values ('AMURA', 'PLAN-AMURA', 'Plan de implementación AMURA', ${q(corte)}, v_admin)
  on conflict (project_id, codigo) do nothing;
  select id into v_plan from public.plan_plans where project_id = 'AMURA' and codigo = 'PLAN-AMURA';

  insert into public.plan_frentes (plan_id, codigo, nombre, orden) values
    (v_plan, 'COM', 'Comercial', 1), (v_plan, 'MKT', 'Marketing', 2), (v_plan, 'LEG', 'Legal', 3),
    (v_plan, 'TEC', 'Tecnología', 4), (v_plan, 'FIN', 'Finanzas', 5), (v_plan, 'CON', 'Construcción', 6)
  on conflict (plan_id, codigo) do nothing;

  insert into public.plan_fases (plan_id, codigo, nombre, orden) values
${grupos.map((g, i) => `    (v_plan, ${q(g.codigo)}, ${q(g.nombre)}, ${i + 1})`).join(',\n')}
  on conflict (plan_id, codigo) do nothing;

  insert into public.plan_activities (plan_id, codigo, nombre, descripcion, resultado_esperado, tipo, fase_id, frente_id, responsable_texto, aprobador_texto,
                                      base_inicio, base_fin, plan_inicio, plan_fin, avance, estado, bloquea_lanzamiento, observaciones, fuente, created_by, updated_by)
  select v_plan, x.codigo, x.nombre, x.descripcion, x.resultado, x.tipo, f.id, f.frente_id, x.responsable, x.aprobador,
         x.inicio::date, x.fin::date, x.inicio::date, x.fin::date, x.avance::numeric, x.estado, x.bloquea::boolean, x.observaciones, x.fuente, v_admin, v_admin
  from (values
${valores}
  ) as x(codigo, nombre, descripcion, resultado, tipo, fase, responsable, aprobador, inicio, fin, avance, estado, bloquea, observaciones, fuente)
  left join public.plan_fases f on f.plan_id = v_plan and f.codigo = x.fase
  on conflict (plan_id, codigo) do nothing;
  get diagnostics v_nuevas = row_count;

  insert into public.plan_history (activity_id, user_id, accion, motivo, despues, import_id)
  select a.id, v_admin, 'Carga inicial (SQL)', 'Carga inicial desde ${archivo}', jsonb_build_object('codigo', a.codigo), v_import
  from public.plan_activities a
  where a.plan_id = v_plan and not exists (select 1 from public.plan_history h where h.activity_id = a.id);

  insert into public.plan_dependencies (plan_id, predecesora_id, sucesora_id, created_by)
  select v_plan, p.id, s.id, v_admin
  from (values
${deps.map((x) => `    (${q(x.suc)}, ${q(x.pred)})`).join(',\n')}
  ) as d(sucesora, predecesora)
  join public.plan_activities s on s.plan_id = v_plan and s.codigo = d.sucesora
  join public.plan_activities p on p.plan_id = v_plan and p.codigo = d.predecesora
  on conflict do nothing;
  get diagnostics v_deps = row_count;

  insert into public.plan_evidences (activity_id, tipo, referencia, descripcion, created_by)
  select a.id, 'enlace', e.url, 'Importada de ${archivo}', v_admin
  from (values
${evid.map((x) => `    (${q(x.codigo)}, ${q(x.url)})`).join(',\n')}
  ) as e(codigo, url)
  join public.plan_activities a on a.plan_id = v_plan and a.codigo = e.codigo
  on conflict (activity_id, referencia) do nothing;
  get diagnostics v_evid = row_count;

  insert into public.plan_imports (id, plan_id, archivo, hoja, user_id, resumen, cambios)
  values (v_import, v_plan, '${archivo}', '${m.hoja}', v_admin,
          jsonb_build_object('nuevas', v_nuevas, 'sin_cambios', ${acts.length} - v_nuevas, 'dependencias', v_deps, 'evidencias', v_evid, 'via', 'script SQL'), '[]'::jsonb);
  insert into public.audit_log (actor_id, accion, entidad, entidad_id, motivo, despues)
  values (v_admin, 'Carga inicial del plan', 'plan', v_plan::text, 'Carga inicial desde ${archivo} (script SQL)',
          jsonb_build_object('nuevas', v_nuevas, 'dependencias', v_deps, 'evidencias', v_evid));
  raise notice 'Plan PLAN-AMURA: % actividades nuevas, % dependencias nuevas, % evidencias nuevas', v_nuevas, v_deps, v_evid;
end $$;

commit;

-- Verificación (solo lectura):
-- select count(*) as actividades, count(*) filter (where responsable_id is null) as sin_responsable_vinculado,
--        count(*) filter (where peso is null) as sin_peso, count(*) filter (where estado = 'completada') as cerradas
-- from public.plan_activities a join public.plan_plans p on p.id = a.plan_id where p.codigo = 'PLAN-AMURA';
`
}
