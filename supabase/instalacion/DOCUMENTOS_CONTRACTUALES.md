# Documentos contractuales: verificación, respaldo y recuperación

Migración: `migrations/20261031130000_documentos_contractuales.sql`. Es aditiva y no depende de otras migraciones pendientes.

## 1. Comprobar qué hay en producción (solo lectura)

En **SQL Editor**:

```sql
select id, public, file_size_limit from storage.buckets where id in ('plantillas-contratos', 'documentos-contratos');
select policyname from pg_policies where schemaname = 'storage' and policyname like '%contratos%' order by 1;
select count(*) as campos from public.contract_fields;
select count(*) as permisos from public.role_permissions
 where permiso in ('ventas.plantillas_ver','ventas.plantillas','ventas.plantillas_aprobar','ventas.documentos_ver','ventas.documentos_generar','ventas.documentos_emitir','ventas.datos_comprador');
```

Resultado correcto: 2 buckets con `public = false`, 4 políticas, 47 campos y 17 permisos (si no se editaron los roles).

Después ejecuta `instalacion/verificar_despliegue.sql`: no debe aparecer ningún `FALTA` ni `DISTINTO` de `contract_*`, `contratos_*`, `entidad_vendedora` o `clients.*`.

Si algo no coincide, la migración quedó incompleta o es de otra versión. Ejecuta primero el respaldo (paso 2) y luego el archivo completo, que se puede repetir sin cambiar datos.

## 2. Respaldo verificado

PostgreSQL 18 ya está instalado. En una carpeta fuera del repositorio:

```powershell
$env:Path = "C:\Program Files\PostgreSQL\18\bin;$env:Path"
powershell -ExecutionPolicy Bypass -File "D:\Empresas\NUVAREL\App NUVAREL\scripts\respaldo-produccion.ps1" -Servidor <host del Session pooler>
```

Solo cuenta si termina con **RESPALDO VERIFICADO**. No incluye archivos de Storage: descarga además el contenido de `plantillas-contratos` y `documentos-contratos` si ya tienen archivos.

## 3. Primeras comprobaciones desde `/ventas`

1. Legal: **Plantillas y formatos** → completar la **Entidad vendedora**.
2. Legal: **Subir Word** → revisar los campos detectados → guardar → **Vista previa** → **Aprobar**.
3. En un contrato autorizado: **Generar documento** → completar lo que falte → vista previa → generar.
4. Abrir el **PDF** y el **Word** descargados.
5. Gerencia: **Autorizar emisión**. Legal: **Adjuntar firmado** y **Validar firma**.

Etiquetas para el Word: `{comprador.nombre}`, `{unidad.departamento}`, `{precio.total}`, `{precio.total_letras}`, `{vendedora.razon_social}`. Para repetir: `{#pago.cuotas}{numero} {vencimiento} {monto}{/pago.cuotas}`, `{#compradores}{nombre}{/compradores}`, `{#apoderados}{nombre} {poder_detalle}{/apoderados}`. Una etiqueta que no sea del catálogo se pide al generar.

### Cómo sale el PDF

El PDF se arma en el navegador leyendo el Word lleno: tamaño de página, márgenes, estilos, numeración automática, negritas parciales, sangrías, tabulaciones, tablas combinadas, encabezados, pies, «Página X de Y» e imágenes PNG o JPG. No agrega logotipo ni textos que el Word no tenga.

- **Exacto en medidas:** Arial, Times New Roman y Courier New. Otras fuentes, como Calibri, se reemplazan por una equivalente de ancho ajustado.
- **Puede variar:** el corte de alguna línea justificada. El **Word descargado** conserva siempre el formato original.
- **No se pasa al PDF:** notas al pie, formas, objetos incrustados, varias columnas e imágenes EMF. Si el modelo los usa, la vista previa lo avisa antes de generar.

## 4. Recuperación

- **Si el módulo aún no tiene información:** ejecuta `instalacion/revertir_documentos_contractuales.sql`. Deja la base como estaba (probado) y se niega a actuar si ya hay plantillas, documentos, datos legales o archivos.
- **Si ya tiene información:** no se revierte. Se corrige con un cambio nuevo o, como último recurso, se restaura el respaldo.
- **Si falla solo la aplicación:** se vuelve a publicar la versión anterior; las tablas nuevas no afectan a las pantallas existentes.
