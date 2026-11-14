# Menús por rol

Fecha: 2026-11-12. Estado: **aprobado e implementado** para todos los roles.

## Cómo funciona

- **Menú y permisos, separados.** El menú de cada rol está en `MENU_POR_ROL`, en `src/app/navigation.ts`. Ocultar un módulo no quita permisos: las pantallas que usan esos datos siguen leyéndolos, y una ruta oculta se puede abrir desde un enlace si el rol tiene el permiso.
- **Pantalla de inicio.** Es el primer módulo de la lista del rol.
- **Módulos en construcción.** **Reportes** y **Centro de recursos** no aparecen para ningún rol mientras no estén desarrollados.
- **Sin SQL.** Cambiar un menú es una línea de código.

## Menús definitivos

| Rol | Menú lateral | Inicio |
|---|---|---|
| **Vendedor** | Dashboard, Atender cliente, Inventario, Financiamiento, Cotizaciones, Clientes, Gestión comercial, Reservas, Comisiones (solo las suyas) | Dashboard |
| **Corredor** | Igual que el Vendedor | Dashboard |
| **Supervisor** | Dashboard de equipo, Mi equipo, Cotizaciones, Clientes del equipo, Gestión comercial, Reservas, Ventas del equipo | Dashboard de equipo |
| **Gerencia** | Dashboard, Dashboard de equipo, Mi equipo, Atender cliente, Financiamiento, Gestión comercial, Clientes, Reservas, Ventas y contratos, Cotizaciones, Precios, Inventario, Corredores, Cobranzas, Comisiones, Avance de obra, Plan de implementación, Configuración (auditoría) | Dashboard |
| **Finanzas** | Pagos por verificar, Cobranzas, Ventas y contratos, Comisiones, Dashboard financiero | Pagos por verificar |
| **Legal** | Ventas y contratos, Clientes, Reservas | Ventas y contratos |
| **Oficial de Cumplimiento** | Bandeja de Cumplimiento, Clientes, Ventas y contratos | Bandeja de Cumplimiento |
| **Constructor** | Avance de obra, Inventario (técnico) | Avance de obra |
| **JARVAL (consulta)** | Dashboard, Inventario, Reservas, Ventas y contratos, Cobranzas, Avance de obra, Plan de implementación | Dashboard |
| **Administrador** | Todo lo que sus permisos abren, salvo los módulos en construcción | Dashboard |

## Lo que no cambia

- **Vendedor y Corredor** conservan `ventas.ver` y `cobranzas.ver`: las rutas siguen abiertas para ellos (por ejemplo, desde las tarjetas del Dashboard "Contratos firmados" y "Saldo por cobrar"), con el mismo alcance de siempre: solo sus clientes. Comisiones les muestra solo las propias; no calculan, aprueban ni liquidan.
- **Finanzas** conserva la lectura de clientes, inventario, reservas y cotizaciones que usan Cobranzas y la bandeja.
- **Un rol personalizado** creado en Configuración, sin entrada en `MENU_POR_ROL`, ve lo que sus permisos le dejan abrir.
