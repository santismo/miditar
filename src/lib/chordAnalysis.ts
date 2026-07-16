import { midiTicksToSeconds, type MidiMarker, type MidiNote, type ParsedMidi } from './midi'

export type ChordAnalysisOptions = {
  trackIndexes?: Set<number>
  subdivision?: 1 | 2 | 4
  minimumConfidence?: number
}

type ChordTemplate = {
  suffix: string
  intervals: number[]
  required: number[]
  complexity: number
}

type ChordCandidate = {
  label: string
  root: number
  intervals: number[]
  score: number
  confidence: number
}

const PITCH_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const PITCH_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

// Specific colors are considered before simpler subsets. The score still penalizes
// unnecessary extensions, so a plain triad does not become a thirteenth chord.
const CHORD_TEMPLATES: ChordTemplate[] = [
  { suffix: '13', intervals: [0, 4, 7, 10, 2, 9], required: [0, 4, 10, 9], complexity: 0.64 },
  { suffix: '13(b9)', intervals: [0, 4, 7, 10, 1, 9], required: [0, 4, 10, 1, 9], complexity: 0.72 },
  { suffix: '13(#11)', intervals: [0, 4, 7, 10, 2, 6, 9], required: [0, 4, 10, 6, 9], complexity: 0.78 },
  { suffix: 'maj13', intervals: [0, 4, 7, 11, 2, 9], required: [0, 4, 11, 9], complexity: 0.7 },
  { suffix: 'm13', intervals: [0, 3, 7, 10, 2, 9], required: [0, 3, 10, 9], complexity: 0.7 },
  { suffix: '11', intervals: [0, 4, 7, 10, 2, 5], required: [0, 4, 10, 5], complexity: 0.58 },
  { suffix: 'm11', intervals: [0, 3, 7, 10, 2, 5], required: [0, 3, 10, 5], complexity: 0.58 },
  { suffix: 'maj9', intervals: [0, 4, 7, 11, 2], required: [0, 4, 11, 2], complexity: 0.42 },
  { suffix: 'm9', intervals: [0, 3, 7, 10, 2], required: [0, 3, 10, 2], complexity: 0.42 },
  { suffix: '9', intervals: [0, 4, 7, 10, 2], required: [0, 4, 10, 2], complexity: 0.42 },
  { suffix: '7(b9)', intervals: [0, 4, 7, 10, 1], required: [0, 4, 10, 1], complexity: 0.48 },
  { suffix: '7(#9)', intervals: [0, 4, 7, 10, 3], required: [0, 4, 10, 3], complexity: 0.48 },
  { suffix: '7(#11)', intervals: [0, 4, 7, 10, 6], required: [0, 4, 10, 6], complexity: 0.48 },
  { suffix: 'maj7(#11)', intervals: [0, 4, 7, 11, 6], required: [0, 4, 11, 6], complexity: 0.5 },
  { suffix: 'm(maj7)', intervals: [0, 3, 7, 11], required: [0, 3, 11], complexity: 0.24 },
  { suffix: 'maj7', intervals: [0, 4, 7, 11], required: [0, 4, 11], complexity: 0.18 },
  { suffix: 'm7b5', intervals: [0, 3, 6, 10], required: [0, 3, 6, 10], complexity: 0.2 },
  { suffix: 'dim7', intervals: [0, 3, 6, 9], required: [0, 3, 6, 9], complexity: 0.2 },
  { suffix: 'm7', intervals: [0, 3, 7, 10], required: [0, 3, 10], complexity: 0.16 },
  { suffix: '7', intervals: [0, 4, 7, 10], required: [0, 4, 10], complexity: 0.16 },
  { suffix: '6', intervals: [0, 4, 7, 9], required: [0, 4, 9], complexity: 0.18 },
  { suffix: 'm6', intervals: [0, 3, 7, 9], required: [0, 3, 9], complexity: 0.18 },
  { suffix: 'add9', intervals: [0, 4, 7, 2], required: [0, 4, 2], complexity: 0.2 },
  { suffix: 'm(add9)', intervals: [0, 3, 7, 2], required: [0, 3, 2], complexity: 0.2 },
  { suffix: 'sus2', intervals: [0, 2, 7], required: [0, 2, 7], complexity: 0.08 },
  { suffix: 'sus4', intervals: [0, 5, 7], required: [0, 5, 7], complexity: 0.08 },
  { suffix: 'aug', intervals: [0, 4, 8], required: [0, 4, 8], complexity: 0.08 },
  { suffix: 'dim', intervals: [0, 3, 6], required: [0, 3, 6], complexity: 0.08 },
  { suffix: 'm', intervals: [0, 3, 7], required: [0, 3, 7], complexity: 0 },
  { suffix: '', intervals: [0, 4, 7], required: [0, 4, 7], complexity: 0 },
  { suffix: '5', intervals: [0, 7], required: [0, 7], complexity: 0.12 },
]

function positiveModulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor
}

function pitchName(pitchClass: number, preferFlats: boolean) {
  return (preferFlats ? PITCH_NAMES_FLAT : PITCH_NAMES_SHARP)[positiveModulo(pitchClass, 12)]
}

function prefersFlatNames(midi: ParsedMidi) {
  return (midi.keySignatures[0]?.sf ?? 0) < 0
}

function relevantNotes(midi: ParsedMidi, trackIndexes?: Set<number>) {
  return midi.tracks
    .filter((track) => !trackIndexes || trackIndexes.has(track.index))
    .flatMap((track) => track.notes)
    .filter((note) => note.channel !== 10 && note.durationTicks > 0)
    .sort((a, b) => a.tick - b.tick || a.midi - b.midi)
}

function analysisTicks(midi: ParsedMidi, notes: MidiNote[], subdivision: number) {
  const step = Math.max(1, Math.round(midi.ppq / subdivision))
  const ticks = new Set<number>([0])

  for (let tick = 0; tick <= midi.durationTicks; tick += step) ticks.add(tick)

  const starts = new Map<number, Set<number>>()
  for (const note of notes) {
    const rounded = Math.round(note.tick / step) * step
    if (Math.abs(rounded - note.tick) > step * 0.22) continue
    if (!starts.has(rounded)) starts.set(rounded, new Set())
    starts.get(rounded)!.add(note.midi % 12)
  }
  for (const [tick, pitches] of starts) {
    if (pitches.size >= 2) ticks.add(tick)
  }

  return [...ticks].filter((tick) => tick < midi.durationTicks).sort((a, b) => a - b)
}

function windowPitchWeights(notes: MidiNote[], start: number, end: number) {
  const weights = Array.from({ length: 12 }, () => 0)
  let lowest: MidiNote | null = null

  for (const note of notes) {
    if (note.tick >= end || note.endTick <= start) continue
    const overlap = Math.max(0, Math.min(note.endTick, end) - Math.max(note.tick, start))
    if (!overlap) continue
    const sustained = overlap / Math.max(1, end - start)
    const attack = note.tick >= start && note.tick < end ? 0.34 : 0
    const weight = (0.38 + note.velocity * 0.62) * (sustained + attack)
    weights[note.midi % 12] += weight

    if (!lowest || note.midi < lowest.midi || (note.midi === lowest.midi && weight > note.velocity)) lowest = note
  }

  return { weights, bass: lowest?.midi ?? null }
}

function scoreCandidate(
  root: number,
  template: ChordTemplate,
  weights: number[],
  bass: number | null,
  preferFlats: boolean,
): ChordCandidate {
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const chordClasses = new Set(template.intervals.map((interval) => positiveModulo(root + interval, 12)))
  const matched = weights.reduce((sum, weight, pitchClass) => sum + (chordClasses.has(pitchClass) ? weight : 0), 0)
  const foreign = Math.max(0, total - matched)
  const presentRequired = template.required.filter((interval) => weights[positiveModulo(root + interval, 12)] > 0.08)
  const missingRequired = template.required.length - presentRequired.length
  const rootWeight = weights[root]
  const bassPitchClass = bass === null ? null : bass % 12
  const rootBassBonus = bassPitchClass === root ? 0.34 : 0
  const chordBassBonus = bassPitchClass !== null && chordClasses.has(bassPitchClass) ? 0.1 : 0
  const coverage = total > 0 ? matched / total : 0
  const score =
    matched * 1.16 -
    foreign * 1.32 -
    missingRequired * 0.82 +
    presentRequired.length * 0.18 +
    rootWeight * 0.16 +
    rootBassBonus +
    chordBassBonus -
    template.complexity
  const rootName = pitchName(root, preferFlats)
  const slash =
    bassPitchClass !== null && bassPitchClass !== root && chordClasses.has(bassPitchClass)
      ? `/${pitchName(bassPitchClass, preferFlats)}`
      : ''

  return {
    label: `${rootName}${template.suffix}${slash}`,
    root,
    intervals: template.intervals,
    score,
    confidence: Math.max(0, Math.min(1, coverage * 0.78 + (presentRequired.length / template.required.length) * 0.22)),
  }
}

function detectChord(midi: ParsedMidi, notes: MidiNote[], start: number, end: number) {
  const { weights, bass } = windowPitchWeights(notes, start, end)
  const soundingClasses = weights.filter((weight) => weight > 0.08).length
  if (soundingClasses < 2) return null

  const candidates: ChordCandidate[] = []
  const preferFlats = prefersFlatNames(midi)
  for (let root = 0; root < 12; root += 1) {
    for (const template of CHORD_TEMPLATES) {
      candidates.push(scoreCandidate(root, template, weights, bass, preferFlats))
    }
  }

  candidates.sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.intervals.length - b.intervals.length)
  const best = candidates[0]
  const runnerUp = candidates.find((candidate) => candidate.label !== best.label)
  const separation = runnerUp ? Math.max(0, Math.min(1, (best.score - runnerUp.score + 0.25) / 1.2)) : 1
  return { ...best, confidence: best.confidence * 0.78 + separation * 0.22 }
}

function hasRealChordMarkers(midi: ParsedMidi) {
  return midi.markers.some((marker) => marker.type === 'marker' && marker.source !== 'analysis')
}

export function analyzeChordMarkers(midi: ParsedMidi, options: ChordAnalysisOptions = {}): MidiMarker[] {
  const notes = relevantNotes(midi, options.trackIndexes)
  if (!notes.length) return []
  const subdivision = options.subdivision ?? 1
  const minimumConfidence = options.minimumConfidence ?? 0.56
  const ticks = analysisTicks(midi, notes, subdivision)
  const generated: MidiMarker[] = []
  let noteCursor = 0
  let activeNotes: MidiNote[] = []

  ticks.forEach((tick, index) => {
    const nextTick = ticks[index + 1] ?? midi.durationTicks
    activeNotes = activeNotes.filter((note) => note.endTick > tick)
    while (noteCursor < notes.length && notes[noteCursor].tick < nextTick) {
      const note = notes[noteCursor]
      if (note.endTick > tick) activeNotes.push(note)
      noteCursor += 1
    }
    const detected = detectChord(midi, activeNotes, tick, nextTick)
    if (!detected || detected.confidence < minimumConfidence) return
    const previous = generated[generated.length - 1]
    if (previous?.text === detected.label) return
    generated.push({
      tick,
      time: midiTicksToSeconds(midi, tick),
      text: detected.label,
      type: 'marker',
      source: 'analysis',
      confidence: detected.confidence,
    })
  })

  return generated
}

export function withAnalyzedChordMarkers(midi: ParsedMidi, options: ChordAnalysisOptions = {}): ParsedMidi {
  if (hasRealChordMarkers(midi)) return midi
  const nonChordText = midi.markers.filter((marker) => marker.type !== 'marker')
  const markers = [...nonChordText, ...analyzeChordMarkers(midi, options)].sort((a, b) => a.tick - b.tick)
  return { ...midi, markers }
}

export function regenerateChordMarkers(midi: ParsedMidi, options: ChordAnalysisOptions = {}): ParsedMidi {
  const retained = midi.markers.filter((marker) => marker.type !== 'marker' || marker.source !== 'analysis')
  const base = { ...midi, markers: retained }
  const generated = analyzeChordMarkers(base, options)
  return { ...midi, markers: [...retained, ...generated].sort((a, b) => a.tick - b.tick) }
}
