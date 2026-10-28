import { useMemo, useState } from 'react'
import {
  flexRender, getCoreRowModel, getPaginationRowModel, getSortedRowModel, useReactTable,
  type ColumnDef, type RowSelectionState, type SortingState,
} from '@tanstack/react-table'
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { tieneDiscrepancia } from '../data/data-quality'
import { ESTADO_ORDEN, ESTADOS } from '../estados'
import { calcularPrecio, fmtM2, fmtNum, fmtUsd, type PriceBreakdown } from '../pricing'
import type { EstadoComercial, PricingParams, Unit } from '../types'
import { EstadoBadge, pisoCorto } from './shared'

export interface Filtros {
  q: string
  edificio: string
  piso: string
  tipologia: string
  estado: string
}
export const FILTROS_VACIOS: Filtros = { q: '', edificio: 'todos', piso: 'todos', tipologia: 'todos', estado: 'todos' }

type Row = Unit & { precio: PriceBreakdown; discrepancia: boolean }

const norm = (v: string) => v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export function filtrarUnidades(units: Unit[], f: Filtros) {
  const q = norm(f.q.trim())
  return units.filter((u) =>
    (f.edificio === 'todos' || String(u.edificio) === f.edificio) &&
    (f.piso === 'todos' || u.piso === f.piso) &&
    (f.tipologia === 'todos' || u.tipologia === f.tipologia) &&
    (f.estado === 'todos' || u.estado === f.estado) &&
    (!q || norm(`${u.codigo} ${u.dpt} ${u.ubicacion} ${u.tipologia} ${u.bodegaCodigo ?? ''}`).includes(q)),
  )
}

function SortHeader({ label, column, align = 'left' }: { label: string; align?: 'left' | 'right'; column: { getIsSorted: () => false | 'asc' | 'desc'; toggleSorting: (desc?: boolean) => void } }) {
  const s = column.getIsSorted()
  const Icon = s === 'asc' ? ArrowUp : s === 'desc' ? ArrowDown : ArrowUpDown
  return (
    <button type="button" onClick={() => column.toggleSorting(s === 'asc')}
      className={`inline-flex items-center gap-1 font-medium hover:text-foreground ${align === 'right' ? 'ml-auto flex-row-reverse' : ''}`}
      aria-label={`Ordenar por ${label}`}>
      {label}<Icon className={`size-3 ${s ? 'text-primary' : 'opacity-40'}`} aria-hidden="true" />
    </button>
  )
}

export default function UnitsTable({
  units, params, filtros, onFiltros, onOpen, seleccion, onSeleccion, seleccionable,
}: {
  units: Unit[]
  params: PricingParams
  filtros: Filtros
  onFiltros: (f: Filtros) => void
  onOpen: (codigo: string) => void
  seleccion: RowSelectionState
  onSeleccion: (s: RowSelectionState) => void
  seleccionable: boolean
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const data = useMemo<Row[]>(
    () => filtrarUnidades(units, filtros).map((u) => ({ ...u, precio: calcularPrecio(u, params), discrepancia: tieneDiscrepancia(u) })),
    [units, params, filtros],
  )

  const columns = useMemo<ColumnDef<Row>[]>(() => {
    const cols: ColumnDef<Row>[] = [
      {
        id: 'codigo', accessorKey: 'codigo',
        header: ({ column }) => <SortHeader label="Unidad" column={column} />,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <div>
              <div className="font-semibold text-foreground">{row.original.dpt}</div>
              <div className="text-[11px] text-muted-foreground">{row.original.codigo}</div>
            </div>
            {row.original.discrepancia && <AlertTriangle className="size-3.5 text-rose-600" aria-label="Dato con discrepancia" />}
          </div>
        ),
      },
      { id: 'edificio', accessorFn: (r) => r.edificio * 10 + (r.piso === 'PB' ? 0 : Number(r.piso)), header: ({ column }) => <SortHeader label="Ubicación" column={column} />,
        cell: ({ row }) => (<div><div>E{row.original.edificio} · {pisoCorto(row.original.piso)}</div><div className="max-w-40 truncate text-[11px] text-muted-foreground">{row.original.ubicacion}</div></div>) },
      { id: 'tipologia', accessorKey: 'tipologia', header: ({ column }) => <SortHeader label="Tipología" column={column} /> },
      { id: 'area', accessorFn: (r) => r.precio.areaVendibleM2, header: ({ column }) => <SortHeader label="Área + bod." column={column} align="right" />,
        cell: ({ row }) => <div className="text-right tabular-nums">{fmtM2(row.original.precio.areaVendibleM2)}</div> },
      { id: 'patio', accessorKey: 'patioM2', header: ({ column }) => <SortHeader label="Patio" column={column} align="right" />,
        cell: ({ row }) => <div className="text-right tabular-nums text-muted-foreground">{row.original.patioM2 ? fmtM2(row.original.patioM2) : '—'}</div> },
      { id: 'usdM2', accessorKey: 'usdM2', header: ({ column }) => <SortHeader label="USD/m²" column={column} align="right" />,
        cell: ({ row }) => <div className="text-right tabular-nums">{fmtNum(row.original.usdM2)}</div> },
      { id: 'precio', accessorFn: (r) => r.precio.precioVenta, header: ({ column }) => <SortHeader label="Precio de venta" column={column} align="right" />,
        cell: ({ row }) => <div className="text-right font-semibold tabular-nums">{fmtUsd(row.original.precio.precioVenta)}</div> },
      { id: 'cuota', accessorFn: (r) => r.precio.cuotaMensual, header: ({ column }) => <SortHeader label="Cuota" column={column} align="right" />,
        cell: ({ row }) => <div className="text-right tabular-nums text-muted-foreground">{fmtUsd(row.original.precio.cuotaMensual)}<span className="text-[10px]"> ×{row.original.precio.meses}</span></div> },
      { id: 'estado', accessorFn: (r) => ESTADO_ORDEN.indexOf(r.estado), header: ({ column }) => <SortHeader label="Estado" column={column} />,
        cell: ({ row }) => <EstadoBadge estado={row.original.estado} /> },
    ]
    if (seleccionable) {
      cols.unshift({
        id: 'sel', enableSorting: false,
        header: ({ table }) => (
          <Checkbox aria-label="Seleccionar unidades de esta página"
            checked={table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? 'indeterminate' : false}
            onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)} />
        ),
        cell: ({ row }) => (
          <Checkbox aria-label={`Seleccionar ${row.original.codigo}`} checked={row.getIsSelected()}
            onCheckedChange={(v) => row.toggleSelected(!!v)} onClick={(e) => e.stopPropagation()} />
        ),
      })
    }
    return cols
  }, [seleccionable])

  const table = useReactTable({
    data, columns,
    state: { sorting, rowSelection: seleccion },
    getRowId: (r) => r.codigo,
    enableRowSelection: seleccionable,
    onSortingChange: setSorting,
    onRowSelectionChange: (u) => onSeleccion(typeof u === 'function' ? u(seleccion) : u),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: true,
    initialState: { pagination: { pageSize: 15 } },
  })

  const set = (k: keyof Filtros) => (v: string) => onFiltros({ ...filtros, [k]: v })
  const activos = Object.entries(filtros).some(([k, v]) => (k === 'q' ? !!v : v !== 'todos'))
  const { pageIndex, pageSize } = table.getState().pagination
  const desde = data.length ? pageIndex * pageSize + 1 : 0
  const hasta = Math.min(data.length, (pageIndex + 1) * pageSize)

  return (
    <div className="dashboard-card !p-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <label htmlFor="inv-q" className="sr-only">Buscar unidad</label>
          <Input id="inv-q" value={filtros.q} onChange={(e) => set('q')(e.target.value)} placeholder="Buscar por código, DPT, ubicación o bodega" className="h-8 pl-8 text-xs" />
        </div>
        <FiltroSelect label="Edificio" value={filtros.edificio} onChange={set('edificio')} opciones={[['1', 'Edificio 1'], ['2', 'Edificio 2']]} />
        <FiltroSelect label="Piso" value={filtros.piso} onChange={set('piso')} opciones={(['PB', '1', '2', '3', '4', '5'] as const).map((p) => [p, p === 'PB' ? 'Planta baja' : `Piso ${p}`])} />
        <FiltroSelect label="Tipología" value={filtros.tipologia} onChange={set('tipologia')} opciones={[['1 hab', '1 hab'], ['2 hab', '2 hab'], ['2 hab + estudio', '2 hab + estudio']]} />
        <FiltroSelect label="Estado" value={filtros.estado} onChange={set('estado')} opciones={ESTADO_ORDEN.map((e: EstadoComercial) => [e, ESTADOS[e].label])} />
        {activos && <Button variant="ghost" size="sm" onClick={() => onFiltros(FILTROS_VACIOS)}><X />Limpiar</Button>}
      </div>
      <div className="overflow-x-auto">
        <Table className="text-xs">
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="bg-muted/50 hover:bg-muted/50">
                {hg.headers.map((h) => (
                  <TableHead key={h.id} className="h-9 text-[11px] text-muted-foreground" aria-sort={h.column.getIsSorted() === 'asc' ? 'ascending' : h.column.getIsSorted() === 'desc' ? 'descending' : undefined}>
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} data-state={row.getIsSelected() ? 'selected' : undefined}
                className="cursor-pointer" tabIndex={0}
                onClick={() => onOpen(row.original.codigo)}
                onKeyDown={(e) => { if (e.key === 'Enter') onOpen(row.original.codigo) }}
                aria-label={`Abrir ficha de ${row.original.codigo}`}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="py-2.5">{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                ))}
              </TableRow>
            )) : (
              <TableRow><TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">No hay unidades con estos filtros.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
        <span>{desde}–{hasta} de {data.length} unidades{Object.keys(seleccion).length ? ` · ${Object.keys(seleccion).length} seleccionadas` : ''}</span>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="Página anterior"><ChevronLeft /></Button>
          <span className="px-2 tabular-nums">Página {pageIndex + 1} de {Math.max(1, table.getPageCount())}</span>
          <Button variant="outline" size="icon-sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="Página siguiente"><ChevronRight /></Button>
        </div>
      </div>
    </div>
  )
}

function FiltroSelect({ label, value, onChange, opciones }: { label: string; value: string; onChange: (v: string) => void; opciones: (readonly [string, string])[] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="h-8 min-w-32 text-xs" aria-label={`Filtrar por ${label.toLowerCase()}`}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="todos">{label}: todos</SelectItem>
        {opciones.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}
