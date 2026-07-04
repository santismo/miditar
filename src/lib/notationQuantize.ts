const EVEN_DIVISIONS_PER_QUARTER = 8
const TRIPLET_DIVISIONS_PER_QUARTER = 12

function nearestGrid(value: number, unit: number) {
  return Math.round(value / unit) * unit
}

export function quantizeDisplayTick(localTick: number, ppq: number, maxTick: number) {
  const even = nearestGrid(localTick, ppq / EVEN_DIVISIONS_PER_QUARTER)
  const triplet = nearestGrid(localTick, ppq / TRIPLET_DIVISIONS_PER_QUARTER)
  const quantized = Math.abs(localTick - triplet) < Math.abs(localTick - even) ? triplet : even
  return Math.min(maxTick, Math.max(0, quantized))
}

export function minimumDisplayUnit(ppq: number) {
  return Math.min(ppq / EVEN_DIVISIONS_PER_QUARTER, ppq / TRIPLET_DIVISIONS_PER_QUARTER)
}
