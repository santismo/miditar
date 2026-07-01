export const PIANO_MIN_MIDI = 21
export const PIANO_MAX_MIDI = 108
export const WHITE_KEY_COUNT = 52

const WHITE_PITCH_CLASSES = new Set([0, 2, 4, 5, 7, 9, 11])

export type PianoKey = {
  midi: number
  isBlack: boolean
  left: number
  width: number
  label: string
}

export type PianoRange = {
  minMidi: number
  maxMidi: number
}

export const FULL_PIANO_RANGE: PianoRange = {
  minMidi: PIANO_MIN_MIDI,
  maxMidi: PIANO_MAX_MIDI,
}

function clampMidi(midi: number) {
  return Math.min(PIANO_MAX_MIDI, Math.max(PIANO_MIN_MIDI, midi))
}

export function isBlackPianoKey(midi: number) {
  return !WHITE_PITCH_CLASSES.has(((midi % 12) + 12) % 12)
}

function whiteKeysBetween(startMidi: number, endMidi: number) {
  let count = 0
  for (let value = startMidi; value <= endMidi; value += 1) {
    if (!isBlackPianoKey(value)) count += 1
  }
  return count
}

function whiteKeysBeforeInRange(midi: number, startMidi: number) {
  let count = 0
  for (let value = startMidi; value < midi; value += 1) {
    if (!isBlackPianoKey(value)) count += 1
  }
  return count
}

function previousWhiteKey(midi: number) {
  let value = clampMidi(midi)
  while (value > PIANO_MIN_MIDI && isBlackPianoKey(value)) value -= 1
  return value
}

function nextWhiteKey(midi: number) {
  let value = clampMidi(midi)
  while (value < PIANO_MAX_MIDI && isBlackPianoKey(value)) value += 1
  return value
}

function keyLabel(midi: number) {
  const pitchClass = ((midi % 12) + 12) % 12
  const octave = Math.floor(midi / 12) - 1
  if (pitchClass !== 0) return ''
  return `C${octave}`
}

export function normalizePianoRange(range: PianoRange = FULL_PIANO_RANGE): PianoRange {
  const minMidi = previousWhiteKey(Math.min(range.minMidi, range.maxMidi))
  const maxMidi = nextWhiteKey(Math.max(range.minMidi, range.maxMidi))
  return {
    minMidi,
    maxMidi: Math.max(minMidi, maxMidi),
  }
}

export function pianoRangeForNotes(notes: { midi: number }[]) {
  if (!notes.length) return FULL_PIANO_RANGE
  let minMidi = PIANO_MAX_MIDI
  let maxMidi = PIANO_MIN_MIDI
  for (const note of notes) {
    minMidi = Math.min(minMidi, clampMidi(note.midi))
    maxMidi = Math.max(maxMidi, clampMidi(note.midi))
  }
  return normalizePianoRange({ minMidi, maxMidi })
}

export function pianoKeySlot(midi: number, range: PianoRange = FULL_PIANO_RANGE) {
  const safeMidi = clampMidi(midi)
  const normalizedRange = normalizePianoRange(range)
  const visibleWhiteKeyCount = Math.max(1, whiteKeysBetween(normalizedRange.minMidi, normalizedRange.maxMidi))
  const whiteWidth = 100 / visibleWhiteKeyCount
  if (!isBlackPianoKey(safeMidi)) {
    return {
      left: whiteKeysBeforeInRange(safeMidi, normalizedRange.minMidi) * whiteWidth,
      width: whiteWidth,
      isBlack: false,
    }
  }

  const width = whiteWidth * 0.62
  return {
    left: whiteKeysBeforeInRange(safeMidi, normalizedRange.minMidi) * whiteWidth - width / 2,
    width,
    isBlack: true,
  }
}

export const PIANO_KEYS: PianoKey[] = Array.from({ length: PIANO_MAX_MIDI - PIANO_MIN_MIDI + 1 }).map((_, index) => {
  const midi = PIANO_MIN_MIDI + index
  return {
    midi,
    label: keyLabel(midi),
    ...pianoKeySlot(midi),
  }
})

export function pianoKeysForRange(range: PianoRange = FULL_PIANO_RANGE): PianoKey[] {
  const normalizedRange = normalizePianoRange(range)
  return Array.from({ length: normalizedRange.maxMidi - normalizedRange.minMidi + 1 }).map((_, index) => {
    const midi = normalizedRange.minMidi + index
    return {
      midi,
      label: keyLabel(midi),
      ...pianoKeySlot(midi, normalizedRange),
    }
  })
}
