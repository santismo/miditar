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
import { getFretboardTheme, type FretboardThemeId } from './fretboardThemes'

type FretboardProps = {
  notes: MidiNote[]
  placements: Map<string, MidiPlacement>
  currentTime: number
  trackColors?: Record<number, string>
  maxFret?: number
  themeId?: FretboardThemeId
  stretchToFit?: boolean
  connectedFlight?: boolean
}

export function Fretboard({
  notes,
  placements,
  currentTime,
  maxFret = 22,
  themeId = 'dark',
  stretchToFit = false,
  connectedFlight = false,
}: FretboardProps) {
  const activeNotes = notes.filter(
    (note) => note.time <= currentTime + 0.03 && note.time + note.duration >= currentTime - 0.03,
  )
  const theme = getFretboardTheme(themeId)
  const gradientId = `neck-${theme.id}`
  const neckX = stretchToFit ? 0 : 48
  const neckWidth = stretchToFit ? FRETBOARD_VIEW_WIDTH : 1004
  const stringX1 = stretchToFit ? 0 : FRETBOARD_LEFT - 34
  const stringX2 = stretchToFit ? FRETBOARD_VIEW_WIDTH : FRETBOARD_VIEW_WIDTH - FRETBOARD_RIGHT

  return (
    <svg
      className="fretboard"
      viewBox={`0 10 ${FRETBOARD_VIEW_WIDTH} ${FRETBOARD_VIEW_HEIGHT - 10}`}
      preserveAspectRatio={stretchToFit ? 'none' : 'xMidYMin meet'}
      role="img"
      aria-label="Guitar fretboard"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor={theme.neckStart} />
          <stop offset="1" stopColor={theme.neckEnd} />
        </linearGradient>
      </defs>
      <rect
        x={neckX}
        y="10"
        width={neckWidth}
        height="218"
        rx="8"
        fill={`url(#${gradientId})`}
        opacity={connectedFlight ? 0.18 : 1}
      />
      <rect
        x={FRETBOARD_LEFT - 7}
        y="16"
        width="12"
        height="205"
        rx="3"
        fill={theme.nut}
        opacity={connectedFlight ? 0.88 : 1}
      />
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
              stroke={fret === 0 ? theme.nut : theme.fret}
              strokeWidth={fret === 0 ? 4 : 2}
              opacity={connectedFlight && fret > 0 ? 0.9 : 1}
            />
            {fret > 0 && (
              <text
                x={fretboardNoteX(fret, maxFret)}
                y="250"
                textAnchor="middle"
                className="fret-number"
                stroke={theme.fretNumberStroke}
                strokeWidth="4"
                style={{ fill: theme.fretNumber, paintOrder: 'stroke fill' }}
              >
                {fret}
              </text>
            )}
            {strong && fret > 0 && (
              <circle
                cx={fretboardNoteX(fret, maxFret)}
                cy="126"
                r={fret === 12 ? 8 : 5}
                fill={theme.marker}
                opacity={theme.markerOpacity}
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
              x1={stringX1}
              x2={stringX2}
              y1={y}
              y2={y}
              stroke={theme.string}
              strokeWidth={Math.max(1.5, 4.8 - string.index * 0.42)}
              opacity={connectedFlight ? 0.98 : 0.92}
            />
            <text
              x="28"
              y={y + 5}
              className="string-name"
              stroke={theme.fretNumberStroke}
              strokeWidth="3"
              style={{ fill: theme.stringName, paintOrder: 'stroke fill' }}
            >
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
            <circle cx={point.x} cy={point.y} r="18" fill={string.color} stroke={string.color} strokeWidth="4" />
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
