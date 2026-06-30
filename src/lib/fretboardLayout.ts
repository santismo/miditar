import type { MidiPlacement } from './midi'

export const FRETBOARD_VIEW_WIDTH = 1080
export const FRETBOARD_VIEW_HEIGHT = 270
export const FRETBOARD_LEFT = 76
export const FRETBOARD_RIGHT = 28
export const FRETBOARD_TOP = 34
export const FRETBOARD_STRING_GAP = 34

export function fretLineX(fret: number, maxFret: number) {
  if (fret === 0) return FRETBOARD_LEFT
  const max = 1 - 2 ** (-maxFret / 12)
  const value = 1 - 2 ** (-fret / 12)
  return FRETBOARD_LEFT + (value / max) * (FRETBOARD_VIEW_WIDTH - FRETBOARD_LEFT - FRETBOARD_RIGHT)
}

export function stringY(stringIndex: number) {
  return FRETBOARD_TOP + stringIndex * FRETBOARD_STRING_GAP
}

export function fretboardNoteX(fret: number, maxFret: number) {
  if (fret === 0) return FRETBOARD_LEFT - 25
  return (fretLineX(fret - 1, maxFret) + fretLineX(fret, maxFret)) / 2
}

export function fretboardPoint(placement: MidiPlacement, maxFret = 22) {
  return {
    x: fretboardNoteX(Math.min(placement.fret, maxFret), maxFret),
    y: stringY(placement.stringIndex),
  }
}
