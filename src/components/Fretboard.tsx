import type { MidiNote, MidiPlacement } from '../lib/midi'
import { GUITAR_STRINGS } from '../lib/fretboard'
import {
  FRETBOARD_LEFT,
  FRETBOARD_RIGHT,
  FRETBOARD_VIEW_HEIGHT,
  FRETBOARD_VIEW_WIDTH,
  fretLineX,
  fretboardNoteX,
  fretboardPoint,
  stringY,
} from '../lib/fretboardLayout'

type FretboardProps = {
  notes: MidiNote[]
  placements: Map<string, MidiPlacement>
  currentTime: number
  maxFret?: number
}

export function Fretboard({ notes, placements, currentTime, maxFret = 22 }: FretboardProps) {
  const activeNotes = notes.filter(
    (note) => note.time <= currentTime + 0.03 && note.time + note.duration >= currentTime - 0.03,
  )

  return (
    <svg
      className="fretboard"
      viewBox={`0 0 ${FRETBOARD_VIEW_WIDTH} ${FRETBOARD_VIEW_HEIGHT}`}
      role="img"
      aria-label="Guitar fretboard"
    >
      <defs>
        <linearGradient id="neck" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#9b6a3b" />
          <stop offset="1" stopColor="#5f3f25" />
        </linearGradient>
      </defs>
      <rect x="48" y="10" width="1004" height="218" rx="8" fill="url(#neck)" />
      <rect x={FRETBOARD_LEFT - 7} y="16" width="12" height="205" rx="3" fill="#eee7d3" />
      {Array.from({ length: maxFret + 1 }).map((_, fret) => {
        const x = fretLineX(fret, maxFret)
        const strong = [0, 3, 5, 7, 9, 12, 15, 17].includes(fret)
        return (
          <g key={fret}>
            <line
              x1={x}
              x2={x}
              y1="22"
              y2="216"
              stroke={fret === 0 ? '#f6efda' : '#d2c0a0'}
              strokeWidth={fret === 0 ? 4 : 2}
            />
            {fret > 0 && (
              <text x={fretboardNoteX(fret, maxFret)} y="250" textAnchor="middle" className="fret-number">
                {fret}
              </text>
            )}
            {strong && fret > 0 && (
              <circle
                cx={fretboardNoteX(fret, maxFret)}
                cy="126"
                r={fret === 12 ? 8 : 5}
                fill="rgba(255,255,255,.28)"
              />
            )}
          </g>
        )
      })}
      {GUITAR_STRINGS.map((string) => {
        const y = stringY(string.index)
        return (
          <g key={string.name}>
            <line
              x1={FRETBOARD_LEFT - 34}
              x2={FRETBOARD_VIEW_WIDTH - FRETBOARD_RIGHT}
              y1={y}
              y2={y}
              stroke="#f5f0dc"
              strokeWidth={Math.max(1.5, 4.8 - string.index * 0.42)}
              opacity="0.92"
            />
            <text x="28" y={y + 5} className="string-name">
              {string.name}
            </text>
          </g>
        )
      })}
      {activeNotes.map((note) => {
        const placement = placements.get(note.id)
        if (!placement) return null
        const point = fretboardPoint(placement, maxFret)
        const string = GUITAR_STRINGS[placement.stringIndex]
        return (
          <g key={note.id} className="active-note">
            <circle cx={point.x} cy={point.y} r="18" fill={string.color} />
            <circle cx={point.x} cy={point.y} r="24" fill={string.color} opacity="0.22" />
            <text x={point.x} y={point.y + 5} textAnchor="middle">
              {placement.fret}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
