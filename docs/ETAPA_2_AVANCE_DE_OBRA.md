# Etapa 2 · Avance de obra: definición funcional

**Estado: definido, sin desarrollar ni desplegar.** No forma parte de la puesta en marcha comercial y no la condiciona.

Regla general: no se inventan fechas, porcentajes ni actividades. Lo que aún no se conoce queda vacío y se muestra como «Sin definir».

## 1. Situación de la obra

| Tema | Lo que se sabe | Lo que no está aprobado |
|---|---|---|
| Precarga | Comenzó en octubre de 2026. Capa de tierra compactada de unos 3 m, con permanencia prevista de 12 meses. | Porcentaje físico oficial: solo con registros técnicos. Día exacto de inicio: pendiente de registrar. |
| Cimentación | La precarga busca consolidar el terreno para evaluar losa en lugar de pilotes. | La solución definitiva requiere validación técnica. |
| Edificio 1 | Se construye primero. | Fechas de construcción. |
| Edificio 2 | Se construye después, según las condiciones comerciales y financieras. | Fechas de construcción. |
| Urbanismo | Frente independiente, paralelo a la comercialización del Edificio 1. | Fechas de ejecución. |

## 2. Cuatro frentes independientes

1. **Terreno y precarga.**
2. **Urbanismo y áreas comunes:** vías y accesos; aceras; parques y áreas verdes; club y áreas comunes; garita y otras instalaciones exteriores.
3. **Edificio 1:** cronograma propio, con sus etapas y subactividades.
4. **Edificio 2:** cronograma propio, con sus etapas y subactividades.

Cada frente se planifica por separado; un cambio en uno no modifica los otros, salvo por una dependencia registrada expresamente. Las etapas y subactividades de los edificios las carga el equipo técnico: no se precargan por suposición.

**Separación del Plan de implementación:** el cronograma de obra no se mezcla con el Plan de implementación comercial. Son datos, avance y reportes distintos.

## 3. Datos de cada actividad o subactividad

- Fecha de inicio planificada y real.
- Fecha de finalización planificada y real.
- Duración prevista.
- Porcentaje físico ejecutado, individual.
- Responsable, estado y observaciones.
- Fotografías y documentos de respaldo.
- Dependencias con otras actividades.
- Ponderación.
- Historial de actualizaciones.

Todas las fechas son editables y pueden quedar vacías.

Las actividades se pueden agregar, modificar y reorganizar desde la aplicación, sin programar cada cambio. Reorganizar no pierde su historial.

## 4. Tres avances distintos

| Avance | Qué es | Quién lo origina |
|---|---|---|
| **Planificado** | Lo que debía estar hecho según el cronograma aprobado. | Cronograma |
| **Ejecutado** | Lo que el Constructor registra, con su respaldo. | Constructor |
| **Validado** | Lo ejecutado que fue revisado y aceptado. Es el porcentaje **oficial**. | Gerencia o Administración |

- El avance físico nunca se calcula solo por el tiempo transcurrido. Esto aplica en especial a la precarga: pasar 6 de 12 meses no significa 50 %.
- El porcentaje oficial debe sustentarse en registros técnicos.
- Sin dato no equivale a 0 %.

## 5. Avance general de cada frente

- Cada edificio muestra su porcentaje general de avance físico, calculado con ponderaciones configurables por actividad.
- Las ponderaciones las aprueba el responsable técnico. Cambiarlas no requiere programar y queda en el historial.
- Mientras falten ponderaciones aprobadas, el avance general se muestra como «Incompleto», no como una cifra parcial.
- Se muestra la comparación entre avance planificado y ejecutado, y alertas por retrasos.

## 6. Responsabilidades

- **Constructor:** registra avances, fechas reales, fotografías y documentos.
- **Gerencia o Administración:** valida los avances.
- **Responsable técnico:** aprueba las ponderaciones.

## 7. Fuera de esta definición

No se ha pedido conectar el avance de obra con cobranzas, comisiones ni contratos, así que esta definición no lo incluye.

## 8. Por definir antes de desarrollar

Estos puntos no bloquean la puesta en marcha comercial.

1. **Responsable técnico:** quién es y con qué perfil entra a AMURA. Hoy no existe ese perfil entre los ocho aprobados.
2. **Quién modifica el cronograma:** quién puede agregar, reorganizar actividades y cambiar fechas planificadas. Propuesta: Constructor y Administración, siempre con historial.
3. **Quién más consulta:** qué otros perfiles ven el avance y si Corredor o Vendedor pueden verlo para informar a clientes.
4. **Avance planificado:** cómo se obtiene. Propuesta: calcularlo con las fechas planificadas y las ponderaciones, y mostrar «Sin definir» si faltan.
5. **Terreno y Urbanismo:** si también muestran un porcentaje general ponderado, como los edificios. Propuesta: sí, con la misma regla.
6. **Registros técnicos de la precarga:** qué documentos sustentan su porcentaje oficial. Lo define el responsable técnico.

## 9. Condiciones técnicas para desarrollar

- **Plan actual:** tiene un frente «Construcción» y una actividad P09 («Validar cronograma de obra y entregas por edificio»). Se mantienen ahí como tareas de gestión; no son el cronograma de obra.
- **Fotografías y documentos:** AMURA todavía no sube archivos; los comprobantes de pago se registran solo como referencia de texto. Este módulo necesita almacenamiento nuevo, con permisos propios. Además, el respaldo actual (`scripts/respaldo-produccion.ps1`) no incluye Storage: hay que ampliarlo antes de guardar evidencias de obra.
- **Permisos:** el perfil Constructor hoy solo tiene `inventario.tecnico`. Registrar, validar y ponderar serán permisos nuevos, separados y configurables en Roles y permisos.
