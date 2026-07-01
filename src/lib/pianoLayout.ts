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

function clampMidi(midi: number) {
  return Math.min(PIANO_MAX_MIDI, Math.max(PIANO_MIN_MIDI, midi))
}

export function isBlackPianoKey(midi: number) {
  return !WHITE_PITCH_CLASSES.has(((midi % 12) + 12) % 12)
}

function whiteKeysBefore(midi: number) {
  let count = 0
  for (let value = PIANO_MIN_MIDI; value < midi; value += 1) {
    if (!isBlackPianoKey(value)) count += 1
  }
  return count
}

function keyLabel(midi: number) {
  const pitchClass = ((midi % 12) + 12) % 12
  const octave = Math.floor(midi / 12) - 1
  if (pitchClass !== 0) return ''
  return `C${octave}`
}

export function pianoKeySlot(midi: number) {
  const safeMidi = clampMidi(midi)
  const whiteWidth = 100 / WHITE_KEY_COUNT
  if (!isBlackPianoKey(safeMidi)) {
    return {
      left: whiteKeysBefore(safeMidi) * whiteWidth,
      width: whiteWidth,
      isBlack: false,
    }
  }

  const width = whiteWidth * 0.62
  return {
    left: whiteKeysBefore(safeMidi) * whiteWidth - width / 2,
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
