// Competencia FRATELLI (Isla Celeste). Fuente: "INVENTARIOS - LISTA DE PRECIOS INCIIAL.xlsx" recibido el 26/10/2026,
// tal como lo incorpora la hoja "Competencia FRATELLI" del simulador AMURA (28/10/2026). No editar a mano.
export interface FratelliUnit {
  torre: string
  depto: string
  planta: string
  modelo: string
  dptoM2: number
  bodegaM2: number
  patioM2: number
  precioBase: number
  precioTotal: number
  estado: string
  plazoMeses: number
  entregaEstimada: string
  patioBalcon: string
}

type Row = [string, string, string, string, number, number, number, number, number, string, number, string, string]

const ROWS: Row[] = [
  ["A", "1-1", "PB", "C", 79, 1.44, 0, 175800, 172121.44, "En negociacion", 30, "04/03/2029", "PB sin patio*"],
  ["A", "1-2", "PB", "C", 79, 1.44, 0, 175800, 172121.44, "En negociacion", 30, "04/03/2029", "PB sin patio*"],
  ["A", "1-3", "PB", "A", 79, 1.5, 73.86, 175800, 188042.77, "En negociacion", 30, "04/03/2029", "Patio privado"],
  ["A", "1-4", "PB", "B", 79, 1.45, 53.75, 175800, 177927.94, "En negociacion", 30, "04/03/2029", "Patio privado"],
  ["A", "1-5", "PB", "A", 79, 1.5, 100.36, 175800, 194667.77, "Disponible", 30, "04/03/2029", "Patio privado"],
  ["A", "1-6", "1", "C", 79, 1.44, 0, 170800, 174742.58, "En negociacion", 30, "04/03/2029", "Balcon"],
  ["A", "1-7", "1", "C", 79, 1.44, 0, 170800, 174742.58, "En negociacion", 30, "04/03/2029", "Balcon"],
  ["A", "1-8", "1", "A", 79, 1.5, 0, 170800, 172160.17, "En negociacion", 30, "04/03/2029", "Balcon"],
  ["A", "1-9", "1", "B", 79, 1.45, 0, 170800, 166995.37, "En negociacion", 30, "04/03/2029", "Balcon"],
  ["A", "1-10", "1", "A", 79, 1.5, 0, 170800, 172160.17, "Disponible", 30, "04/03/2029", "Balcon"],
  ["A", "1-11", "2", "C", 79, 1.44, 0, 165800, 177363.71, "Disponible", 30, "04/03/2029", "Balcon"],
  ["A", "1-12", "2", "C", 79, 1.44, 0, 165800, 177363.71, "Disponible", 30, "04/03/2029", "Balcon"],
  ["A", "1-13", "2", "A", 79, 1.5, 0, 165800, 174742.58, "En negociacion", 30, "04/03/2029", "Balcon"],
  ["A", "1-14", "2", "B", 79, 1.45, 0, 165800, 169500.3, "En negociacion", 30, "04/03/2029", "Balcon"],
  ["A", "1-15", "2", "A", 79, 1.5, 0, 165800, 174742.58, "En negociacion", 30, "04/03/2029", "Balcon"],
  ["A", "1-16", "3", "C", 79, 1.44, 0, 160800, 179984.85, "Disponible", 30, "04/03/2029", "Balcon"],
  ["A", "1-17", "3", "C", 79, 1.44, 0, 160800, 179984.85, "Disponible", 30, "04/03/2029", "Balcon"],
  ["A", "1-18", "3", "A", 79, 1.5, 0, 160800, 177324.98, "Disponible", 30, "04/03/2029", "Balcon"],
  ["A", "1-19", "3", "B", 79, 1.45, 0, 160800, 172005.23, "En negociacion", 30, "04/03/2029", "Balcon"],
  ["A", "1-20", "3", "A", 79, 1.5, 0, 160800, 177324.98, "Disponible", 30, "04/03/2029", "Balcon"],
  ["B", "2-1", "PB", "C", 79, 1.44, 0, 183800, 177135.85, "Disponible", 36, "04/09/2029", "PB sin patio*"],
  ["B", "2-2", "PB", "C", 79, 1.44, 0, 183800, 177135.85, "Disponible", 36, "04/09/2029", "PB sin patio*"],
  ["B", "2-3", "PB", "A", 79, 1.5, 90.38, 183800, 197113.08, "Disponible", 36, "04/09/2029", "Patio privado"],
  ["B", "2-4", "PB", "B", 79, 1.45, 53.57, 183800, 182675.03, "Disponible", 36, "04/09/2029", "Patio privado"],
  ["B", "2-5", "PB", "A", 79, 1.5, 102.89, 183800, 200240.58, "Disponible", 36, "04/09/2029", "Patio privado"],
  ["B", "2-6", "1", "C", 79, 1.44, 0, 178800, 179833.35, "Disponible", 36, "04/09/2029", "Balcon"],
  ["B", "2-7", "1", "C", 79, 1.44, 0, 178800, 179833.35, "Disponible", 36, "04/09/2029", "Balcon"],
  ["B", "2-8", "1", "A", 79, 1.5, 0, 178800, 177175.71, "Disponible", 36, "04/09/2029", "Balcon"],
  ["B", "2-9", "1", "B", 79, 1.45, 0, 178800, 171860.44, "En negociacion", 36, "04/09/2029", "Balcon"],
  ["B", "2-10", "1", "A", 79, 1.5, 0, 178800, 177175.71, "Disponible", 36, "04/09/2029", "Balcon"],
  ["B", "2-11", "2", "C", 79, 1.44, 0, 173800, 182530.85, "Disponible", 36, "04/09/2029", "Balcon"],
  ["B", "2-12", "2", "C", 79, 1.44, 0, 173800, 182530.85, "Disponible", 36, "04/09/2029", "Balcon"],
  ["B", "2-13", "2", "A", 79, 1.5, 0, 173800, 179833.35, "Disponible", 36, "04/09/2029", "Balcon"],
  ["B", "2-14", "2", "B", 79, 1.45, 0, 173800, 174438.35, "Disponible", 36, "04/09/2029", "Balcon"],
  ["B", "2-15", "2", "A", 79, 1.5, 0, 173800, 179833.35, "Disponible", 36, "04/09/2029", "Balcon"],
  ["B", "2-16", "3", "C", 79, 1.44, 0, 168800, 185228.35, "Disponible", 36, "04/09/2029", "Balcon"],
  ["B", "2-17", "3", "C", 79, 1.44, 0, 168800, 185228.35, "Disponible", 36, "04/09/2029", "Balcon"],
  ["B", "2-18", "3", "A", 79, 1.5, 0, 168800, 182490.98, "Disponible", 36, "04/09/2029", "Balcon"],
  ["B", "2-19", "3", "B", 79, 1.45, 0, 168800, 177016.25, "Disponible", 36, "04/09/2029", "Balcon"],
  ["B", "2-20", "3", "A", 79, 1.5, 0, 168800, 182490.98, "Disponible", 36, "04/09/2029", "Balcon"],
  ["C", "3-1", "PB", "C", 79, 1.44, 0, 191860, 182541.65, "Disponible", 42, "04/03/2030", "PB sin patio*"],
  ["C", "3-2", "PB", "C", 79, 1.44, 0, 191800, 182541.65, "Disponible", 42, "04/03/2030", "PB sin patio*"],
  ["C", "3-3", "PB", "A", 79, 1.5, 102.89, 191800, 205566.49, "Disponible", 42, "04/03/2030", "Patio privado"],
  ["C", "3-4", "PB", "B", 79, 1.45, 53.57, 191800, 187841.17, "Disponible", 42, "04/03/2030", "Patio privado"],
  ["C", "3-5", "PB", "A", 79, 1.5, 90.39, 191800, 202441.49, "Disponible", 42, "04/03/2030", "Patio privado"],
  ["C", "3-6", "1", "C", 79, 1.44, 0, 186800, 185321.48, "Disponible", 42, "04/03/2030", "Balcon"],
  ["C", "3-7", "1", "C", 79, 1.44, 0, 186800, 185321.48, "Disponible", 42, "04/03/2030", "Balcon"],
  ["C", "3-8", "1", "A", 79, 1.5, 0, 186800, 182582.74, "Disponible", 42, "04/03/2030", "Balcon"],
  ["C", "3-9", "1", "B", 79, 1.45, 0, 186800, 177105.25, "Disponible", 42, "04/03/2030", "Balcon"],
  ["C", "3-10", "1", "A", 79, 1.5, 0, 186800, 182582.74, "Disponible", 42, "04/03/2030", "Balcon"],
  ["C", "3-11", "2", "C", 79, 1.44, 0, 181800, 188101.3, "Disponible", 42, "04/03/2030", "Balcon"],
  ["C", "3-12", "2", "C", 79, 1.44, 0, 181800, 188101.3, "Disponible", 42, "04/03/2030", "Balcon"],
  ["C", "3-13", "2", "A", 79, 1.5, 0, 181800, 185321.48, "Disponible", 42, "04/03/2030", "Balcon"],
  ["C", "3-14", "2", "B", 79, 1.45, 0, 181800, 179761.83, "Disponible", 42, "04/03/2030", "Balcon"],
  ["C", "3-15", "2", "A", 79, 1.5, 0, 181800, 185321.48, "Disponible", 42, "04/03/2030", "Balcon"],
  ["C", "3-16", "3", "C", 79, 1.44, 0, 176800, 190881.12, "Disponible", 42, "04/03/2030", "Balcon"],
  ["C", "3-17", "3", "C", 79, 1.44, 0, 176800, 190881.12, "Disponible", 42, "04/03/2030", "Balcon"],
  ["C", "3-18", "3", "A", 79, 1.5, 0, 176800, 188060.22, "Disponible", 42, "04/03/2030", "Balcon"],
  ["C", "3-19", "3", "B", 79, 1.45, 0, 176800, 182418.41, "Disponible", 42, "04/03/2030", "Balcon"],
  ["C", "3-20", "3", "A", 79, 1.5, 0, 176800, 188060.22, "Disponible", 42, "04/03/2030", "Balcon"],
]

export const FRATELLI: FratelliUnit[] = ROWS.map(([torre, depto, planta, modelo, dptoM2, bodegaM2, patioM2, precioBase, precioTotal, estado, plazoMeses, entregaEstimada, patioBalcon]) => ({
  torre, depto, planta, modelo, dptoM2, bodegaM2, patioM2, precioBase, precioTotal, estado, plazoMeses, entregaEstimada, patioBalcon,
}))

export const FUENTE_FRATELLI = 'INVENTARIOS - LISTA DE PRECIOS INCIIAL.xlsx (FRATELLI, recibido el 26/10/2026)'
