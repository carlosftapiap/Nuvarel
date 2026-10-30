-- AMURA · Carga inicial del Plan de implementación desde Gantt_AMURA.xlsx (hoja "1 TRABAJAR AQUI").
-- Generado por src/features/plan/cargaSql.ts. No editar a mano: vuelve a generarlo si cambia el Excel.
-- NO SE EJECUTA AUTOMÁTICAMENTE. Requisitos: migraciones hasta 20261029020000_plan_implementacion.sql, seed_roles.sql
-- y un administrador activo (supabase/instalacion/primer_administrador.sql).
-- Cómo usarlo: escribe el correo del administrador en v_email y ejecuta todo el archivo en el SQL Editor.
--
-- Qué hace (idempotente: puede ejecutarse dos veces sin duplicar):
--   · Plan PLAN-AMURA (proyecto AMURA) con fecha de corte 2026-10-27 (hoja "5 Ajustes", B5).
--   · Seis frentes sin peso: Comercial, Marketing, Legal, Tecnología, Finanzas y Construcción (avance "Incompleto" hasta definir pesos).
--   · 14 fases = grupos originales del Excel, sin frente asignado (se asignan después en Configuración del plan).
--   · 147 actividades. Sin pesos. Responsables como texto (sin vincular a usuarios). Fechas originales como línea base y vigentes.
--   · "Completado" y "Por validar" quedan en ejecución (al avance del archivo): cerrar exige fecha real de fin y evidencias en la app.
--   · 142 dependencias fin a inicio y 5 evidencias (enlaces).
--   · No borra ni modifica actividades que ya existan con el mismo código.
--
-- Dependencias para revisar (la sucesora empieza el mismo día o antes del fin de la predecesora). No se cambian:
--   D02 empieza el 2026-10-27, antes de que termine D01 (2026-10-28).
--   D03 empieza el 2026-10-27, antes de que termine D01 (2026-10-28).
--   P01 empieza el 2026-10-27, antes de que termine D04 (2026-10-27).
--   P02 empieza el 2026-10-27, antes de que termine D06 (2026-10-27).
--   P03 empieza el 2026-10-28, antes de que termine P01 (2026-10-29).
--   P05 empieza el 2026-10-31, antes de que termine P04 (2026-11-02).
--   P08 empieza el 2026-10-31, antes de que termine P06 (2026-11-02).
--   L01 empieza el 2026-10-27, antes de que termine D07 (2026-10-27).
--   L02 empieza el 2026-10-27, antes de que termine D06 (2026-10-27).
--   L03 empieza el 2026-10-27, antes de que termine L01 (2026-10-31).
--   L04 empieza el 2026-10-30, antes de que termine L01 (2026-10-31).
--   L05 empieza el 2026-10-31, antes de que termine L03 (2026-11-03).
--   L06 empieza el 2026-11-01, antes de que termine L05 (2026-11-05).
--   L07 empieza el 2026-10-29, antes de que termine L01 (2026-10-31).
--   L09 empieza el 2026-11-01, antes de que termine L04 (2026-11-03).
--   L10 empieza el 2026-11-02, antes de que termine L05 (2026-11-05).
--   F01 empieza el 2026-10-27, antes de que termine D04 (2026-10-27).
--   F02 empieza el 2026-10-29, antes de que termine P01 (2026-10-29).
--   F03 empieza el 2026-11-02, antes de que termine F02 (2026-11-02).
--   F05 empieza el 2026-10-31, antes de que termine L05 (2026-11-05).
--   F06 empieza el 2026-10-31, antes de que termine L03 (2026-11-03).
--   F07 empieza el 2026-10-30, antes de que termine F02 (2026-11-02).
--   F08 empieza el 2026-11-02, antes de que termine F07 (2026-11-03).
--   F09 empieza el 2026-11-01, antes de que termine P09 (2026-11-02).
--   F10 empieza el 2026-11-05, antes de que termine F09 (2026-11-06).
--   F11 empieza el 2026-11-05, antes de que termine F08 (2026-11-05).
--   F12 empieza el 2026-10-31, antes de que termine L04 (2026-11-03).
--   F13 empieza el 2026-11-04, antes de que termine F12 (2026-11-05).
--   B01 empieza el 2026-10-29, antes de que termine L04 (2026-11-03).
--   B04 empieza el 2026-11-04, antes de que termine B03 (2026-11-06).
--   B05 empieza el 2026-11-04, antes de que termine F12 (2026-11-05).
--   M02 empieza el 2026-10-30, antes de que termine M01 (2026-10-31).
--   M03 empieza el 2026-11-03, antes de que termine P05 (2026-11-03).
--   M05 empieza el 2026-11-02, antes de que termine P05 (2026-11-03).
--   M08 empieza el 2026-11-04, antes de que termine P10 (2026-11-05).
--   M11 empieza el 2026-11-11, antes de que termine M09 (2026-11-12).
--   M14 empieza el 2026-11-19, antes de que termine M12 (2026-11-21).
--   O01 empieza el 2026-10-28, antes de que termine D01 (2026-10-28).
--   O02 empieza el 2026-10-30, antes de que termine O01 (2026-10-30).
--   O06 empieza el 2026-11-14, antes de que termine O04 (2026-11-16).
--   O11 empieza el 2026-11-20, antes de que termine M12 (2026-11-21).
--   C03 empieza el 2026-11-05, antes de que termine C02 (2026-11-07).
--   C08 empieza el 2026-11-10, antes de que termine C07 (2026-11-12).
--   A02 empieza el 2026-11-04, antes de que termine L08 (2026-11-04).
--   A03 empieza el 2026-11-11, antes de que termine C06 (2026-11-12).
--   E01 empieza el 2026-11-01, antes de que termine P09 (2026-11-02).
--   E06 empieza el 2026-11-16, antes de que termine M13 (2026-11-18).
--   H06 empieza el 2026-11-22, antes de que termine O12 (2026-11-23).
--   R06 empieza el 2026-12-11, antes de que termine R02 (2027-01-24).
--   R07 empieza el 2026-12-25, antes de que termine R04 (2026-12-25).

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
  values ('AMURA', 'PLAN-AMURA', 'Plan de implementación AMURA', '2026-10-27', v_admin)
  on conflict (project_id, codigo) do nothing;
  select id into v_plan from public.plan_plans where project_id = 'AMURA' and codigo = 'PLAN-AMURA';

  insert into public.plan_frentes (plan_id, codigo, nombre, orden) values
    (v_plan, 'COM', 'Comercial', 1), (v_plan, 'MKT', 'Marketing', 2), (v_plan, 'LEG', 'Legal', 3),
    (v_plan, 'TEC', 'Tecnología', 4), (v_plan, 'FIN', 'Finanzas', 5), (v_plan, 'CON', 'Construcción', 6)
  on conflict (plan_id, codigo) do nothing;

  insert into public.plan_fases (plan_id, codigo, nombre, orden) values
    (v_plan, '01', 'Dirección y expediente', 1),
    (v_plan, '02', 'Producto y especificaciones', 2),
    (v_plan, '03', 'Legal y cumplimiento', 3),
    (v_plan, '04', 'Precios y financiamiento', 4),
    (v_plan, '05', 'Bróker y gestión comercial', 5),
    (v_plan, '06', 'Marca y materiales', 6),
    (v_plan, '07', 'Oficina y sala de ventas', 7),
    (v_plan, '08', 'CRM y operación de leads', 8),
    (v_plan, '09', 'Canales y marketing', 9),
    (v_plan, '10', 'Evento primera piedra', 10),
    (v_plan, '11', 'Habilitación y lanzamiento', 11),
    (v_plan, '12', 'Piloto y optimización 90 días', 12),
    (v_plan, '13', 'Gestión comercial de 12 meses', 13),
    (v_plan, '14', 'Obra, escrituración y postventa', 14)
  on conflict (plan_id, codigo) do nothing;

  insert into public.plan_activities (plan_id, codigo, nombre, descripcion, resultado_esperado, tipo, fase_id, frente_id, responsable_texto, aprobador_texto,
                                      base_inicio, base_fin, plan_inicio, plan_fin, avance, estado, bloquea_lanzamiento, observaciones, fuente, created_by, updated_by)
  select v_plan, x.codigo, x.nombre, x.descripcion, x.resultado, x.tipo, f.id, f.frente_id, x.responsable, x.aprobador,
         x.inicio::date, x.fin::date, x.inicio::date, x.fin::date, x.avance::numeric, x.estado, x.bloquea::boolean, x.observaciones, x.fuente, v_admin, v_admin
  from (values
    ('D01', 'Confirmar alcance, nombre AMURA y estructura del proyecto', 'Reunir a quienes dirigen AMURA y dejar por escrito qué incluye el proyecto: ubicación, edificios, etapas y productos que se venderán. Confirmar qué hace Jarval y qué relación tiene Nuvarel, para que todos trabajen con la misma información.', 'Acta con nombre, promotor, ubicación, usos y etapas', 'actividad', '01', 'Carlos Tapia', 'Comité Comercial', '2026-10-27', '2026-10-28', 0, 'pendiente', true, 'Usar AMURA. Jarval es desarrolladora. Verificar papel jurídico de Nuvarel.', 'CONV; MAN 12.3'),
    ('D02', 'Asignar responsables, aprobadores y calendario de comités', 'Escribir quién realiza cada trabajo, quién lo revisa y quién puede aprobarlo. Definir cada cuánto se reúne el Comité Comercial, cómo se solicita una decisión y quién reemplaza al responsable si no está disponible.', 'Matriz de responsables y delegaciones firmadas', 'actividad', '01', 'Carlos Tapia', 'Comité Comercial', '2026-10-27', '2026-10-28', 0, 'pendiente', true, '', 'CONV; MAN 2, 10'),
    ('D03', 'Crear expediente único y registro de datos por confirmar', 'Organizar una carpeta compartida con documentos legales, planos, inventario, precios, marca y actas. Cada archivo debe tener versión y responsable; llevar una lista separada de datos faltantes, con la persona que debe conseguirlos.', 'Carpeta con versiones, fuente, responsable, estado y vencimiento', 'actividad', '01', 'Área Comercial', 'Comité Comercial', '2026-10-27', '2026-10-29', 0, 'pendiente', true, '', 'MAN 12.3–12.5'),
    ('D04', 'Localizar inventario y lista inicial de precios existentes', 'Encontrar el archivo donde aparecen las unidades y los precios iniciales, guardar su enlace y confirmar quién lo administra. Esta tarea solo significa que el archivo fue encontrado; revisar y aprobar sus cifras corresponde a otras actividades.', 'Archivo INV localizado en la carpeta Nuvarel', 'actividad', '01', 'Carlos Tapia', 'Comité Comercial', '2026-10-27', '2026-10-27', 100, 'en_ejecucion', false, 'Completado solo significa localización del archivo. Falta aprobar sus datos.', 'INV'),
    ('D05', 'Localizar Brand Book y Brand Key existentes', 'Ubicar el manual de marca y el documento de posicionamiento de AMURA. Guardar los archivos originales para que diseño y marketing revisen lo existente antes de contratar nuevas piezas o cambiar la identidad.', 'Archivos MAR1 y MAR2 localizados', 'actividad', '01', 'Área Comercial', 'Comité Comercial', '2026-10-27', '2026-10-27', 100, 'en_ejecucion', false, 'Pendiente validar contenido, versión y aprobación.', 'MAR1; MAR2'),
    ('D06', 'Localizar archivos técnicos de edificios y áreas comunes', 'Reunir los archivos de los dos edificios, club, garita y urbanismo. Identificar autor y versión. Encontrar un plano o presentación no demuestra que esté aprobado ni que pueda incorporarse a contratos.', 'Archivos TEC1, TEC2 y TEC3 localizados', 'actividad', '01', 'Juan Carlos Páez', 'Dirección técnica', '2026-10-27', '2026-10-27', 100, 'en_ejecucion', false, 'No certifica aprobación municipal ni contractual.', 'TEC1; TEC2; TEC3'),
    ('D07', 'Localizar documentación societaria de Nuvarel', 'Reunir constitución, identificación tributaria y documentos de representación de Nuvarel. Entregarlos a la asesoría legal para comprobar vigencia y relación con AMURA; la localización por sí sola no valida facultades para vender.', 'Documentos societarios LEG localizados', 'actividad', '01', 'Juan Carlos Páez', 'Asesoría legal', '2026-10-27', '2026-10-27', 100, 'en_ejecucion', false, 'Falta validar vigencia, representación y rol en AMURA.', 'LEG'),
    ('D08', 'Validar inventario vendible y meta comercial de 12 meses', 'Contar qué unidades realmente pueden comercializarse, separarlas por edificio y tipología, y contrastarlas con la meta de ventas. Revisar si la referencia de 70 unidades en 12 meses es viable y solicitar aprobación de la meta.', 'Meta por unidad, tipología y canal aprobada', 'actividad', '01', 'Área Comercial', 'Comité Comercial', '2026-10-28', '2026-10-31', 0, 'pendiente', true, '70 unidades / 12 meses es referencia de la conversación, pendiente de validación.', 'CONV; MAN 10, 12.2'),
    ('P01', 'Definir nomenclatura única de torre, piso y unidad', 'Asignar un código único a cada apartamento, parqueo, bodega y adicional. Usar esos mismos códigos en inventario, precios, cotizaciones y contratos para evitar que una unidad se publique o reserve dos veces.', 'Inventario con códigos únicos y sin duplicados', 'actividad', '02', 'Juan Carlos Páez', 'Dirección técnica', '2026-10-27', '2026-10-29', 0, 'pendiente', true, '', 'CONV; MAN 12.3'),
    ('P02', 'Validar metrajes, tipologías, distribución y planos', 'Comparar planos y fichas para confirmar áreas privadas, balcones, áreas comunes y distribución de cada tipo de unidad. Resolver diferencias con el equipo técnico antes de usar los metrajes en publicidad o contratos.', 'Ficha oficial por tipología con áreas separadas', 'actividad', '02', 'Juan Carlos Páez', 'Dirección técnica', '2026-10-27', '2026-10-31', 0, 'pendiente', true, '', 'MAN 12.3; TEC1; TEC2'),
    ('P03', 'Confirmar parqueos, bodegas y adicionales por unidad', 'Precisar qué parqueo o bodega corresponde a cada unidad y si está incluido o se vende aparte. Documentar medidas, ubicación, restricciones y precio de los adicionales para evitar promesas distintas entre vendedores.', 'Asignación, áreas, restricciones y precios adicionales', 'actividad', '02', 'Juan Carlos Páez', 'Comité Comercial', '2026-10-28', '2026-10-31', 0, 'pendiente', true, '', 'MAN II-B; INV'),
    ('P04', 'Confirmar acabados y equipamiento de entrega', 'Listar exactamente qué recibirá el comprador: pisos, paredes, baños, cocina, instalaciones y equipos. Pedir validación técnica y separar lo incluido de lo opcional para preparar la memoria de acabados del contrato.', 'Memoria de acabados y especificaciones contractuales', 'actividad', '02', 'Juan Carlos Páez', 'Dirección técnica', '2026-10-28', '2026-11-02', 0, 'pendiente', true, '', 'MAN II-C; TEC1; TEC2'),
    ('P05', 'Delimitar renders referenciales y personalizaciones', 'Revisar las imágenes del proyecto y señalar muebles, decoración u otros elementos ilustrativos que no se entregan. Definir qué cambios puede pedir el comprador, cuánto cuestan y hasta qué momento pueden aceptarse.', 'Anexos de inclusiones, exclusiones, cambios y fechas límite', 'actividad', '02', 'Juan Carlos Páez', 'Asesoría legal', '2026-10-31', '2026-11-03', 0, 'pendiente', true, '', 'MAN II-C, 12.4'),
    ('P06', 'Validar amenities, capacidades y reglas de uso', 'Confirmar cuáles áreas y servicios comunes existen, cuándo estarán disponibles y cómo podrán usarse. Detallar capacidades, reservas, horarios y restricciones del club, accesos y seguridad, con respaldo del equipo técnico.', 'Ficha de club, accesos, seguridad y áreas comunes', 'actividad', '02', 'Juan Carlos Páez', 'Dirección técnica', '2026-10-29', '2026-11-02', 0, 'pendiente', true, '', 'MAN II-D; TEC3'),
    ('P07', 'Verificar accesibilidad, ascensores y servicios técnicos', 'Verificar accesos para personas con movilidad reducida, ascensores, abastecimiento de agua y respaldo eléctrico. Explicar qué cubre cada sistema y sus límites, para que la presentación comercial coincida con las especificaciones técnicas.', 'Especificaciones de accesibilidad, respaldo eléctrico y agua', 'actividad', '02', 'Juan Carlos Páez', 'Dirección técnica', '2026-10-29', '2026-11-02', 0, 'pendiente', true, '', 'MAN II-B–D'),
    ('P08', 'Estimar alícuotas y acordar administración inicial', 'Calcular una referencia de la cuota de administración y explicar qué gastos cubre. Definir quién administrará al inicio, desde cuándo se cobra y qué información deberá recibir el comprador antes de contratar.', 'Presupuesto de operación y reglas de cobro al comprador', 'actividad', '02', 'Administración y Finanzas', 'Comité Comercial', '2026-10-31', '2026-11-04', 0, 'pendiente', true, '', 'MAN II-D, II-I'),
    ('P09', 'Validar cronograma de obra y entregas por edificio', 'Pedir el cronograma aprobado de construcción y las condiciones de entrega de cada edificio. Identificar hitos, responsables y documentos de respaldo; los 30 y 42 meses conversados no se convierten aquí en fechas contractuales.', 'Cronograma contractual, hitos y soporte de fechas', 'actividad', '02', 'Juan Carlos Páez', 'Comité Comercial', '2026-10-28', '2026-11-02', 0, 'pendiente', true, '30 y 42 meses son referencias de pago/entrega, sin fecha base contractual confirmada.', 'CONV; MAN II-A, 12.4'),
    ('P10', 'Aprobar fichas técnicas y carpeta de confianza comercial', 'Consolidar fichas de producto, planos y respaldos en una carpeta que pueda usar el bróker. Revisar que nombres, áreas, características y fechas coincidan entre documentos, y obtener la aprobación para compartirlos.', 'Fichas, planos, permisos y respaldos consistentes', 'actividad', '02', 'Área Comercial', 'Comité Comercial', '2026-11-03', '2026-11-05', 0, 'pendiente', true, '', 'MAN 12.3–12.4'),
    ('L01', 'Validar promotor, propiedad, poderes y relación con Nuvarel', 'Solicitar al abogado que compruebe quién es propietario, quién promueve AMURA y quién puede firmar. Aclarar la relación entre Jarval y Nuvarel y dejar documentadas las facultades y restricciones de cada parte.', 'Informe jurídico con responsables y facultades de firma', 'actividad', '03', 'Asesoría legal', 'Comité Comercial', '2026-10-27', '2026-10-31', 0, 'pendiente', true, '', 'MAN 1, II-H; LEG'),
    ('L02', 'Validar permisos, PH, alícuotas y planos vigentes', 'Pedir al equipo técnico y legal la revisión de permisos, planos y régimen de propiedad horizontal, que define unidades y áreas comunes. Identificar documentos pendientes y restricciones que afecten la comercialización.', 'Carpeta legal y municipal validada por especialistas', 'actividad', '03', 'Juan Carlos Páez', 'Asesoría legal', '2026-10-27', '2026-11-03', 0, 'pendiente', true, '', 'MAN 1, II-H'),
    ('L03', 'Validar estructura fiduciaria y habilitación para preventa', 'Encargar al asesor legal la revisión del esquema fiduciario o de manejo de fondos aplicable. Obtener una conclusión documentada sobre los requisitos y autorizaciones necesarios antes de ofrecer preventa o recibir dinero.', 'Dictamen sobre esquema aplicable y autorización para comercializar', 'actividad', '03', 'Asesoría legal', 'Comité Comercial', '2026-10-27', '2026-11-03', 0, 'pendiente', true, 'Revisar exigencias vigentes con abogado antes de publicitar o captar fondos.', 'MAN 1, 12.3'),
    ('L04', 'Revisar contratos de comercialización y poderes del bróker', 'Revisar el contrato que permite al bróker comercializar AMURA. Precisar alcance, duración, representación, pagos, reportes y límites: qué puede ofrecer por su cuenta y qué debe consultar al Comité.', 'Contratos y alcance de representación firmados', 'actividad', '03', 'Asesoría legal', 'Comité Comercial', '2026-10-30', '2026-11-03', 0, 'pendiente', true, '', 'CONV; MAN 1, 6'),
    ('L05', 'Aprobar modelos de reserva, promesa y escritura', 'Preparar modelos de reserva, promesa de compraventa y escritura con sus anexos. Revisar pagos, plazos, obligaciones y firmas con el abogado, y controlar la versión que usarán todos los canales.', 'Modelos vigentes con anexos y control de versiones', 'actividad', '03', 'Asesoría legal', 'Comité Comercial', '2026-10-31', '2026-11-05', 0, 'pendiente', true, '', 'MAN 1, 3, II-F–H'),
    ('L06', 'Definir desistimientos, reembolsos y cesiones', 'Acordar qué ocurre si un comprador cancela, incumple o transfiere su posición a otra persona. Documentar requisitos, descuentos o penalidades, plazos de devolución y quién autoriza cada caso.', 'Matriz de supuestos, plazos, penalidades y autorización', 'actividad', '03', 'Asesoría legal', 'Comité Comercial', '2026-11-01', '2026-11-05', 0, 'pendiente', true, '', 'MAN II-F, II-N'),
    ('L07', 'Validar obligaciones y responsable KYC/UAFE', 'Pedir al oficial de cumplimiento que defina cómo se identifica al comprador y se verifica el origen de fondos. KYC significa conocer al cliente; las obligaciones relacionadas con UAFE deben quedar confirmadas por los especialistas.', 'Procedimiento de identificación, fondos, alertas y reportes', 'actividad', '03', 'Oficial de cumplimiento', 'Asesoría legal', '2026-10-29', '2026-11-03', 0, 'pendiente', true, 'Plazos y obligaciones deben ser confirmados por el oficial y asesor legal.', 'MAN 1'),
    ('L08', 'Aprobar privacidad, consentimientos y acceso a datos', 'Preparar los avisos de privacidad y permisos para usar datos de interesados y compradores. Definir quién accede a esos datos, para qué puede usarlos y cómo se registrará el consentimiento en formularios, eventos y CRM.', 'Avisos y consentimientos para web, eventos, CRM y aliados', 'actividad', '03', 'Asesoría legal', 'Comité Comercial', '2026-10-30', '2026-11-04', 0, 'pendiente', true, '', 'MAN 1, 7, 8'),
    ('L09', 'Validar expediente y requisitos de corredores aliados', 'Recopilar los documentos exigidos a corredores aliados y revisar sus contratos y facultades. Confirmar requisitos profesionales aplicables y reglas de uso de la marca antes de entregar materiales o permitirles captar reservas.', 'Licencias, contratos, RUC y reglas de uso de marca verificados', 'actividad', '03', 'Bróker comercial', 'Asesoría legal', '2026-11-01', '2026-11-05', 0, 'pendiente', true, '', 'MAN 4, 6'),
    ('L10', 'Definir gastos de cierre, garantías y documentación entregable', 'Explicar qué gastos corresponden a cada parte al cerrar la compra y qué documentos se entregarán. Revisar con el abogado las garantías, condiciones y respaldos que se comunicarán al comprador.', 'Guía validada de gastos, garantías y evidencia entregable', 'actividad', '03', 'Asesoría legal', 'Comité Comercial', '2026-11-02', '2026-11-06', 0, 'pendiente', true, '', 'MAN 3.7, II-H–I'),
    ('F01', 'Actualizar comparables y criterio de precio por m²', 'Comparar AMURA con proyectos realmente similares en ubicación, áreas, equipamiento y condiciones de pago. Actualizar los precios por metro cuadrado y explicar los ajustes antes de recomendar valores al Comité.', 'Comparables homogéneos y recomendación por tipología', 'actividad', '04', 'Área Comercial', 'Comité Comercial', '2026-10-27', '2026-10-30', 0, 'pendiente', true, 'Actualizar las referencias del manual antes de usarlas con clientes.', 'MAN III, 12.3'),
    ('F02', 'Construir matriz de precios, pisos, vistas y adicionales', 'Preparar una tabla de precios por unidad, considerando piso, vista, tamaño, parqueo y bodega. Especificar inclusiones, impuestos y ajustes para que el precio cotizado pueda comprobarse con el inventario.', 'Matriz por código con inclusiones, impuestos y ajustes', 'actividad', '04', 'Área Comercial', 'Comité Comercial', '2026-10-29', '2026-11-02', 0, 'pendiente', true, '', 'MAN II-E; INV'),
    ('F03', 'Aprobar lista, vigencia y cambios de precio', 'Presentar la lista de precios al Comité para aprobación. Registrar fecha de vigencia, versión y reglas para cotizaciones anteriores; distribuir una sola lista oficial a todos los vendedores y canales.', 'Lista firmada, vigencia y tratamiento de cotizaciones anteriores', 'actividad', '04', 'Área Comercial', 'Comité Comercial', '2026-11-02', '2026-11-03', 0, 'pendiente', true, '', 'CONV; MAN 3, 12.3'),
    ('F04', 'Aprobar descuentos, promociones y autorizaciones', 'Definir qué descuentos o beneficios pueden ofrecerse, en qué casos y con qué límites. Establecer quién los aprueba y cómo se documentan, para evitar que cada corredor negocie condiciones diferentes.', 'Escalera y topes de descuentos y beneficios documentados', 'actividad', '04', 'Área Comercial', 'Comité Comercial', '2026-10-31', '2026-11-04', 0, 'pendiente', true, '', 'CONV; MAN 5'),
    ('F05', 'Definir valor, vigencia y medios de pago de reserva', 'Acordar cuánto debe pagar un interesado para reservar, cuánto dura la reserva y qué medios de pago se aceptan. Vincular estas reglas con el bloqueo de la unidad y los documentos aprobados por legal.', 'Política de reserva y bloqueo de inventario aprobada', 'actividad', '04', 'Área Comercial', 'Comité Comercial', '2026-10-31', '2026-11-03', 0, 'pendiente', true, '', 'MAN 3, II-F'),
    ('F06', 'Validar cuentas oficiales y conciliación de cobros', 'Verificar las cuentas bancarias autorizadas para recibir pagos y cómo se validan los comprobantes. Definir quién compara diariamente depósitos, compradores y unidades para identificar diferencias o pagos sin registrar.', 'Cuentas verificadas, comprobantes y conciliación definidos', 'actividad', '04', 'Administración y Finanzas', 'Comité Comercial', '2026-10-31', '2026-11-03', 0, 'pendiente', true, '', 'MAN 1, II-F'),
    ('F07', 'Formalizar entrada 20%, firma 6% y saldo 14%', 'Documentar con ejemplos la propuesta de entrada: 20% en total, compuesto por 6% a la firma y 14% en cuotas. Separar las condiciones por edificio y obtener aprobación comercial, financiera y contractual.', 'Esquema de pago por edificio y unidad aprobado', 'actividad', '04', 'Área Comercial', 'Comité Comercial', '2026-10-30', '2026-11-03', 0, 'pendiente', true, 'El 6% está incluido en el 20%. El 14% se distribuye en 30/42 meses según edificio. Confirmar contra contrato.', 'CONV; MAN II-G'),
    ('F08', 'Definir cuotas por edificio, anticipos y crédito directo', 'Convertir el saldo de la entrada en un calendario de cuotas por edificio. Definir vencimientos, anticipos, pagos extraordinarios y condiciones de crédito directo, verificando que los totales coincidan con el contrato.', 'Calendarios de cuotas y reglas de abonos/crédito directo', 'actividad', '04', 'Administración y Finanzas', 'Comité Comercial', '2026-11-02', '2026-11-05', 0, 'pendiente', true, '', 'CONV; MAN II-G'),
    ('F09', 'Validar rutas bancarias, BIESS y requisitos por producto', 'Consultar con entidades financieras las opciones reales de crédito, incluido BIESS cuando aplique. Confirmar requisitos del proyecto y del comprador, restricciones y contactos; no anunciar una opción sin verificar que esté disponible.', 'Convenios, requisitos, elegibilidad y restricciones confirmados', 'actividad', '04', 'Bróker comercial', 'Administración y Finanzas', '2026-11-01', '2026-11-06', 0, 'pendiente', true, '', 'MAN 3.6, II-G'),
    ('F10', 'Preparar precalificación financiera del comprador', 'Crear una lista sencilla de ingresos, documentos y condiciones para evaluar si el comprador puede financiarse. Definir quién solicita los soportes, revisa cada caso y acompaña la gestión con la entidad financiera.', 'Checklist de ingresos, soportes y responsables de seguimiento', 'actividad', '04', 'Bróker comercial', 'Administración y Finanzas', '2026-11-05', '2026-11-08', 0, 'pendiente', true, '', 'MAN 3.6'),
    ('F11', 'Crear y probar cotizador y simulador oficial', 'Preparar una herramienta oficial que calcule precio, reserva, entrada, cuotas y saldo final por unidad. Probar varios casos y revisar sumas y redondeos antes de entregarla al bróker o publicarla.', 'Simulador con pruebas de reserva, cuotas y saldo de entrega', 'actividad', '04', 'Carlos Tapia', 'Comité Comercial', '2026-11-05', '2026-11-09', 0, 'pendiente', true, '', 'CONV; MAN 3, 8'),
    ('F12', 'Aprobar honorario, comisiones, margen mínimo y bonos', 'Calcular cuánto se cobra y cómo se reparte entre desarrolladora, bróker, corredores y otros participantes. Comprobar el margen por venta y definir bonos y aprobaciones para que no se pague dos veces por el mismo concepto.', 'Modelo con una base de reparto y margen por operación', 'actividad', '04', 'Área Comercial', 'Comité Comercial', '2026-10-31', '2026-11-05', 0, 'pendiente', true, 'Revisar economía de la operación con Administración antes de firmar.', 'MAN 4, 12.2–12.6'),
    ('F13', 'Definir liquidación, clawback, facturas e impuestos', 'Definir cuándo se liquida y paga cada comisión, qué factura se requiere y qué pasa si la venta se cancela. Clawback significa recuperar una comisión cuando corresponde según el contrato aprobado.', 'Procedimiento de pago sujeto a hito y honorario cobrado', 'actividad', '04', 'Administración y Finanzas', 'Comité Comercial', '2026-11-04', '2026-11-07', 0, 'pendiente', true, '', 'MAN 4.4'),
    ('B01', 'Contratar al bróker y definir reportes a AMURA', 'Acordar y firmar la contratación del bróker que coordinará la comercialización. Precisar metas, canales, facultades, honorarios y reportes a AMURA; asignar una persona de contacto para el seguimiento.', 'Contrato con metas, facultades, honorarios y reportes', 'actividad', '05', 'Área Comercial', 'Comité Comercial', '2026-10-29', '2026-11-02', 0, 'pendiente', true, 'Century 21 y corredores externos se coordinan a través del bróker comercial.', 'CONV'),
    ('B02', 'Formalizar la coordinación de Century 21 y corredores', 'Definir cómo trabajarán Century 21 y los corredores externos bajo coordinación del bróker. Acordar entrega de materiales, registro de interesados, reportes, reglas comerciales y canal para resolver dudas.', 'Acuerdos de canales, registro de leads y reportes', 'actividad', '05', 'Bróker comercial', 'Comité Comercial', '2026-11-03', '2026-11-06', 0, 'pendiente', true, '', 'CONV; MAN 6'),
    ('B03', 'Aprobar atribución, duplicados y protección de leads', 'Decidir a quién corresponde un interesado cuando llega por varios corredores o canales. Definir duplicados, familiares, empresas, plazo de protección y reactivación para resolver conflictos con una regla conocida.', 'Reglas de cónyuges, familia, empresas y reactivación', 'actividad', '05', 'Bróker comercial', 'Comité Comercial', '2026-11-03', '2026-11-06', 0, 'pendiente', true, '', 'MAN 4.3, II-N'),
    ('B04', 'Definir registro de prospectos y resolución de disputas', 'Crear un procedimiento para registrar interesados con fecha, canal y corredor responsable. Establecer qué evidencia se revisa si dos vendedores reclaman el mismo contacto y quién toma la decisión final.', 'Formulario de registro y responsable de resolver disputas', 'actividad', '05', 'Bróker comercial', 'Comité Comercial', '2026-11-04', '2026-11-07', 0, 'pendiente', true, '', 'MAN 4.3, 6.2'),
    ('B05', 'Definir referidos, captadores y coexistencia de comisiones', 'Acordar cómo se reconoce y paga a quien recomienda un comprador o aporta un contacto. Precisar requisitos y límites, y evitar que referidos y corredores cobren conceptos incompatibles por la misma venta.', 'Reglas de elegibilidad, bolsa de pago y casos duplicados', 'actividad', '05', 'Área Comercial', 'Comité Comercial', '2026-11-04', '2026-11-07', 0, 'pendiente', true, '', 'MAN 4, 6'),
    ('B06', 'Asignar turnos, cobertura y SLA de atención', 'Asignar horarios, turnos, reemplazos y responsables de responder consultas y visitas. SLA es el tiempo de atención acordado; fijar cómo se medirá y qué ocurre si el responsable no responde.', 'Roles, horarios, respaldo y asignación de leads', 'actividad', '05', 'Bróker comercial', 'Área Comercial', '2026-11-06', '2026-11-08', 0, 'pendiente', true, '', 'MAN 2, 3'),
    ('B07', 'Preparar guiones, objeciones y presentación por segmento', 'Preparar una presentación y guías para hablar con distintos tipos de compradores. Incluir preguntas frecuentes y respuestas a objeciones sobre precio, pagos, producto y confianza, usando únicamente información respaldada.', 'Manual de venta, respuestas respaldadas y límites de promesa', 'actividad', '05', 'Bróker comercial', 'Área Comercial', '2026-11-08', '2026-11-13', 0, 'pendiente', true, '', 'MAN 3, IV'),
    ('B08', 'Capacitar corredores de todos los canales', 'Realizar sesiones de formación para los corredores sobre AMURA, precios, pagos, documentos y uso del CRM. Registrar asistencia y comprobar comprensión con ejercicios; programar la fecha antes de habilitar ventas.', 'Asistencia y evaluación de producto, pagos, CRM y objeciones', 'actividad', '05', 'Bróker comercial', 'Área Comercial', null, null, 0, 'pendiente', true, 'Sin fecha por acuerdo. Programar antes de habilitar ventas.', 'CONV; MAN 2'),
    ('B09', 'Evaluar equipo y ejecutar simulación comercial completa', 'Hacer una venta simulada completa con el equipo: recibir un contacto, cotizar, agendar, reservar y registrar el pago. Revisar también la atribución y comisión; corregir errores y repetir los puntos que fallen.', 'Simulación desde lead hasta reserva/cobro y liquidación', 'actividad', '05', 'Bróker comercial', 'Comité Comercial', null, null, 0, 'pendiente', true, 'Se fija fecha después de programar la capacitación.', 'MAN 3.9, 11'),
    ('M01', 'Auditar Brand Book y Brand Key antes de diseñar', 'Revisar el Brand Book, que contiene reglas gráficas, y el Brand Key, que define el posicionamiento. Separar piezas utilizables, pendientes de aprobación y faltantes para contratar solo el trabajo necesario.', 'Inventario de piezas vigentes, aprobadas y faltantes', 'actividad', '06', 'Área Comercial', 'Comité Comercial', '2026-10-28', '2026-10-31', 0, 'en_ejecucion', true, 'Archivos existentes no significan marca ni piezas aprobadas.', 'CONV; MAR1; MAR2'),
    ('M02', 'Definir segmentos, diferenciadores y mensajes de AMURA', 'Definir a qué compradores se dirige AMURA y qué ventajas comprobables se les comunicarán. Preparar un resumen de mensajes por segmento, con respaldo de atributos y sin promesas que el proyecto no pueda sostener.', 'Brief comercial por segmento con evidencia de atributos', 'actividad', '06', 'Área Comercial', 'Comité Comercial', '2026-10-30', '2026-11-02', 0, 'pendiente', true, '', 'CONV; MAN III–IV'),
    ('M03', 'Aprobar piezas, derechos, renders y afirmaciones permitidas', 'Revisar cada pieza comercial con diseño, técnico y legal según corresponda. Comprobar permisos de uso de imágenes y textos, aclaraciones de renders y afirmaciones permitidas antes de autorizar publicación.', 'Checklist de revisión técnica, legal y de marca', 'actividad', '06', 'Área Comercial', 'Comité Comercial', '2026-11-03', '2026-11-05', 0, 'pendiente', true, '', 'MAN 12.4'),
    ('M04', 'Producir o actualizar planos comerciales y fichas', 'Transformar los planos técnicos validados en planos y fichas fáciles de leer por el comprador. Mantener códigos, áreas, distribución e inclusiones correctos y registrar la versión aprobada de cada pieza.', 'Fichas y planos con versión, metrajes e inclusiones', 'actividad', '06', 'Juan Carlos Páez', 'Dirección técnica', '2026-11-02', '2026-11-08', 0, 'pendiente', true, '', 'CONV; TEC1; TEC2'),
    ('M05', 'Actualizar renders, fotografías y recorrido virtual', 'Actualizar imágenes, fotos y recorrido digital para explicar el proyecto de forma coherente. Separar material real de representaciones ilustrativas y confirmar permisos de uso y aprobación de cada archivo.', 'Banco audiovisual aprobado y con usos autorizados', 'actividad', '06', 'Juan Carlos Páez', 'Área Comercial', '2026-11-02', '2026-11-09', 0, 'pendiente', false, '', 'CONV; MAN 7'),
    ('M06', 'Cotizar y decidir maqueta física o recorrido virtual', 'Pedir propuestas comparables de maqueta física y recorrido virtual, incluyendo precio y plazo. Evaluar espacio, transporte y utilidad comercial, y aprobar una alternativa digital si la maqueta no llega a tiempo.', 'Cotizaciones, presupuesto, formato y plazo aprobados', 'actividad', '06', 'Juan Carlos Páez', 'Comité Comercial', '2026-11-01', '2026-11-07', 0, 'pendiente', false, 'Si la maqueta no llega al lanzamiento, aprobar alternativa digital.', 'CONV'),
    ('M07', 'Producir maqueta o alternativa de exhibición aprobada', 'Encargar la maqueta o recorrido elegido y revisar avances contra los planos oficiales. Comprobar escalas, unidades y áreas comunes, y recibir una versión lista para exhibición con instrucciones de uso.', 'Maqueta/recorrido revisado contra planos oficiales', 'actividad', '06', 'Proveedor de diseño', 'Juan Carlos Páez', '2026-11-08', '2026-11-19', 0, 'pendiente', false, '', 'CONV'),
    ('M08', 'Elaborar libro oficial del proyecto AMURA', 'Preparar un documento completo para presentar AMURA: concepto, ubicación, producto, áreas comunes, pagos y respaldo. Integrar la información técnica de Juan Carlos Páez y obtener revisión comercial antes de distribuirlo.', 'Libro comercial con producto, pagos, respaldo y preguntas frecuentes', 'actividad', '06', 'Área Comercial', 'Comité Comercial', '2026-11-04', '2026-11-11', 0, 'pendiente', true, 'Juan Carlos Páez entrega información técnica. Área Comercial prepara.', 'CONV'),
    ('M09', 'Diseñar brochure, carpeta, fichas y cotización impresa', 'Diseñar los materiales que se entregarán al comprador: brochure, carpeta, fichas y formato de cotización. Revisar textos, datos, imágenes y precios para que todas las piezas cuenten la misma información.', 'Artes finales coherentes con lista y fichas aprobadas', 'actividad', '06', 'Área Comercial', 'Comité Comercial', '2026-11-06', '2026-11-12', 0, 'pendiente', true, '', 'CONV'),
    ('M10', 'Preparar lista de precios impresa con vigencia', 'Preparar la versión impresa de la lista de precios aprobada. Mostrar códigos, inclusiones, fecha y vigencia; definir quién retira las copias anteriores cuando se publique una nueva versión.', 'Lista impresa con versión y fecha de vigencia', 'actividad', '06', 'Área Comercial', 'Comité Comercial', '2026-11-06', '2026-11-08', 0, 'pendiente', true, '', 'CONV'),
    ('M11', 'Cotizar y contratar imprenta y piezas de exhibición', 'Solicitar propuestas de impresión comparables en cantidades, papel, acabados, calidad y entrega. Revisar muestras, aprobar el proveedor y emitir la orden de producción de las piezas autorizadas.', 'Propuestas comparables, muestras y orden de producción', 'actividad', '06', 'Área Comercial', 'Comité Comercial', '2026-11-11', '2026-11-15', 0, 'pendiente', false, '', 'CONV'),
    ('M12', 'Imprimir y verificar materiales de venta', 'Recibir los materiales impresos y comparar una muestra con el arte aprobado. Revisar nombres, áreas, precios, colores y cantidades; registrar errores y exigir corrección antes de repartirlos a los vendedores.', 'Piezas sin errores y lote recibido/registrado', 'actividad', '06', 'Proveedor de impresión', 'Área Comercial', '2026-11-16', '2026-11-21', 0, 'pendiente', true, '', 'CONV'),
    ('M13', 'Preparar presentación institucional para ambos eventos', 'Armar las presentaciones para primera piedra y lanzamiento comercial según el propósito de cada evento. Integrar voceros, imágenes, planos y forma de pago; probar videos y archivos en el equipo de exhibición.', 'Presentación con renders, planos, pagos y maqueta', 'actividad', '06', 'Área Comercial', 'Comité Comercial', '2026-11-12', '2026-11-18', 0, 'pendiente', false, '', 'CONV'),
    ('M14', 'Publicar biblioteca comercial y controlar versiones', 'Publicar una carpeta única con materiales vigentes para bróker y corredores. Identificar fecha y versión, asignar quién actualiza cada archivo y retirar piezas reemplazadas para evitar información desactualizada.', 'Carpeta única compartida con el bróker y canales', 'actividad', '06', 'Área Comercial', 'Comité Comercial', '2026-11-19', '2026-11-21', 0, 'pendiente', true, '', 'MAN 8, 12.4'),
    ('O01', 'Definir ubicación, formato y alcance de la oficina', 'Decidir dónde atenderá AMURA y si usará local o contenedor. Revisar acceso, visibilidad, servicios, espacio y presupuesto; dejar aprobado qué se instalará y qué queda fuera de la primera etapa.', 'Decisión de local/contenedor y presupuesto preliminar', 'actividad', '07', 'Área Comercial', 'Comité Comercial', '2026-10-28', '2026-10-30', 0, 'pendiente', true, '', 'CONV'),
    ('O02', 'Diseñar recepción, puestos de vendedores y atención', 'Dibujar la distribución interior de la sala: recepción, puestos de atención, reunión, espera y exhibición. Revisar circulación, privacidad y accesibilidad con el equipo que atenderá a los clientes.', 'Layout con puestos, reuniones, accesibilidad y circulación', 'actividad', '07', 'Juan Carlos Páez', 'Área Comercial', '2026-10-30', '2026-11-02', 0, 'pendiente', true, '', 'CONV'),
    ('O03', 'Cotizar adecuación y seleccionar contratista', 'Solicitar propuestas para adecuar la oficina con el mismo alcance y plazo. Comparar costos, materiales y garantías, y formalizar al contratista seleccionado con entregables y responsables de supervisión.', 'Comparativo, contrato, alcance y plazo aprobados', 'actividad', '07', 'Juan Carlos Páez', 'Comité Comercial', '2026-11-03', '2026-11-06', 0, 'pendiente', false, '', 'CONV'),
    ('O04', 'Ejecutar adecuación del local o contenedor', 'Ejecutar las adecuaciones aprobadas de la sala o contenedor. Supervisar electricidad, iluminación, climatización y terminaciones; registrar pendientes y recibir los trabajos antes de instalar equipos y atender visitas.', 'Obra recibida con electricidad, iluminación y climatización', 'actividad', '07', 'Contratista de adecuación', 'Juan Carlos Páez', '2026-11-07', '2026-11-16', 0, 'pendiente', true, '', 'CONV'),
    ('O05', 'Comprar mobiliario y equipos para el equipo y clientes', 'Definir cantidades y comprar escritorios, sillas, mesas y equipos necesarios para vendedores y clientes. Comprobar medidas, entrega e instalación, y registrar quién recibe y administra cada equipo.', 'Escritorios, sillas, mesas, pantalla y equipos recibidos', 'actividad', '07', 'Área Comercial', 'Comité Comercial', '2026-11-06', '2026-11-13', 0, 'pendiente', true, '', 'CONV'),
    ('O06', 'Instalar internet, conectividad y estaciones CRM', 'Instalar internet y preparar los computadores con acceso al sistema comercial. Probar velocidad, conexión, permisos y respaldo ante fallas para que una visita pueda cotizar y registrar información sin interrupciones.', 'Conectividad y equipos operativos con respaldo', 'actividad', '07', 'Carlos Tapia', 'Área Comercial', '2026-11-14', '2026-11-17', 0, 'pendiente', true, '', 'CONV'),
    ('O07', 'Diseñar branding, rótulos, vinilos y señalética', 'Diseñar rótulos, vinilos, orientación y elementos de marca para la sala de ventas. Usar las reglas de AMURA y revisar medidas, ubicación, visibilidad y permisos antes de mandar a producir.', 'Artes de marca para interiores y exteriores aprobados', 'actividad', '07', 'Área Comercial', 'Comité Comercial', '2026-11-03', '2026-11-08', 0, 'pendiente', false, '', 'CONV; MAR1; MAR2'),
    ('O08', 'Producir e instalar la imagen de AMURA', 'Producir e instalar los elementos gráficos aprobados: rótulo exterior, vinilos y señalización interior. Comparar la instalación con los artes, revisar acabados y registrar correcciones antes de recibir el trabajo.', 'Rótulo exterior, vinilos, señalética e imagen instalada', 'actividad', '07', 'Proveedor de diseño', 'Área Comercial', '2026-11-14', '2026-11-20', 0, 'pendiente', true, '', 'CONV'),
    ('O09', 'Montar renders, pantalla y espacio para maqueta', 'Organizar la exhibición de planos, renders, pantalla y maqueta o recorrido virtual. Probar desde la posición del visitante que el material se ve bien y que el vendedor puede usarlo durante la presentación.', 'Exhibición y presentación funcional para visitas', 'actividad', '07', 'Área Comercial', 'Comité Comercial', '2026-11-18', '2026-11-21', 0, 'pendiente', true, '', 'CONV'),
    ('O10', 'Implementar horarios, seguridad y protocolo de visitas', 'Definir cómo se agenda y atiende una visita, horarios, responsables y recorrido autorizado. Revisar seguridad, acceso a obra y reemplazos; entregar al equipo un procedimiento claro para recibir y acompañar al comprador.', 'Agenda, responsables y recorrido seguro aprobados', 'actividad', '07', 'Bróker comercial', 'Área Comercial', '2026-11-18', '2026-11-21', 0, 'pendiente', true, '', 'MAN 3.4; CONV'),
    ('O11', 'Equipar sala con precios, simulaciones y documentos', 'Colocar en cada puesto el kit vigente para atender: lista de precios, fichas, cotizador y documentos. Confirmar acceso digital e impresos necesarios y retirar versiones anteriores de toda la sala.', 'Kit vigente en cada puesto de atención', 'actividad', '07', 'Área Comercial', 'Bróker comercial', '2026-11-20', '2026-11-22', 0, 'pendiente', true, '', 'MAN 3.4; CONV'),
    ('O12', 'Inspeccionar y habilitar la oficina de ventas', 'Recorrer la oficina con una lista de comprobación de instalaciones, marca, equipos, materiales y atención. Documentar pendientes y obtener autorización de uso; si algo falta, aprobar una alternativa de atención.', 'Acta con checklist de adecuación, marca y operación', 'hito', '07', 'Juan Carlos Páez', 'Comité Comercial', '2026-11-23', '2026-11-23', 0, 'pendiente', true, 'Aprobar alternativa de atención si existe algún pendiente.', 'CONV'),
    ('C01', 'Seleccionar CRM y aprobar licencias y presupuesto', 'Comparar y escoger el CRM, que es el sistema para organizar interesados, contactos y ventas. Definir costo, usuarios, administración y soporte, y pedir al Comité la aprobación antes de contratar licencias.', 'CRM seleccionado con responsables de administración', 'actividad', '08', 'Carlos Tapia', 'Comité Comercial', '2026-10-30', '2026-11-02', 0, 'pendiente', true, '', 'CONV; MAN 8'),
    ('C02', 'Configurar inventario y embudo por separado', 'Crear dos registros relacionados: unidades disponibles y proceso de cada comprador. Definir etapas desde consulta hasta cierre y los datos obligatorios para que una reserva no se confunda con una venta completada.', 'Inventario y etapas comerciales con campos obligatorios', 'actividad', '08', 'Carlos Tapia', 'Comité Comercial', '2026-11-03', '2026-11-07', 0, 'pendiente', true, '', 'CONV; MAN 3.9, 8.1'),
    ('C03', 'Configurar permisos y auditoría de campos sensibles', 'Asignar qué puede ver o modificar cada usuario del CRM. Restringir cambios sensibles en precios, descuentos y comisiones y activar historial para saber quién cambió un dato y cuándo.', 'Roles, historial y control de descuentos/comisiones', 'actividad', '08', 'Carlos Tapia', 'Comité Comercial', '2026-11-05', '2026-11-08', 0, 'pendiente', true, '', 'MAN 8.1'),
    ('C04', 'Cargar inventario y protocolo de actualización diaria', 'Cargar el inventario validado con códigos únicos, precios y estado de cada unidad. Definir quién actualiza reservas, ventas y liberaciones diariamente y cómo se comunica ese cambio a todos los canales.', 'Inventario único con estados, reservas y desbloqueo', 'actividad', '08', 'Carlos Tapia', 'Área Comercial', '2026-11-06', '2026-11-09', 0, 'pendiente', true, '', 'MAN 3.9, 8.1'),
    ('C05', 'Implementar asignación, registro y deduplicación', 'Configurar cómo recibe un contacto cada corredor y cómo se detectan registros repetidos. Probar casos de un mismo comprador por varios canales y verificar que se conserve el historial y responsable correcto.', 'Reglas probadas de asignación, duplicados y actividad', 'actividad', '08', 'Carlos Tapia', 'Bróker comercial', '2026-11-07', '2026-11-10', 0, 'pendiente', true, '', 'MAN 3, 4.3, 8'),
    ('C06', 'Conectar formularios, UTMs y WhatsApp Business', 'Conectar formularios y WhatsApp con el sistema comercial. Las UTMs son etiquetas del enlace que identifican de dónde llegó una consulta; comprobar que se guarden junto al consentimiento y datos del interesado.', 'Fuentes identificadas, consentimiento y mensajes integrados', 'actividad', '08', 'Carlos Tapia', 'Área Comercial', '2026-11-08', '2026-11-12', 0, 'pendiente', true, '', 'MAN 7, 8'),
    ('C07', 'Configurar SLA, cadencias y próximas acciones', 'Configurar recordatorios de respuesta, llamadas, visitas y siguientes contactos. SLA es el tiempo máximo acordado de atención; dejar visible quién debe actuar y cuándo en cada etapa comercial.', 'Alarmas, intentos, agenda y trazabilidad por etapa', 'actividad', '08', 'Carlos Tapia', 'Bróker comercial', '2026-11-09', '2026-11-12', 0, 'pendiente', true, '', 'MAN 3.2, 3.9–3.10'),
    ('C08', 'Configurar motivos de pérdida y reactivación', 'Definir por qué se pierde una oportunidad y cuándo se vuelve a contactar. Crear motivos claros, mensajes y fechas de seguimiento para que los interesados no queden abandonados ni reciban contactos sin control.', 'Motivos y secuencias con responsable y fecha', 'actividad', '08', 'Carlos Tapia', 'Bróker comercial', '2026-11-10', '2026-11-13', 0, 'pendiente', true, '', 'MAN 3.10'),
    ('C09', 'Implementar prioridad de reserva y lista de espera', 'Probar qué ocurre cuando dos personas quieren la misma unidad, vence una reserva o existe lista de espera. Definir prioridades y responsables con las reglas aprobadas de pago, bloqueo y liberación.', 'Reglas de hora de pago, bloqueo, liberación y espera', 'actividad', '08', 'Carlos Tapia', 'Comité Comercial', '2026-11-10', '2026-11-13', 0, 'pendiente', true, 'Reglas propuestas del manual pendientes de aprobación.', 'MAN II-N'),
    ('C10', 'Definir tablero, indicadores y ritmo de reuniones', 'Acordar los indicadores que se revisarán y cómo se calculan: consultas, visitas, reservas, ventas, costos y conversiones. KPI significa indicador de desempeño; asignar metas, fuente y responsable para cada uno.', 'KPIs, definiciones, presupuesto y metas aprobadas', 'actividad', '08', 'Área Comercial', 'Comité Comercial', '2026-11-09', '2026-11-13', 0, 'pendiente', true, '', 'CONV; MAN 10'),
    ('C11', 'Probar captura, reserva, cobro y trazabilidad de punta a punta', 'Probar el proceso completo con datos de prueba desde el formulario hasta reserva y comprobante de pago. Revisar permisos, inventario, alertas, responsables y reportes; documentar y corregir fallas antes de operar.', 'Prueba documentada y corrección de incidencias', 'actividad', '08', 'Carlos Tapia', 'Comité Comercial', '2026-11-14', '2026-11-17', 0, 'pendiente', true, '', 'MAN 3.9, 8, 11'),
    ('A01', 'Crear y administrar redes oficiales de AMURA', 'Crear o regularizar las cuentas oficiales de AMURA en redes y WhatsApp. Registrar administradores, accesos y recuperación, y distinguirlas de las cuentas propias de Century 21 o de los corredores externos.', 'Instagram, Facebook y WhatsApp oficiales con accesos', 'actividad', '09', 'Área Comercial', 'Comité Comercial', '2026-11-01', '2026-11-05', 0, 'pendiente', true, 'Distinguir redes oficiales del proyecto de redes propias de corredores.', 'CONV'),
    ('A02', 'Crear landing, formularios y aviso de privacidad', 'Preparar la página de captación o landing con información confirmada, formulario y privacidad. Probarla en computador y móvil y verificar que las consultas lleguen al responsable y queden registradas en el CRM.', 'Landing con atributos confirmados y captura al CRM', 'actividad', '09', 'Área Comercial', 'Comité Comercial', '2026-11-04', '2026-11-13', 0, 'pendiente', true, '', 'MAN 7, 8'),
    ('A03', 'Configurar medición, píxeles, campañas y UTMs', 'Configurar las herramientas que identifican visitas y consultas generadas por anuncios. Probar eventos de conversión, píxeles y UTMs con el consentimiento aplicable para distinguir qué campañas producen interesados reales.', 'Eventos de conversión y fuentes probados', 'actividad', '09', 'Área Comercial', 'Carlos Tapia', '2026-11-11', '2026-11-15', 0, 'pendiente', true, '', 'MAN 7, 8'),
    ('A04', 'Aprobar presupuesto de pauta y plan de canales', 'Definir cuánto se invertirá en anuncios y en qué canales, con objetivos y límites de gasto. Presentar el plan al Comité y establecer cómo se revisará el costo y la calidad de los interesados.', 'Presupuesto, objetivos y límites por canal aprobados', 'actividad', '09', 'Área Comercial', 'Comité Comercial', '2026-11-07', '2026-11-11', 0, 'pendiente', true, '', 'CONV; MAN 7.6'),
    ('A05', 'Preparar calendario editorial y contenido inicial', 'Planificar las publicaciones del primer mes con tema, formato, fecha y responsable. Preparar los textos e imágenes por tipo de comprador y obtener revisión antes de programar su difusión.', 'Calendario de 30 días y piezas aprobadas por segmento', 'actividad', '09', 'Área Comercial', 'Comité Comercial', '2026-11-08', '2026-11-16', 0, 'pendiente', false, '', 'MAN 7.8, IV'),
    ('A06', 'Preparar publicaciones en portales y fichas digitales', 'Cargar fichas en portales y canales digitales autorizados. Comprobar áreas, precios, disponibilidad y contactos, y definir quién actualiza o retira publicaciones cuando cambie una unidad o una condición comercial.', 'Fichas coherentes con inventario y precios vigentes', 'actividad', '09', 'Área Comercial', 'Bróker comercial', '2026-11-14', '2026-11-18', 0, 'pendiente', false, '', 'MAN 7.3'),
    ('A07', 'Preparar programa de referidos y corredores aliados', 'Preparar el kit y procedimiento para que aliados recomienden o comercialicen AMURA. Incluir condiciones aprobadas, materiales vigentes, formulario de registro y una sesión para explicar cómo trabajar con el bróker.', 'Kit, acuerdo, formularios y sesión de presentación', 'actividad', '09', 'Bróker comercial', 'Comité Comercial', '2026-11-13', '2026-11-18', 0, 'pendiente', false, '', 'MAN 6'),
    ('A08', 'Validar creatividades, simuladores y afirmaciones sensibles', 'Revisar anuncios, imágenes y simulaciones antes de publicarlos. Comprobar que afirmaciones sobre crédito, rentabilidad, entrega o equipamiento tengan respaldo y que aparezcan las aclaraciones y versiones autorizadas.', 'Checklist de publicación con soportes y versiones', 'actividad', '09', 'Área Comercial', 'Asesoría legal', '2026-11-18', '2026-11-20', 0, 'pendiente', true, '', 'MAN 12.4'),
    ('E01', 'Definir objetivo, concepto y alcance de primera piedra', 'Definir el propósito institucional de la primera piedra, público, mensajes y formato. Preparar un brief con alcance y necesidades, distinguiéndolo del evento cuyo objetivo es lanzar la comercialización.', 'Brief de evento separado del lanzamiento comercial', 'actividad', '10', 'Área Comercial', 'Comité Comercial', '2026-11-01', '2026-11-03', 0, 'pendiente', false, '', 'CONV'),
    ('E02', 'Solicitar tres propuestas de agencias para primera piedra', 'Enviar el mismo brief de primera piedra a tres agencias y pedir propuestas desglosadas. Comparar producción, montaje, personal, equipos, cobertura y contingencias para que la selección no dependa solo del precio.', 'Tres ofertas comparables de organización y producción', 'actividad', '10', 'Área Comercial', 'Comité Comercial', '2026-11-04', '2026-11-08', 0, 'pendiente', false, '', 'CONV'),
    ('E03', 'Aprobar presupuesto, agencia, fecha y lugar de primera piedra', 'Presentar al Comité las tres propuestas de primera piedra y aprobar proveedor, presupuesto, lugar y fecha. Confirmar condiciones técnicas y permisos; la fecha provisional del Excel no sustituye esa aprobación.', 'Presupuesto y programa autorizados', 'actividad', '10', 'Área Comercial', 'Comité Comercial', '2026-11-09', '2026-11-11', 0, 'pendiente', false, 'Fecha de referencia de trabajo. La realización requiere permisos y avance real.', 'CONV'),
    ('E04', 'Preparar invitados, invitaciones y confirmaciones', 'Construir la lista de invitados y enviar las invitaciones de primera piedra por los medios autorizados. RSVP significa confirmación de asistencia; registrar respuestas, acompañantes y necesidades para ajustar la logística.', 'Lista de invitados, RSVP y tratamiento de datos', 'actividad', '10', 'Área Comercial', 'Comité Comercial', '2026-11-12', '2026-11-18', 0, 'pendiente', false, '', 'CONV; MAN 1'),
    ('E05', 'Coordinar permisos, seguridad y logística de primera piedra', 'Coordinar acceso, montaje, energía, seguridad, proveedores y contingencias para primera piedra. Revisar con el equipo técnico que el lugar sea apto y que los permisos y responsabilidades estén resueltos.', 'Plan de montaje, seguridad, proveedores y contingencia', 'actividad', '10', 'Juan Carlos Páez', 'Comité Comercial', '2026-11-12', '2026-11-18', 0, 'pendiente', false, '', 'CONV'),
    ('E06', 'Coordinar presentación, prensa, fotografía y video', 'Preparar el orden de intervenciones, voceros y presentación de primera piedra. Coordinar prensa, fotografía y video, acordando qué se puede comunicar y cómo se recibirán y utilizarán los archivos.', 'Guion, voceros, cobertura y archivos de presentación', 'actividad', '10', 'Área Comercial', 'Comité Comercial', '2026-11-16', '2026-11-20', 0, 'pendiente', false, '', 'CONV'),
    ('E07', 'Ejecutar evento de primera piedra', 'Realizar el evento de primera piedra con el programa y condiciones aprobados. Registrar asistencia y evidencia audiovisual, y controlar incidencias; su realización no constituye autorización para vender ni recibir fondos.', 'Acta, registro audiovisual y participantes autorizados', 'hito', '10', 'Área Comercial', 'Comité Comercial', '2026-11-22', '2026-11-22', 0, 'pendiente', false, 'Evento institucional. No sustituye habilitación legal/comercial.', 'CONV'),
    ('E08', 'Dar seguimiento y cerrar costos de primera piedra', 'Consolidar facturas y gastos reales del evento, agradecer a los asistentes y organizar fotos y videos. Entregar al bróker solo los contactos que autorizaron seguimiento y documentar aprendizajes para el lanzamiento.', 'Agradecimientos, leads consentidos y cierre de presupuesto', 'actividad', '10', 'Área Comercial', 'Comité Comercial', '2026-11-23', '2026-11-25', 0, 'pendiente', false, '', 'CONV'),
    ('H01', 'Revisar expediente crítico de salida a ventas', 'Reunir evidencias de producto, legal, precios, cobros, sala, materiales, CRM y capacitación. Revisar cada requisito de salida a ventas y presentar al Comité los faltantes y su impacto antes de solicitar autorización.', 'Checklist de producto, precios, legal, finanzas, sala y CRM', 'actividad', '11', 'Área Comercial', 'Comité Comercial', '2026-11-21', '2026-11-23', 0, 'pendiente', true, 'No declarar listo si quedan requisitos críticos o capacitación abiertos.', 'MAN II-M, regla de salida'),
    ('H02', 'Autorizar la salida a ventas en Comité Comercial', 'Llevar el expediente de salida a ventas al Comité y registrar su decisión en un acta. Dejar condiciones, responsables y restricciones explícitas; la fecha prevista de lanzamiento no reemplaza esta autorización.', 'Acta firmada con precio, forma de pago y responsables', 'hito', '11', 'Área Comercial', 'Comité Comercial', '2026-11-24', '2026-11-24', 0, 'pendiente', true, 'La fecha objetivo no autoriza ventas. Requiere evidencias y aprobación.', 'CONV; MAN 12.3–12.4'),
    ('H03', 'Definir concepto y programa del lanzamiento comercial', 'Definir para quién será el lanzamiento comercial y qué resultado se espera: interesados, visitas o reservas autorizadas. Preparar concepto, agenda, presentación y necesidades de producción acordes con ese objetivo.', 'Brief del lanzamiento y metas de asistencia/visitas', 'actividad', '11', 'Área Comercial', 'Comité Comercial', '2026-11-08', '2026-11-10', 0, 'pendiente', false, '', 'CONV'),
    ('H04', 'Cotizar tres agencias y aprobar producción del lanzamiento', 'Pedir tres propuestas comparables de producción del lanzamiento comercial. Revisar montaje, atención, equipos y cobertura, y obtener aprobación de proveedor, alcance y presupuesto antes de contratar.', 'Tres propuestas, proveedor, alcance y presupuesto', 'actividad', '11', 'Área Comercial', 'Comité Comercial', '2026-11-11', '2026-11-15', 0, 'pendiente', false, '', 'CONV'),
    ('H05', 'Preparar invitados, confirmaciones y agenda de visitas', 'Invitar a prospectos y aliados, registrar confirmaciones de asistencia y organizar turnos de atención. Preparar agenda de visitas y formulario con consentimiento para que cada interesado tenga seguimiento después del evento.', 'RSVP, agenda, turnos y captación con consentimiento', 'actividad', '11', 'Área Comercial', 'Bróker comercial', '2026-11-16', '2026-11-22', 0, 'pendiente', false, '', 'CONV'),
    ('H06', 'Ensayar presentación, maqueta, atención y captura de leads', 'Ensayar la presentación con vendedores, equipos y materiales reales. Probar pantalla, maqueta o recorrido, cotizaciones y registro de interesados; practicar fallas y asignar responsables para resolverlas durante el evento.', 'Ensayo y contingencia documentados', 'actividad', '11', 'Bróker comercial', 'Área Comercial', '2026-11-22', '2026-11-23', 0, 'pendiente', false, '', 'CONV'),
    ('H07', 'Ejecutar lanzamiento comercial de AMURA', 'Realizar el lanzamiento comercial solo después de la habilitación del Comité. Coordinar presentación, atención y cobertura, y registrar consultas y visitas en el CRM para continuar el proceso después del evento.', 'Evento, prensa, foto/video y leads registrados en CRM', 'hito', '11', 'Área Comercial', 'Comité Comercial', '2026-11-25', '2026-11-25', 0, 'pendiente', false, 'Objetivo provisional a 30 días. Reprogramar si el Comité no habilita ventas.', 'CONV'),
    ('H08', 'Activar pauta piloto, portales y campañas de referidos', 'Activar una primera inversión controlada en anuncios, portales y referidos. Verificar que los contactos lleguen al CRM con su fuente y responsable, y monitorear gasto y calidad antes de aumentar presupuesto.', 'Campañas activas, fuentes medibles y presupuesto controlado', 'actividad', '11', 'Área Comercial', 'Comité Comercial', '2026-11-25', '2026-12-08', 0, 'pendiente', false, '', 'MAN 7, 11'),
    ('H09', 'Contactar asistentes y agendar visitas posteriores', 'Contactar a los asistentes que autorizaron seguimiento, resolver dudas y agendar visitas o propuestas. Registrar en el CRM quién atendió, qué se acordó y la fecha de la siguiente acción.', 'Seguimiento con próxima acción y visitas registradas', 'actividad', '11', 'Bróker comercial', 'Área Comercial', '2026-11-26', '2026-11-30', 0, 'pendiente', false, '', 'CONV; MAN 3'),
    ('R01', 'Gestionar primeras visitas, propuestas y reservas', 'Acompañar al equipo durante las primeras visitas y propuestas después del lanzamiento. Comprobar que cotizaciones, documentos, reservas y pagos sigan las reglas aprobadas y queden respaldados en el sistema.', 'Embudo con soporte de propuestas, reservas y fondos', 'actividad', '12', 'Bróker comercial', 'Área Comercial', '2026-11-26', '2026-12-25', 0, 'pendiente', false, '', 'MAN 3'),
    ('R02', 'Revisar semanalmente leads, visitas, reservas y costos', 'Revisar cada semana cuántos interesados avanzan a visita, reserva y venta y cuánto cuesta cada canal. Acordar correcciones con responsable y fecha; registrar decisiones para verificar su efecto en la siguiente reunión.', 'Reporte semanal y acciones correctivas por canal', 'actividad', '12', 'Área Comercial', 'Comité Comercial', '2026-11-26', '2027-01-24', 0, 'pendiente', false, '', 'MAN 10, 11'),
    ('R03', 'Auditar inventario, reservas y conciliaciones cada semana', 'Comparar semanalmente inventario comercial, reservas y depósitos bancarios. Detectar unidades duplicadas, pagos sin identificar y reservas vencidas, y dejar documentada la corrección de cada diferencia.', 'Conciliación de unidades y pagos sin duplicados', 'actividad', '12', 'Administración y Finanzas', 'Área Comercial', '2026-11-26', '2027-01-24', 0, 'pendiente', false, '', 'MAN 3.9, 8'),
    ('R04', 'Validar segmentos con entrevistas y campañas de prueba', 'Conversar con compradores potenciales y probar mensajes y anuncios por segmento. Registrar necesidades, objeciones y resultados para confirmar qué perfiles compran AMURA, sin asumir que coinciden con las estimaciones del manual.', 'Entrevistas, demanda por avatar y aprendizaje documentado', 'actividad', '12', 'Área Comercial', 'Comité Comercial', '2026-11-26', '2026-12-25', 0, 'pendiente', false, 'No asumir que los porcentajes del manual describen compradores de AMURA.', 'MAN IV'),
    ('R05', 'Revisar comisiones, márgenes y descuentos reales', 'Revisar ventas reales y comprobar cuánto quedó después de descuentos, comisiones y demás pagos. Comparar cada liquidación con las reglas aprobadas y presentar al Comité excepciones o márgenes insuficientes.', 'Liquidaciones, rentabilidad y excepciones auditadas', 'actividad', '12', 'Administración y Finanzas', 'Comité Comercial', '2026-12-11', '2026-12-25', 0, 'pendiente', false, '', 'MAN 4, 5, 12'),
    ('R06', 'Optimizar campaña y redistribuir presupuesto', 'Comparar canales y anuncios por calidad del interesado, avance comercial y costo. Proponer cambios de mensajes y distribución de inversión y solicitar la aprobación antes de modificar límites de presupuesto.', 'Decisión de inversión sustentada en calidad y conversión', 'actividad', '12', 'Área Comercial', 'Comité Comercial', '2026-12-11', '2026-12-25', 0, 'pendiente', false, '', 'MAN 7, 10, 11'),
    ('R07', 'Cerrar revisión del día 60', 'Hacer una reunión formal de control al día 60 del calendario provisional. Comparar metas y resultados, identificar pendientes y dejar un acta con decisiones, responsables y plazos de mejora.', 'Acta con metas, conversiones y acciones de mejora', 'hito', '12', 'Área Comercial', 'Comité Comercial', '2026-12-25', '2026-12-25', 0, 'pendiente', false, 'Hito de control, no certifica ventas realizadas.', 'MAN 11'),
    ('R08', 'Ajustar política comercial con datos observados', 'Revisar precios, descuentos, canales, metas y presupuesto usando datos del piloto. Presentar cambios al Comité y actualizar documentos y materiales solo después de la aprobación de la nueva política.', 'Política, metas y presupuesto revisados y firmados', 'actividad', '12', 'Área Comercial', 'Comité Comercial', '2026-12-26', '2027-01-14', 0, 'pendiente', false, '', 'MAN 11, 12.3'),
    ('R09', 'Cerrar implementación y revisión del día 90', 'Cerrar la revisión del día 90 con resultados, problemas pendientes y próximos responsables. Confirmar cómo seguirá la operación comercial y dejar evidencia de acuerdos; el hito no significa que todas las tareas estén completas.', 'Acta con resultados, pendientes y continuidad operativa', 'hito', '12', 'Área Comercial', 'Comité Comercial', '2027-01-24', '2027-01-24', 0, 'pendiente', false, 'Hito de seguimiento. Mantener pendientes visibles.', 'MAN 11'),
    ('V01', 'Cerrar mes comercial 1: ventas, cobros, inventario y KPIs', 'Consolidar el mes comercial 1, contado desde el lanzamiento objetivo: ventas, reservas, cobros, unidades disponibles, costos y resultados por canal. Comparar meta y resultado real, explicar diferencias y registrar las decisiones del Comité con responsable y fecha.', 'Reporte mensual de meta/real, canales, márgenes, reservas y decisiones', 'hito', '13', 'Área Comercial', 'Comité Comercial', '2026-12-24', '2026-12-24', 0, 'pendiente', false, 'Mes contado desde el lanzamiento objetivo. Fechas y metas sujetas a aprobación.', 'CONV; MAN 10, 12.3'),
    ('V02', 'Cerrar mes comercial 2: ventas, cobros, inventario y KPIs', 'Consolidar el mes comercial 2, contado desde el lanzamiento objetivo: ventas, reservas, cobros, unidades disponibles, costos y resultados por canal. Comparar meta y resultado real, explicar diferencias y registrar las decisiones del Comité con responsable y fecha.', 'Reporte mensual de meta/real, canales, márgenes, reservas y decisiones', 'hito', '13', 'Área Comercial', 'Comité Comercial', '2027-01-24', '2027-01-24', 0, 'pendiente', false, 'Mes contado desde el lanzamiento objetivo. Fechas y metas sujetas a aprobación.', 'CONV; MAN 10, 12.3'),
    ('V03', 'Cerrar mes comercial 3: ventas, cobros, inventario y KPIs', 'Consolidar el mes comercial 3, contado desde el lanzamiento objetivo: ventas, reservas, cobros, unidades disponibles, costos y resultados por canal. Comparar meta y resultado real, explicar diferencias y registrar las decisiones del Comité con responsable y fecha.', 'Reporte mensual de meta/real, canales, márgenes, reservas y decisiones', 'hito', '13', 'Área Comercial', 'Comité Comercial', '2027-02-24', '2027-02-24', 0, 'pendiente', false, 'Mes contado desde el lanzamiento objetivo. Fechas y metas sujetas a aprobación.', 'CONV; MAN 10, 12.3'),
    ('V04', 'Cerrar mes comercial 4: ventas, cobros, inventario y KPIs', 'Consolidar el mes comercial 4, contado desde el lanzamiento objetivo: ventas, reservas, cobros, unidades disponibles, costos y resultados por canal. Comparar meta y resultado real, explicar diferencias y registrar las decisiones del Comité con responsable y fecha.', 'Reporte mensual de meta/real, canales, márgenes, reservas y decisiones', 'hito', '13', 'Área Comercial', 'Comité Comercial', '2027-03-24', '2027-03-24', 0, 'pendiente', false, 'Mes contado desde el lanzamiento objetivo. Fechas y metas sujetas a aprobación.', 'CONV; MAN 10, 12.3'),
    ('V05', 'Cerrar mes comercial 5: ventas, cobros, inventario y KPIs', 'Consolidar el mes comercial 5, contado desde el lanzamiento objetivo: ventas, reservas, cobros, unidades disponibles, costos y resultados por canal. Comparar meta y resultado real, explicar diferencias y registrar las decisiones del Comité con responsable y fecha.', 'Reporte mensual de meta/real, canales, márgenes, reservas y decisiones', 'hito', '13', 'Área Comercial', 'Comité Comercial', '2027-04-24', '2027-04-24', 0, 'pendiente', false, 'Mes contado desde el lanzamiento objetivo. Fechas y metas sujetas a aprobación.', 'CONV; MAN 10, 12.3'),
    ('V06', 'Cerrar mes comercial 6: ventas, cobros, inventario y KPIs', 'Consolidar el mes comercial 6, contado desde el lanzamiento objetivo: ventas, reservas, cobros, unidades disponibles, costos y resultados por canal. Comparar meta y resultado real, explicar diferencias y registrar las decisiones del Comité con responsable y fecha.', 'Reporte mensual de meta/real, canales, márgenes, reservas y decisiones', 'hito', '13', 'Área Comercial', 'Comité Comercial', '2027-05-24', '2027-05-24', 0, 'pendiente', false, 'Mes contado desde el lanzamiento objetivo. Fechas y metas sujetas a aprobación.', 'CONV; MAN 10, 12.3'),
    ('V07', 'Cerrar mes comercial 7: ventas, cobros, inventario y KPIs', 'Consolidar el mes comercial 7, contado desde el lanzamiento objetivo: ventas, reservas, cobros, unidades disponibles, costos y resultados por canal. Comparar meta y resultado real, explicar diferencias y registrar las decisiones del Comité con responsable y fecha.', 'Reporte mensual de meta/real, canales, márgenes, reservas y decisiones', 'hito', '13', 'Área Comercial', 'Comité Comercial', '2027-06-24', '2027-06-24', 0, 'pendiente', false, 'Mes contado desde el lanzamiento objetivo. Fechas y metas sujetas a aprobación.', 'CONV; MAN 10, 12.3'),
    ('V08', 'Cerrar mes comercial 8: ventas, cobros, inventario y KPIs', 'Consolidar el mes comercial 8, contado desde el lanzamiento objetivo: ventas, reservas, cobros, unidades disponibles, costos y resultados por canal. Comparar meta y resultado real, explicar diferencias y registrar las decisiones del Comité con responsable y fecha.', 'Reporte mensual de meta/real, canales, márgenes, reservas y decisiones', 'hito', '13', 'Área Comercial', 'Comité Comercial', '2027-07-24', '2027-07-24', 0, 'pendiente', false, 'Mes contado desde el lanzamiento objetivo. Fechas y metas sujetas a aprobación.', 'CONV; MAN 10, 12.3'),
    ('V09', 'Cerrar mes comercial 9: ventas, cobros, inventario y KPIs', 'Consolidar el mes comercial 9, contado desde el lanzamiento objetivo: ventas, reservas, cobros, unidades disponibles, costos y resultados por canal. Comparar meta y resultado real, explicar diferencias y registrar las decisiones del Comité con responsable y fecha.', 'Reporte mensual de meta/real, canales, márgenes, reservas y decisiones', 'hito', '13', 'Área Comercial', 'Comité Comercial', '2027-08-24', '2027-08-24', 0, 'pendiente', false, 'Mes contado desde el lanzamiento objetivo. Fechas y metas sujetas a aprobación.', 'CONV; MAN 10, 12.3'),
    ('V10', 'Cerrar mes comercial 10: ventas, cobros, inventario y KPIs', 'Consolidar el mes comercial 10, contado desde el lanzamiento objetivo: ventas, reservas, cobros, unidades disponibles, costos y resultados por canal. Comparar meta y resultado real, explicar diferencias y registrar las decisiones del Comité con responsable y fecha.', 'Reporte mensual de meta/real, canales, márgenes, reservas y decisiones', 'hito', '13', 'Área Comercial', 'Comité Comercial', '2027-09-24', '2027-09-24', 0, 'pendiente', false, 'Mes contado desde el lanzamiento objetivo. Fechas y metas sujetas a aprobación.', 'CONV; MAN 10, 12.3'),
    ('V11', 'Cerrar mes comercial 11: ventas, cobros, inventario y KPIs', 'Consolidar el mes comercial 11, contado desde el lanzamiento objetivo: ventas, reservas, cobros, unidades disponibles, costos y resultados por canal. Comparar meta y resultado real, explicar diferencias y registrar las decisiones del Comité con responsable y fecha.', 'Reporte mensual de meta/real, canales, márgenes, reservas y decisiones', 'hito', '13', 'Área Comercial', 'Comité Comercial', '2027-10-24', '2027-10-24', 0, 'pendiente', false, 'Mes contado desde el lanzamiento objetivo. Fechas y metas sujetas a aprobación.', 'CONV; MAN 10, 12.3'),
    ('V12', 'Cerrar mes comercial 12: ventas, cobros, inventario y KPIs', 'Consolidar el mes comercial 12, contado desde el lanzamiento objetivo: ventas, reservas, cobros, unidades disponibles, costos y resultados por canal. Comparar meta y resultado real, explicar diferencias y registrar las decisiones del Comité con responsable y fecha.', 'Reporte mensual de meta/real, canales, márgenes, reservas y decisiones', 'hito', '13', 'Área Comercial', 'Comité Comercial', '2027-11-24', '2027-11-24', 0, 'pendiente', false, 'Mes contado desde el lanzamiento objetivo. Fechas y metas sujetas a aprobación.', 'CONV; MAN 10, 12.3'),
    ('V13', 'Mantener operación de leads y SLA durante comercialización', 'Mantener durante la comercialización la atención a consultas, visitas, cotizaciones y siguientes contactos. Revisar tiempos de respuesta y distribución del trabajo para que cada interesado tenga responsable y seguimiento registrado.', 'Atención, visitas, propuestas y próximas acciones en CRM', 'actividad', '13', 'Bróker comercial', 'Área Comercial', '2026-11-25', '2027-11-24', 0, 'pendiente', false, '', 'MAN 3, 10'),
    ('V14', 'Actualizar piezas, portales y reportes de avance de obra', 'Revisar periódicamente que portales, redes, material y sala muestren disponibilidad, precios y avance autorizados. Coordinar la información de obra con el equipo técnico y retirar versiones anteriores de todos los canales.', 'Inventario, precios y avance actualizados en canales oficiales', 'actividad', '13', 'Área Comercial', 'Juan Carlos Páez', '2026-11-25', '2027-11-24', 0, 'pendiente', false, '', 'MAN 7, 12.4'),
    ('V15', 'Administrar cobranza, desistimientos y liquidaciones', 'Controlar cuotas y saldos de compradores, atrasos, cancelaciones y devoluciones. Conciliar cobros y comisiones con contratos y comprobantes, y llevar al Comité los casos que requieren una decisión excepcional.', 'Cobros, cartera, reembolsos y comisiones conciliados', 'actividad', '13', 'Administración y Finanzas', 'Comité Comercial', '2026-11-25', '2027-11-24', 0, 'pendiente', false, '', 'MAN 3, 4'),
    ('Z01', 'Aprobar plan de hitos de obra y comunicación al comprador', 'Convertir el cronograma técnico aprobado en hitos que deban comunicarse a compradores. Definir qué avance se reporta, quién lo valida y cómo se avisarán cambios; incorporar después el detalle técnico de construcción.', 'Cronograma por edificio, avisos y responsables de actualización', 'actividad', '14', 'Juan Carlos Páez', 'Comité Comercial', '2026-11-04', '2026-11-10', 0, 'pendiente', true, '', 'MAN II-A, II-H'),
    ('Z02', 'Reportar avances y alertas durante construcción', 'Recibir y comunicar informes técnicos durante la obra, con evidencias, riesgos y cambios de fecha. Registrar qué compradores deben ser informados y quién responde; programar este seguimiento al confirmar las fechas contractuales.', 'Informes de avance, cambios y comunicaciones a compradores', 'actividad', '14', 'Juan Carlos Páez', 'Comité Comercial', null, null, 0, 'pendiente', false, 'Programar al confirmar el inicio contractual y las entregas.', 'MAN 7.2, 12.4'),
    ('Z03', 'Confirmar fecha contractual de entrega del edificio 1', 'Pedir el documento que fija la entrega del edificio 1 y verificar fecha, condiciones y aprobaciones. Registrar la fecha confirmada en Ajustes, celda B8, para calcular los trabajos de cierre y postventa correspondientes.', 'Fecha de entrega y condiciones respaldadas por contrato', 'hito', '14', 'Juan Carlos Páez', 'Comité Comercial', null, null, 0, 'pendiente', false, 'Referencia conversada: 30 meses. No convertir en compromiso sin fecha base.', 'CONV; MAN II-A'),
    ('Z04', 'Confirmar fecha contractual de entrega del edificio 2', 'Pedir el documento que fija la entrega del edificio 2 y verificar fecha, condiciones y aprobaciones. Registrar la fecha confirmada en Ajustes, celda B9, para calcular los trabajos de cierre y postventa correspondientes.', 'Fecha de entrega y condiciones respaldadas por contrato', 'hito', '14', 'Juan Carlos Páez', 'Comité Comercial', null, null, 0, 'pendiente', false, 'Referencia conversada: 42 meses. No convertir en compromiso sin fecha base.', 'CONV; MAN II-A'),
    ('Z05', 'Preparar cierre, escritura y desembolso del edificio 1', 'Preparar por comprador del edificio 1 el expediente para escriturar: pagos, requisitos bancarios, documentos y coordinación notarial. Revisar diferencias con anticipación y confirmar responsables de desembolso y firma.', 'Expediente completo, paz y salvos y coordinación bancaria/notarial', 'actividad', '14', 'Asesoría legal', 'Administración y Finanzas', null, null, 0, 'pendiente', false, 'Fechas se calculan cuando Control tenga entrega contractual 1.', 'MAN 3.6–3.7, II-I'),
    ('Z06', 'Entregar unidades y registrar actas del edificio 1', 'Inspeccionar y entregar las unidades del edificio 1 al comprador. Registrar llaves, servicios, manuales, observaciones y responsables de corrección en un acta; explicar los canales de atención y las condiciones de garantía.', 'Inspección, entrega, observaciones, manuales y servicios', 'actividad', '14', 'Juan Carlos Páez', 'Comité Comercial', null, null, 0, 'pendiente', false, '', 'MAN II-I'),
    ('Z07', 'Resolver novedades y activar postventa del edificio 1', 'Recibir y resolver las novedades del edificio 1 mediante casos con responsable, fecha y evidencia de solución. Obtener aceptación del comprador y aplicar las garantías contractuales, sin confundirlas con la duración provisional de esta tarea.', 'Tickets, plazos acordados, aceptación y garantías', 'actividad', '14', 'Operaciones y postventa', 'Juan Carlos Páez', null, null, 0, 'pendiente', false, 'Duración de referencia operativa, no plazo de garantía contractual.', 'MAN 3.9, II-I'),
    ('Z08', 'Preparar cierre, escritura y desembolso del edificio 2', 'Preparar los expedientes de compradores del edificio 2 para escritura y desembolso. Coordinar pagos pendientes, requisitos bancarios, documentos y citas notariales antes de la fecha contractual de entrega.', 'Expediente completo y coordinación bancaria/notarial', 'actividad', '14', 'Asesoría legal', 'Administración y Finanzas', null, null, 0, 'pendiente', false, '', 'MAN 3.6–3.7, II-I'),
    ('Z09', 'Entregar unidades y registrar actas del edificio 2', 'Inspeccionar y entregar las unidades del edificio 2 con actas, llaves, manuales y servicios. Registrar observaciones y compromisos de corrección e informar cómo se atenderán las solicitudes de postventa.', 'Entrega, observaciones, servicios y administración', 'actividad', '14', 'Juan Carlos Páez', 'Comité Comercial', null, null, 0, 'pendiente', false, '', 'MAN II-I'),
    ('Z10', 'Resolver novedades y activar postventa del edificio 2', 'Atender y cerrar las novedades del edificio 2 con registro de cada caso. Verificar responsables, plazos y aceptación del comprador y aplicar las condiciones de garantía que consten en los documentos aprobados.', 'Tickets, garantías y aceptación de pendientes', 'actividad', '14', 'Operaciones y postventa', 'Juan Carlos Páez', null, null, 0, 'pendiente', false, '', 'MAN II-I'),
    ('Z11', 'Cerrar proyecto comercial, garantías y entrega a administración', 'Consolidar cartera, expedientes, garantías, pendientes y lecciones del proyecto. Formalizar la entrega a administración y postventa, indicando quién conservará documentos y atenderá obligaciones que sigan vigentes después del cierre.', 'Acta de cierre, cartera, garantías, archivo y lecciones', 'actividad', '14', 'Operaciones y postventa', 'Comité Comercial', null, null, 0, 'pendiente', false, '', 'MAN 3.9, II-I')
  ) as x(codigo, nombre, descripcion, resultado, tipo, fase, responsable, aprobador, inicio, fin, avance, estado, bloquea, observaciones, fuente)
  left join public.plan_fases f on f.plan_id = v_plan and f.codigo = x.fase
  on conflict (plan_id, codigo) do nothing;
  get diagnostics v_nuevas = row_count;

  insert into public.plan_history (activity_id, user_id, accion, motivo, despues, import_id)
  select a.id, v_admin, 'Carga inicial (SQL)', 'Carga inicial desde Gantt_AMURA.xlsx', jsonb_build_object('codigo', a.codigo), v_import
  from public.plan_activities a
  where a.plan_id = v_plan and not exists (select 1 from public.plan_history h where h.activity_id = a.id);

  insert into public.plan_dependencies (plan_id, predecesora_id, sucesora_id, created_by)
  select v_plan, p.id, s.id, v_admin
  from (values
    ('D02', 'D01'),
    ('D03', 'D01'),
    ('D08', 'D04'),
    ('P01', 'D04'),
    ('P02', 'D06'),
    ('P03', 'P01'),
    ('P04', 'D06'),
    ('P05', 'P04'),
    ('P06', 'D06'),
    ('P07', 'D06'),
    ('P08', 'P06'),
    ('P09', 'D06'),
    ('P10', 'P02'),
    ('L01', 'D07'),
    ('L02', 'D06'),
    ('L03', 'L01'),
    ('L04', 'L01'),
    ('L05', 'L03'),
    ('L06', 'L05'),
    ('L07', 'L01'),
    ('L08', 'D03'),
    ('L09', 'L04'),
    ('L10', 'L05'),
    ('F01', 'D04'),
    ('F02', 'P01'),
    ('F03', 'F02'),
    ('F04', 'F01'),
    ('F05', 'L05'),
    ('F06', 'L03'),
    ('F07', 'F02'),
    ('F08', 'F07'),
    ('F09', 'P09'),
    ('F10', 'F09'),
    ('F11', 'F08'),
    ('F12', 'L04'),
    ('F13', 'F12'),
    ('B01', 'L04'),
    ('B02', 'B01'),
    ('B03', 'B01'),
    ('B04', 'B03'),
    ('B05', 'F12'),
    ('B06', 'B01'),
    ('B07', 'P10'),
    ('B08', 'B07'),
    ('B09', 'B08'),
    ('M01', 'D05'),
    ('M02', 'M01'),
    ('M03', 'P05'),
    ('M04', 'P02'),
    ('M05', 'P05'),
    ('M06', 'D06'),
    ('M07', 'M06'),
    ('M08', 'P10'),
    ('M09', 'M03'),
    ('M10', 'F03'),
    ('M11', 'M09'),
    ('M12', 'M11'),
    ('M13', 'M08'),
    ('M14', 'M12'),
    ('O01', 'D01'),
    ('O02', 'O01'),
    ('O03', 'O02'),
    ('O04', 'O03'),
    ('O05', 'O02'),
    ('O06', 'O04'),
    ('O07', 'M01'),
    ('O08', 'O07'),
    ('O09', 'O05'),
    ('O10', 'B06'),
    ('O11', 'M12'),
    ('O12', 'O11'),
    ('C01', 'D02'),
    ('C02', 'C01'),
    ('C03', 'C02'),
    ('C04', 'F03'),
    ('C05', 'B03'),
    ('C06', 'L08'),
    ('C07', 'B06'),
    ('C08', 'C07'),
    ('C09', 'F05'),
    ('C10', 'D08'),
    ('C11', 'C09'),
    ('A01', 'M01'),
    ('A02', 'L08'),
    ('A03', 'C06'),
    ('A04', 'D08'),
    ('A05', 'M02'),
    ('A06', 'M03'),
    ('A07', 'B05'),
    ('A08', 'A05'),
    ('E01', 'P09'),
    ('E02', 'E01'),
    ('E03', 'E02'),
    ('E04', 'E03'),
    ('E05', 'E03'),
    ('E06', 'M13'),
    ('E07', 'E05'),
    ('E08', 'E07'),
    ('H01', 'C11'),
    ('H02', 'H01'),
    ('H03', 'M02'),
    ('H04', 'H03'),
    ('H05', 'H04'),
    ('H06', 'O12'),
    ('H07', 'H02'),
    ('H08', 'H02'),
    ('H09', 'H07'),
    ('R01', 'H07'),
    ('R02', 'C10'),
    ('R03', 'C04'),
    ('R04', 'M02'),
    ('R05', 'F13'),
    ('R06', 'R02'),
    ('R07', 'R04'),
    ('R08', 'R05'),
    ('R09', 'R08'),
    ('V01', 'H07'),
    ('V02', 'V01'),
    ('V03', 'V02'),
    ('V04', 'V03'),
    ('V05', 'V04'),
    ('V06', 'V05'),
    ('V07', 'V06'),
    ('V08', 'V07'),
    ('V09', 'V08'),
    ('V10', 'V09'),
    ('V11', 'V10'),
    ('V12', 'V11'),
    ('V13', 'H02'),
    ('V14', 'H02'),
    ('V15', 'H02'),
    ('Z01', 'P09'),
    ('Z02', 'Z01'),
    ('Z03', 'P09'),
    ('Z04', 'P09'),
    ('Z05', 'L10'),
    ('Z06', 'Z05'),
    ('Z07', 'Z06'),
    ('Z08', 'L10'),
    ('Z09', 'Z08'),
    ('Z10', 'Z09'),
    ('Z11', 'Z10')
  ) as d(sucesora, predecesora)
  join public.plan_activities s on s.plan_id = v_plan and s.codigo = d.sucesora
  join public.plan_activities p on p.plan_id = v_plan and p.codigo = d.predecesora
  on conflict do nothing;
  get diagnostics v_deps = row_count;

  insert into public.plan_evidences (activity_id, tipo, referencia, descripcion, created_by)
  select a.id, 'enlace', e.url, 'Importada de Gantt_AMURA.xlsx', v_admin
  from (values
    ('D04', 'https://docs.google.com/spreadsheets/d/1ARumaeaL5yYHZkwxWYLGqDapeg7yXIH0QgATU1lTwlI/edit'),
    ('D05', 'https://drive.google.com/file/d/1smGHCzBPirT1ZN7QSFkEoOOMXL-dMH1j/view'),
    ('D06', 'https://drive.google.com/file/d/1MrX2fQHYhm0tYvo9GoZmEDqvhxRKdcv3/view'),
    ('D07', 'https://drive.google.com/drive/folders/1HSu3OzaIQzpD9GSAaMBFhfXW1vzb8xCp'),
    ('M01', 'https://drive.google.com/file/d/1smGHCzBPirT1ZN7QSFkEoOOMXL-dMH1j/view')
  ) as e(codigo, url)
  join public.plan_activities a on a.plan_id = v_plan and a.codigo = e.codigo
  on conflict (activity_id, referencia) do nothing;
  get diagnostics v_evid = row_count;

  insert into public.plan_imports (id, plan_id, archivo, hoja, user_id, resumen, cambios)
  values (v_import, v_plan, 'Gantt_AMURA.xlsx', '1 TRABAJAR AQUI', v_admin,
          jsonb_build_object('nuevas', v_nuevas, 'sin_cambios', 147 - v_nuevas, 'dependencias', v_deps, 'evidencias', v_evid, 'via', 'script SQL'), '[]'::jsonb);
  insert into public.audit_log (actor_id, accion, entidad, entidad_id, motivo, despues)
  values (v_admin, 'Carga inicial del plan', 'plan', v_plan::text, 'Carga inicial desde Gantt_AMURA.xlsx (script SQL)',
          jsonb_build_object('nuevas', v_nuevas, 'dependencias', v_deps, 'evidencias', v_evid));
  raise notice 'Plan PLAN-AMURA: % actividades nuevas, % dependencias nuevas, % evidencias nuevas', v_nuevas, v_deps, v_evid;
end $$;

commit;

-- Verificación (solo lectura):
-- select count(*) as actividades, count(*) filter (where responsable_id is null) as sin_responsable_vinculado,
--        count(*) filter (where peso is null) as sin_peso, count(*) filter (where estado = 'completada') as cerradas
-- from public.plan_activities a join public.plan_plans p on p.id = a.plan_id where p.codigo = 'PLAN-AMURA';
