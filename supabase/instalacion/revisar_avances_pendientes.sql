-- AMURA · Avances de obra pendientes de validar o incorporados al eliminar la segunda aprobación. SOLO LECTURA: no modifica nada.
-- situacion = pendiente: no cuenta; si autorizado = sí, la migración 20261031210000_obra_avance_directo.sql lo incorpora.
-- situacion = incorporado: ya cuenta como avance actual. Si autorizado = no, debe revisarse: quien lo registró no tiene hoy permiso para registrar avances.
select case when v.estado = 'pendiente' then 'pendiente' else 'incorporado' end as situacion,
  f.nombre as frente, a.codigo, a.nombre as actividad, v.fecha_corte, v.avance, v.registrado_nombre, pr.rol_id as rol, pr.estado as estado_usuario,
  case when pr.estado = 'activo' and (
         exists (select 1 from public.user_permission_overrides o where o.user_id = pr.id and o.permiso = 'obra.avance' and o.valor = 'permitir')
         or exists (select 1 from public.role_permissions rp where rp.role_id = pr.rol_id and rp.permiso = 'obra.avance'))
       and not exists (select 1 from public.user_permission_overrides o where o.user_id = pr.id and o.permiso = 'obra.avance' and o.valor <> 'permitir')
       then 'sí' else 'no' end as autorizado
from public.obra_avances v
join public.obra_actividades a on a.id = v.actividad_id
join public.obra_frentes f on f.id = a.frente_id
left join public.profiles pr on pr.id = v.registrado_por
where v.estado = 'pendiente' or v.validacion_nota = 'Aprobación eliminada'
order by 1, f.orden, a.codigo, v.fecha_corte;
