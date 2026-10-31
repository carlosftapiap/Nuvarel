-- AMURA · Plan de recuperación del módulo de documentos contractuales.
-- Deshace únicamente 20261031130000_documentos_contractuales.sql. No toca contratos, cuotas, precios, reservas, inventario ni cobros.
-- Se detiene sin cambiar nada si el módulo ya tiene información (plantillas, documentos, compradores adicionales, entidad vendedora o datos legales de clientes).

begin;

do $$ begin
  if exists (select 1 from public.contract_templates) or exists (select 1 from public.contract_document_versions) or exists (select 1 from public.contract_buyers) then
    raise exception 'El módulo ya tiene plantillas, documentos o compradores: no se revierte. Restaura el respaldo si es indispensable.';
  end if;
  if exists (select 1 from public.entidad_vendedora where razon_social <> '' or ruc <> '') then
    raise exception 'La entidad vendedora ya tiene datos: no se revierte.';
  end if;
  if exists (select 1 from public.clients where domicilio is not null or ciudad is not null or estado_civil is not null or nacionalidad is not null) then
    raise exception 'Hay clientes con datos legales registrados: no se revierte.';
  end if;
  if to_regclass('storage.buckets') is not null then
    drop policy if exists "plantillas contratos consultar" on storage.objects;
    drop policy if exists "plantillas contratos cargar" on storage.objects;
    drop policy if exists "documentos contratos consultar" on storage.objects;
    drop policy if exists "documentos contratos cargar" on storage.objects;
    if exists (select 1 from storage.objects where bucket_id in ('plantillas-contratos', 'documentos-contratos')) then
      raise exception 'Hay archivos en los buckets contractuales: no se revierte.';
    end if;
    delete from storage.buckets where id in ('plantillas-contratos', 'documentos-contratos');
  end if;
end $$;

drop function if exists public.contratos_documento_anular(uuid, text);
drop function if exists public.contratos_documento_validar_firma(uuid, text);
drop function if exists public.contratos_documento_adjuntar_firmado(uuid, jsonb, date, text);
drop function if exists public.contratos_documento_emitir(uuid, text);
drop function if exists public.contratos_documento_registrar(uuid, uuid, jsonb, jsonb, jsonb, jsonb, text);
drop function if exists public.contratos_faltantes(uuid, jsonb);
drop function if exists public.contratos_datos_documento(uuid, jsonb);
drop function if exists public.contratos_comprador_principal_guardar(uuid, jsonb, text);
drop function if exists public.contratos_comprador_retirar(uuid, text);
drop function if exists public.contratos_comprador_guardar(uuid, uuid, jsonb, text);
drop function if exists public.contratos_plantilla_retirar(uuid, text);
drop function if exists public.contratos_plantilla_aprobar(uuid, text);
drop function if exists public.contratos_plantilla_guardar(uuid, uuid, jsonb, text);
drop function if exists public.contratos_plantilla_validar_variables(jsonb);
drop function if exists public.contratos_entidad_guardar(jsonb, text);
drop function if exists public.contratos_doc_tomar(uuid);
drop function if exists public.contratos_plantilla_evento(uuid, text, text);
drop function if exists public.contratos_doc_evento(uuid, uuid, text, text, jsonb);
drop function if exists public.contratos_doc_motivo(text);
drop function if exists public.contratos_doc_nombre();
drop function if exists public.contratos_doc_requiere(text);

drop table public.contract_document_events;
drop table public.contract_document_versions;
drop table public.contract_buyers;
drop table public.contract_template_events;
drop table public.contract_templates;
drop table public.entidad_vendedora;
drop table public.contract_fields;

drop function if exists public.contratos_documento_proteger();
drop function if exists public.contratos_plantilla_proteger();
drop function if exists public.contratos_doc_sin_borrado();

alter table public.clients drop constraint if exists clients_estado_civil_valido;
alter table public.clients drop column if exists domicilio;
alter table public.clients drop column if exists ciudad;
alter table public.clients drop column if exists estado_civil;
alter table public.clients drop column if exists nacionalidad;

delete from public.user_permission_overrides where permiso in ('ventas.plantillas_ver', 'ventas.plantillas', 'ventas.plantillas_aprobar', 'ventas.documentos_ver', 'ventas.documentos_generar', 'ventas.documentos_emitir', 'ventas.datos_comprador');
delete from public.role_permissions where permiso in ('ventas.plantillas_ver', 'ventas.plantillas', 'ventas.plantillas_aprobar', 'ventas.documentos_ver', 'ventas.documentos_generar', 'ventas.documentos_emitir', 'ventas.datos_comprador');
delete from public.permissions where clave in ('ventas.plantillas_ver', 'ventas.plantillas', 'ventas.plantillas_aprobar', 'ventas.documentos_ver', 'ventas.documentos_generar', 'ventas.documentos_emitir', 'ventas.datos_comprador');

commit;
