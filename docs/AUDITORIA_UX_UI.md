# Auditoría UX/UI de AMURA

Fecha: 13/11/2026. Estado: **propuesta para aprobar**. Nada de esto se ha implementado.

Alcance: solo interfaz. No cambia reglas comerciales, Supabase, contratos, comisiones, financiamiento ni inventario. Reutiliza los componentes existentes (shadcn/ui, `PageHeader`, la vista en tarjetas de Inventario) y no agrega dependencias.

## Método

- **Pantallas:** 14, en escritorio (1440 px) y en celular (390 px).
  - Se usó la vista de demostración existente (`marketing/sistema-gestion-inmobiliaria/capturas`), con datos ficticios en memoria. No toca producción.
  - Se revisó en pantalla el perfil Administrador. Los demás perfiles se revisaron por su menú en `src/app/navigation.ts`.
- **Código:** navegación, diseño base (`src/index.css`, `src/components/AppLayout.tsx`) y conteo de patrones repetidos.
- **Criterios:**
  - Las pautas del skill **UI UX Pro Max** v2.15.0, instalado en `.claude/skills/ui-ux-pro-max`: accesibilidad, interacción táctil, formularios, tablas y navegación. Estilo recomendado para herramientas internas: *Minimalism & Swiss*.
  - El **manual de marca AMURA**: carbón y arena; Roclette, Anteroly y Wix Madefor.
  - Las paletas y tipografías automáticas del skill se descartaron: son para páginas de venta (verde azulado, Cinzel, glassmorphism) y no para una herramienta comercial con identidad propia.

## Lo que funciona y se conserva

- **Guía de venta:** el flujo guiado de Atender cliente, con «Ahora toca» y el botón del siguiente paso.
- **Ficha del cliente:**
  - Siguiente paso destacado.
  - WhatsApp.
  - Próxima actividad en la misma ficha.
  - Etapas en un clic.
- **Inventario en el celular:** tarjetas por departamento (el único listado adaptado).
- **Encabezado de página común:** sección, título, descripción y acciones.
- **Atajos y vacíos:** atajos de vigencia (8, 15 y 30 días) y estados vacíos con texto claro.

## Hallazgos

| # | Área | Hallazgo | Evidencia |
|---|---|---|---|
| H1 | Celular | Las tablas no se adaptan. | 41 archivos con tablas; solo Inventario tiene vista en tarjetas. En Clientes se cortan Asesor y Próxima actividad. Configuración se desborda: 919 px de ancho en una pantalla de 390. |
| H2 | Dashboard | Largo y sin jerarquía. | 2.870 px en escritorio y 4.917 px en celular. El banner de marca va primero. Once indicadores pesan igual, varios en 0, y hay etiquetas cortadas («Clientes registrad…», «Contratos firmad…», «Cobros confirma…»). «Requiere acción» aparece después de los indicadores (en el celular, a unos 1.300 px). |
| H3 | Navegación | Menú largo para Administrador y Gerencia. | 21 y 18 opciones. Con 900 px de alto quedan 8 ocultas; en Gestión comercial, la opción activa no se ve. |
| H4 | Navegación | El embudo está repartido. | Clientes (vista Tablero), Gestión comercial (agenda y embudo) y Dashboard de equipo muestran el seguimiento por separado. |
| H5 | Navegación | La búsqueda global solo busca módulos. | El texto «Buscar en tu espacio de trabajo…» promete más. No encuentra clientes, departamentos ni cotizaciones. |
| H6 | Celular | Sin navegación inferior. | El vendedor abre el menú lateral para cada cambio de pantalla. |
| H7 | Identidad | La paleta no es la de la marca. | Azul `#3563f3` y menú azul marino, frente a la marca en carbón y arena. El logo va en una caja blanca sobre el menú oscuro. La marca solo aparece en el banner y la presentación. |
| H8 | Legibilidad | Texto muy pequeño y contraste justo. | 438 usos de 11 px, 83 de 10 px y títulos de grupo del menú en 9 px. El texto secundario `#67758c` sobre el fondo `#f5f7fb` tiene contraste 4,35:1 (WCAG AA pide 4,5:1). |
| H9 | Consistencia | Colores y controles sueltos. | 627 colores directos de Tailwind (emerald, amber, rose…) y 37 colores fijos en hexadecimal. 55 selectores nativos con otro estilo que los campos. Pestañas de poco contraste. |
| H10 | Ruido visual | Información repetida. | La etiqueta «PROSPECTO» aparece en cada fila de Clientes. En Cotizaciones, los datos del cliente son campos deshabilitados que parecen vacíos. |
| H11 | Flujo | El orden de Atender cliente confunde. | Los pasos 1 y 3 van lado a lado y el 2 debajo. «Ventas iniciadas · Continuar operación» queda al final, después de la galería. |
| H12 | Flujo | La agenda no tiene acción en la fila. | En Gestión comercial, 18 filas dicen «Programa la siguiente actividad» y hay que abrir cada cliente. |

## Mejoras por prioridad

Esfuerzo: **B** bajo (horas), **M** medio (1–2 días), **A** alto (3 días o más).

### Prioridad 1 · Uso diario y celular

| # | Mejora | Pantallas | Esfuerzo | Se acepta cuando |
|---|---|---|---|---|
| P1.1 | Listados que pasan a tarjetas en el celular, con un componente común que reutiliza el patrón de Inventario. Corregir el desborde de Configuración. | Clientes, Cotizaciones, Reservas, Ventas, Cobranzas, Pagos por verificar, Comisiones, Configuración | M | Sin desplazamiento horizontal en 390 px; los datos clave y la acción principal se ven en cada tarjeta. |
| P1.2 | Dashboard por acción: «Requiere acción» y «Tu día» arriba; 4 a 6 indicadores según el perfil; el resto, plegable. Banner de marca compacto y estados vacíos en una línea. | Dashboard, Dashboard de equipo, Dashboard financiero | M | Lo accionable cabe en la primera pantalla en escritorio y en el celular; ninguna etiqueta se corta. |
| P1.3 | Barra inferior en el celular para Vendedor y Supervisor: Inicio, Clientes, Atender, Inventario y Más. | Toda la app en el celular | M | Cada pantalla frecuente queda a un toque, sin abrir el menú lateral. |
| P1.4 | Menú lateral con grupos plegables, la opción activa siempre visible y las secciones por frecuencia de uso. No se quitan módulos ni permisos. | Menú lateral | B | Administrador y Gerencia ven su sección de trabajo sin desplazar el menú. |
| P1.5 | Búsqueda global de clientes (nombre, celular, cédula), departamentos y cotizaciones, además de módulos, con los datos ya cargados. | Barra superior (Ctrl+K) | M | Desde cualquier pantalla se abre la ficha de un cliente en dos pasos. |
| P1.6 | Legibilidad: texto mínimo de 12 px (cuerpo de 14 px en el celular), contraste mínimo de 4,5:1 y títulos de grupo del menú más grandes. | Toda la app | B | Ningún texto de lectura menor a 12 px; contraste comprobado. |

### Prioridad 2 · Menos clics en el trabajo comercial

| # | Mejora | Pantallas | Esfuerzo | Se acepta cuando |
|---|---|---|---|---|
| P2.1 | Contadores que filtran en un clic: Por contactar, Para hoy, Vencidas y Sin próxima actividad. Reemplazan las tarjetas de total, activos y perdidos. | Clientes | B | Un clic filtra la lista; el número coincide con la lista. |
| P2.2 | Acciones rápidas en cada cliente: WhatsApp, llamar y programar, sin abrir la ficha. «PROSPECTO» solo cuando aporta. | Clientes, Gestión comercial | M | Programar la siguiente actividad toma un paso desde la lista. |
| P2.3 | Atender cliente con «Continuar donde quedaste» arriba, los pasos en orden 1→2→3 y la presentación plegada al inicio. | Atender cliente | B | Retomar una operación toma un clic desde la pantalla. |
| P2.4 | Cotización con los datos del cliente como resumen de solo lectura y el resumen de precio y cuota siempre visible. | Cotizaciones | B | Sin campos deshabilitados que parezcan vacíos. |
| P2.5 | Embudo en un solo lugar: el Tablero de Clientes como vista del embudo; Gestión comercial como agenda, con enlaces cruzados. | Clientes, Gestión comercial | M | Cada etapa lleva a su lista filtrada. |
| P2.6 | Formularios: validación al salir del campo, error junto al campo y resumen de errores al guardar; campos de 16 px en el celular (evita el zoom). | Formularios de cliente, reserva, pago y configuración | M | Ningún error aparece solo arriba ni solo al enviar. |

### Prioridad 3 · Identidad premium y consistencia

| # | Mejora | Pantallas | Esfuerzo | Se acepta cuando |
|---|---|---|---|---|
| P3.1 | Tema AMURA en los tokens de `src/index.css`: menú lateral en carbón (`#262626`), arena (`#DDD3BF`) como acento de marca, logo sobre carbón sin caja blanca y un color de acción sobrio. Contraste comprobado (arena sobre carbón: 10,2:1). | Toda la app | M | Ningún color fijo en los componentes del marco; el contraste es AA en todo. |
| P3.2 | Un solo componente de estado para unidad, etapa, reserva y pago, con tokens éxito, aviso, peligro e información. | Inventario, Clientes, Reservas, Ventas, Cobranzas | M | Los colores directos de Tailwind para estados se reemplazan. |
| P3.3 | Controles uniformes: selector nativo con el estilo de los campos (mejor en el celular), pestañas más visibles, botones de 40 px (44 px en el celular) y cifras alineadas en las tablas. | Toda la app | M | Un mismo control se ve igual en todas las pantallas. |
| P3.4 | Tipografía: Roclette solo en títulos de marca; Wix Madefor, del manual, o la Geist actual para el texto. | Toda la app | B | Decisión aprobada y aplicada en los tokens. |
| P3.5 | Gráficos con leyenda y etiquetas, sin depender solo del color; vacíos compactos. | Dashboards | B | Cada gráfico se entiende sin distinguir colores. |

## Decisiones pendientes

1. Empezar por la prioridad 1, o cambiar el orden.
2. Aplicar el tema AMURA (carbón y arena) al marco de la app.
3. Tipografía del texto: Wix Madefor (manual de marca) o la Geist actual.
4. Barra inferior en el celular para Vendedor y Supervisor.

## Cómo se implementa

- Por fases, en el código existente, con las pruebas al día. Cada fase lleva capturas antes y después, en escritorio y en celular.
- Sin publicar en A2 Hosting hasta la aprobación del usuario.
