import type { MidiNote, MidiPlacement } from './midi'
import { DEFAULT_STRING_CHANNEL_MAP, stringIndexForChannel, type StringChannelMap } from './stringChannels'

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
  midi: number
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
    return [{ stringIndex: string.index, fret, midi }]
  })
}

export type FretboardMapOptions = {
  maxFret?: number
  smart?: boolean
  smartMelody?: boolean
  melodyTrackIndexes?: Set<number>
  bassTrackIndexes?: Set<number>
  sourceChannelMap?: StringChannelMap
  useSourceChannels?: boolean
}

type NormalizedNote = {
  note: MidiNote
  midi: number
  role: 'bass' | 'melody' | 'harmony'
  priority: number
}

const MAX_SMART_NOTES = 6
const MAX_SMART_FRETTED_SPAN = 5
const LOWEST_GUITAR_MIDI = GUITAR_STRINGS[GUITAR_STRINGS.length - 1].midi
const MAX_SMART_CANDIDATES_PER_NOTE = 8

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

function fitMidiToGuitar(midi: number, maxFret: number) {
  const highest = GUITAR_STRINGS[0].midi + maxFret
  let fitted = midi
  while (fitted < LOWEST_GUITAR_MIDI) fitted += 12
  while (fitted > highest) fitted -= 12
  while (fitted < LOWEST_GUITAR_MIDI) fitted += 12
  return fitted
}

function normalizeNote(note: MidiNote, options: RequiredSmartOptions): NormalizedNote {
  const isMelody = options.melodyTrackIndexes.has(note.trackIndex)
  const isBass = options.bassTrackIndexes.has(note.trackIndex)
  const role = isMelody ? 'melody' : isBass ? 'bass' : 'harmony'
  const midi = isMelody && options.smartMelody ? note.midi : fitMidiToGuitar(note.midi, options.maxFret)
  const priority = role === 'melody' ? 0 : role === 'bass' ? 1 : 2

  return { note, midi, role, priority }
}

type RequiredSmartOptions = {
  maxFret: number
  smartMelody: boolean
  melodyTrackIndexes: Set<number>
  bassTrackIndexes: Set<number>
  sourceChannelMap: StringChannelMap
  useSourceChannels: boolean
}

function melodyIndex(notes: NormalizedNote[]) {
  let bestIndex: number | null = null
  for (let index = 0; index < notes.length; index += 1) {
    if (notes[index].role !== 'melody') continue
    if (bestIndex === null || notes[index].midi > notes[bestIndex].midi) bestIndex = index
  }
  return bestIndex
}

function reduceSmartGroup(group: MidiNote[], options: RequiredSmartOptions) {
  const normalized = group
    .map((note) => normalizeNote(note, options))
    .sort((a, b) => a.midi - b.midi || a.priority - b.priority || b.note.velocity - a.note.velocity)

  if (normalized.length <= MAX_SMART_NOTES) return normalized

  const keep = new Map<string, NormalizedNote>()
  const bass = normalized.find((item) => item.role === 'bass')
  const melody = [...normalized].reverse().find((item) => item.role === 'melody')
  if (bass) keep.set(bass.note.id, bass)
  if (melody) keep.set(melody.note.id, melody)

  const anchor = melody?.midi ?? average(normalized.map((item) => item.midi))
  const usedPitchClasses = new Set([...keep.values()].map((item) => item.midi % 12))
  const candidates = normalized
    .filter((item) => !keep.has(item.note.id))
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        Number(usedPitchClasses.has(a.midi % 12)) - Number(usedPitchClasses.has(b.midi % 12)) ||
        Math.abs(a.midi - anchor) - Math.abs(b.midi - anchor) ||
        b.note.velocity - a.note.velocity,
    )

  for (const item of candidates) {
    if (keep.size >= MAX_SMART_NOTES) break
    keep.set(item.note.id, item)
    usedPitchClasses.add(item.midi % 12)
  }

  return [...keep.values()].sort((a, b) => a.midi - b.midi || a.priority - b.priority)
}

function scoreGroup(
  notes: NormalizedNote[],
  placements: FretCandidate[],
  previousPosition: number | null,
) {
  const strings = placements.map((placement) => placement.stringIndex)
  if (new Set(strings).size !== strings.length) return Number.POSITIVE_INFINITY

  for (let index = 1; index < notes.length; index += 1) {
    const lower = placements[index - 1]
    const higher = placements[index]
    if (lower.midi < higher.midi && lower.stringIndex <= higher.stringIndex) {
      return Number.POSITIVE_INFINITY
    }
  }

  const fretted = placements.map((placement) => placement.fret).filter((fret) => fret > 0)
  const frets = placements.map((placement) => placement.fret)
  const center = fretted.length ? average(fretted) : average(frets)
  const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0
  if (span > MAX_SMART_FRETTED_SPAN) return Number.POSITIVE_INFINITY

  const melody = melodyIndex(notes)
  const melodyPlacement = melody === null ? null : placements[melody]
  const movement = previousPosition === null ? Math.abs(center - 5) * 0.25 : Math.abs(center - previousPosition)
  const highFretPenalty = frets.reduce((sum, fret) => sum + Math.max(0, fret - 12) * 0.45, 0)
  const openPenalty = frets.filter((fret) => fret === 0).length * 0.06
  const stringSpread = Math.max(...strings) - Math.min(...strings)
  const octaveShiftPenalty = placements.reduce((sum, placement, index) => {
    const note = notes[index]
    const weight = note.role === 'melody' ? 1.35 : note.role === 'bass' ? 0.35 : 0.75
    return sum + (Math.abs(placement.midi - note.note.midi) / 12) * weight
  }, 0)
  const melodyFretPenalty =
    melodyPlacement && melodyPlacement.fret > 0 ? Math.max(0, Math.abs(center - melodyPlacement.fret) - 2) * 1.4 : 0
  const melodyStringPenalty = melodyPlacement ? Math.max(0, melodyPlacement.stringIndex - 2) * 0.38 : 0

  return (
    movement * 1.25 +
    span * 1.1 +
    highFretPenalty +
    openPenalty +
    stringSpread * 0.12 +
    octaveShiftPenalty +
    melodyFretPenalty +
    melodyStringPenalty
  )
}

function midiOptionsForNote(note: NormalizedNote, options: RequiredSmartOptions) {
  if (note.role === 'melody' && options.smartMelody) return [note.note.midi]

  const maxFret = options.maxFret
  const highest = GUITAR_STRINGS[0].midi + maxFret
  const midiChoices = new Set<number>([note.midi])
  const upOctaves = note.role === 'bass' ? 2 : note.role === 'harmony' ? 1 : 0
  const downOctaves = note.role === 'melody' ? 1 : note.role === 'harmony' ? 1 : 0

  for (let octave = 1; octave <= upOctaves; octave += 1) {
    const midi = note.midi + octave * 12
    if (midi <= highest) midiChoices.add(midi)
  }

  for (let octave = 1; octave <= downOctaves; octave += 1) {
    const midi = note.midi - octave * 12
    if (midi >= LOWEST_GUITAR_MIDI) midiChoices.add(midi)
  }

  return [...midiChoices].sort((a, b) => Math.abs(a - note.note.midi) - Math.abs(b - note.note.midi))
}

function scoreCandidateForNote(note: NormalizedNote, candidate: FretCandidate) {
  const octaveShift = Math.abs(candidate.midi - note.note.midi) / 12
  const roleString =
    note.role === 'melody'
      ? candidate.stringIndex * 0.24
      : note.role === 'bass'
        ? Math.max(0, 3 - candidate.stringIndex) * 0.28
        : 0
  const fretCost = candidate.fret === 0 ? -0.08 : Math.max(0, candidate.fret - 9) * 0.18
  const roleWeight = note.role === 'melody' ? 1.2 : note.role === 'bass' ? 0.32 : 0.7
  return octaveShift * roleWeight + roleString + fretCost
}

function smartCandidatesForNote(note: NormalizedNote, options: RequiredSmartOptions) {
  return midiOptionsForNote(note, options)
    .flatMap((midi) => candidatesForNote(midi, options.maxFret))
    .sort((a, b) => scoreCandidateForNote(note, a) - scoreCandidateForNote(note, b))
    .slice(0, MAX_SMART_CANDIDATES_PER_NOTE)
}

function chooseGroup(
  notes: NormalizedNote[],
  previousPosition: number | null,
  options: RequiredSmartOptions,
): FretCandidate[] {
  const candidateSets = notes.map((note) => smartCandidatesForNote(note, options))
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

function chooseLiteralPlacement(note: MidiNote, previousPosition: number | null, maxFret: number) {
  const candidates = candidatesForNote(note.midi, maxFret)
  if (!candidates.length) return null
  return [...candidates].sort((a, b) => {
    const aFret = a.fret || previousPosition || 5
    const bFret = b.fret || previousPosition || 5
    const target = previousPosition ?? 5
    return Math.abs(aFret - target) - Math.abs(bFret - target) || a.stringIndex - b.stringIndex
  })[0]
}

function chooseSourceChannelPlacement(note: MidiNote, options: RequiredSmartOptions): FretCandidate | null {
  if (!options.useSourceChannels) return null
  const stringIndex = stringIndexForChannel(options.sourceChannelMap, note.channel)
  if (stringIndex < 0) return null
  const fret = note.midi - GUITAR_STRINGS[stringIndex].midi
  if (fret < 0 || fret > options.maxFret) return null
  return { stringIndex, fret, midi: note.midi }
}

function bestSmartVoicing(
  group: MidiNote[],
  options: RequiredSmartOptions,
  previousPosition: number | null,
) {
  let notes = reduceSmartGroup(group, options)

  while (notes.length) {
    const selected = chooseGroup(notes, previousPosition, options)
    if (selected.length) return { notes, selected }

    const melody = melodyIndex(notes)
    const removable = notes
      .map((note, index) => ({ note, index }))
      .filter(({ note, index }) => note.role === 'harmony' && index !== melody)
      .sort((a, b) => a.note.note.velocity - b.note.note.velocity)

    if (!removable.length) break
    notes = notes.filter((_, index) => index !== removable[0].index)
  }

  return { notes: [], selected: [] }
}

function normalizeOptions(optionsOrMaxFret: FretboardMapOptions | number): RequiredSmartOptions & { smart: boolean } {
  if (typeof optionsOrMaxFret === 'number') {
    return {
      maxFret: optionsOrMaxFret,
      smart: true,
      smartMelody: false,
      melodyTrackIndexes: new Set(),
      bassTrackIndexes: new Set(),
      sourceChannelMap: DEFAULT_STRING_CHANNEL_MAP,
      useSourceChannels: false,
    }
  }

  return {
    maxFret: optionsOrMaxFret.maxFret ?? 24,
    smart: optionsOrMaxFret.smart ?? true,
    smartMelody: optionsOrMaxFret.smartMelody ?? false,
    melodyTrackIndexes: optionsOrMaxFret.melodyTrackIndexes ?? new Set(),
    bassTrackIndexes: optionsOrMaxFret.bassTrackIndexes ?? new Set(),
    sourceChannelMap: optionsOrMaxFret.sourceChannelMap ?? DEFAULT_STRING_CHANNEL_MAP,
    useSourceChannels: optionsOrMaxFret.useSourceChannels ?? false,
  }
}

export function mapNotesToFretboard(notes: MidiNote[], optionsOrMaxFret: FretboardMapOptions | number = 24) {
  const options = normalizeOptions(optionsOrMaxFret)
  const placements = new Map<string, MidiPlacement>()
  let previousPosition: number | null = null

  if (!options.smart) {
    for (const note of [...notes].sort((a, b) => a.tick - b.tick || a.midi - b.midi)) {
      const placement: FretCandidate | null =
        chooseSourceChannelPlacement(note, options) ?? chooseLiteralPlacement(note, previousPosition, options.maxFret)
      if (!placement) continue
      placements.set(note.id, {
        noteId: note.id,
        stringIndex: placement.stringIndex,
        fret: placement.fret,
      })
      if (placement.fret > 0) previousPosition = placement.fret
    }
    return placements
  }

  for (const group of groupByStart(notes)) {
    const remaining = group.filter((note) => {
      const sourcePlacement = chooseSourceChannelPlacement(note, options)
      if (!sourcePlacement) return true
      placements.set(note.id, {
        noteId: note.id,
        stringIndex: sourcePlacement.stringIndex,
        fret: sourcePlacement.fret,
      })
      if (sourcePlacement.fret > 0) previousPosition = sourcePlacement.fret
      return false
    })
    if (!remaining.length) continue

    const { notes: normalized, selected } = bestSmartVoicing(remaining, options, previousPosition)
    if (!selected.length) continue

    for (let index = 0; index < normalized.length; index += 1) {
      const placement = selected[index]
      const note = normalized[index].note
      placements.set(note.id, {
        noteId: note.id,
        stringIndex: placement.stringIndex,
        fret: placement.fret,
        midi: placement.midi === note.midi ? undefined : placement.midi,
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
