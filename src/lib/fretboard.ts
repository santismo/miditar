import type { MidiNote, MidiPlacement } from './midi'

export type GuitarString = {
  index: number
  name: string
  midi: number
  channel: number
  color: string
}

export type FretCandidate = {
  stringIndex: number
  fret: number
}

export const GUITAR_STRINGS: GuitarString[] = [
  { index: 0, name: 'E4', midi: 64, channel: 11, color: '#d64b4b' },
  { index: 1, name: 'B3', midi: 59, channel: 12, color: '#df8b2d' },
  { index: 2, name: 'G3', midi: 55, channel: 13, color: '#c6a63d' },
  { index: 3, name: 'D3', midi: 50, channel: 14, color: '#3d9d6a' },
  { index: 4, name: 'A2', midi: 45, channel: 15, color: '#397fd1' },
  { index: 5, name: 'E2', midi: 40, channel: 16, color: '#8358d8' },
]

export function candidatesForNote(midi: number, maxFret = 24): FretCandidate[] {
  return GUITAR_STRINGS.flatMap((string) => {
    const fret = midi - string.midi
    if (fret < 0 || fret > maxFret) return []
    return [{ stringIndex: string.index, fret }]
  })
}

function average(values: number[]) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function groupByStart(notes: MidiNote[]) {
  const groups = new Map<number, MidiNote[]>()
  for (const note of notes) {
    if (!groups.has(note.tick)) groups.set(note.tick, [])
    groups.get(note.tick)!.push(note)
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, group]) => [...group].sort((a, b) => a.midi - b.midi))
}

function scoreGroup(notes: MidiNote[], placements: FretCandidate[], previousPosition: number | null) {
  const strings = placements.map((placement) => placement.stringIndex)
  if (new Set(strings).size !== strings.length) return Number.POSITIVE_INFINITY

  for (let index = 1; index < notes.length; index += 1) {
    const lower = placements[index - 1]
    const higher = placements[index]
    if (notes[index - 1].midi < notes[index].midi && lower.stringIndex <= higher.stringIndex) {
      return Number.POSITIVE_INFINITY
    }
  }

  const fretted = placements.map((placement) => placement.fret).filter((fret) => fret > 0)
  const frets = placements.map((placement) => placement.fret)
  const center = fretted.length ? average(fretted) : average(frets)
  const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0
  const movement = previousPosition === null ? Math.abs(center - 5) * 0.25 : Math.abs(center - previousPosition)
  const highFretPenalty = frets.reduce((sum, fret) => sum + Math.max(0, fret - 12) * 0.45, 0)
  const openPenalty = frets.filter((fret) => fret === 0).length * 0.2
  const stringSpread = Math.max(...strings) - Math.min(...strings)

  return movement * 1.25 + span * 1.1 + highFretPenalty + openPenalty + stringSpread * 0.12
}

function chooseGroup(
  notes: MidiNote[],
  previousPosition: number | null,
  maxFret: number,
): FretCandidate[] {
  const candidateSets = notes.map((note) => candidatesForNote(note.midi, maxFret))
  if (candidateSets.some((set) => set.length === 0)) return []

  let bestScore = Number.POSITIVE_INFINITY
  let best: FretCandidate[] = []

  const search = (index: number, current: FretCandidate[]) => {
    if (index === candidateSets.length) {
      const score = scoreGroup(notes, current, previousPosition)
      if (score < bestScore) {
        bestScore = score
        best = [...current]
      }
      return
    }

    for (const candidate of candidateSets[index]) {
      if (current.some((placement) => placement.stringIndex === candidate.stringIndex)) continue
      current.push(candidate)
      search(index + 1, current)
      current.pop()
    }
  }

  search(0, [])
  return best
}

export function mapNotesToFretboard(notes: MidiNote[], maxFret = 24) {
  const placements = new Map<string, MidiPlacement>()
  let previousPosition: number | null = null

  for (const group of groupByStart(notes)) {
    const selected = chooseGroup(group, previousPosition, maxFret)
    if (!selected.length) continue

    for (let index = 0; index < group.length; index += 1) {
      const placement = selected[index]
      placements.set(group[index].id, {
        noteId: group[index].id,
        stringIndex: placement.stringIndex,
        fret: placement.fret,
      })
    }

    const fretted = selected.map((placement) => placement.fret).filter((fret) => fret > 0)
    if (fretted.length) previousPosition = average(fretted)
  }

  return placements
}

export function placementLabel(placement: MidiPlacement) {
  const string = GUITAR_STRINGS[placement.stringIndex]
  return `${string.name} string, fret ${placement.fret}`
}
