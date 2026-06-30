import type { MidiMarker, MidiNote, MidiPlacement } from '../lib/midi'
import { noteName } from '../lib/midi'
import { GUITAR_STRINGS } from '../lib/fretboard'
import { fretboardPoint } from '../lib/fretboardLayout'

type FlowViewProps = {
  notes: MidiNote[]
  markers: MidiMarker[]
  placements: Map<string, MidiPlacement>
  currentTime: number
  duration: number
  trackColors?: Record<number, string>
}

const LEAD_SECONDS = 6
const TOP_Y = 7
const TARGET_Y = 73

function currentMarker(markers: MidiMarker[], currentTime: number) {
  let active: MidiMarker | null = null
  for (const marker of markers) {
    if (marker.type !== 'marker') continue
    if (marker.time <= currentTime + 0.02) active = marker
    else break
  }
  return active
}

function yForTime(time: number, currentTime: number) {
  const until = time - currentTime
  return TARGET_Y - (until / LEAD_SECONDS) * (TARGET_Y - TOP_Y)
}

export function FlowView({
  notes,
  markers,
  placements,
  currentTime,
  duration,
  trackColors = {},
}: FlowViewProps) {
  const visibleNotes = notes.filter((note) => {
    const y = yForTime(note.time, currentTime)
    return y > -8 && y < 92 && note.time + note.duration > currentTime - 0.5
  })
  const visibleMarkers = markers.filter((marker) => {
    const y = yForTime(marker.time, currentTime)
    return marker.type === 'marker' && y > -2 && y < TARGET_Y + 6
  })
  const marker = currentMarker(markers, currentTime)
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0

  return (
    <section className="flow-panel" aria-label="Falling fretboard notes">
      <div className="flow-toolbar">
        <div className="current-chord">
          <span>Chord</span>
          <strong>{marker?.text || '-'}</strong>
        </div>
        <div className="timeline" aria-label="Song progress">
          <div style={{ width: `${progress}%` }} />
        </div>
        <div className="time-readout">
          {Math.floor(currentTime / 60)}:{String(Math.floor(currentTime % 60)).padStart(2, '0')}
        </div>
      </div>
      <div className="flow-stage">
        <div className="string-guides" aria-hidden="true">
          {GUITAR_STRINGS.map((string) => (
            <div key={string.name} style={{ left: `${6 + string.index * 17.6}%` }}>
              {string.name}
            </div>
          ))}
        </div>
        {visibleMarkers.map((event) => {
          const y = yForTime(event.time, currentTime)
          return (
            <div key={`${event.tick}-${event.text}`} className="falling-chord" style={{ top: `${y}%` }}>
              {event.text}
            </div>
          )
        })}
        {visibleNotes.map((note) => {
          const placement = placements.get(note.id)
          if (!placement) return null
          const point = fretboardPoint(placement)
          const string = GUITAR_STRINGS[placement.stringIndex]
          const x = (point.x / 1080) * 100
          const y = yForTime(note.time, currentTime)
          const height = Math.max(18, (note.duration / LEAD_SECONDS) * 280)
          const active = note.time <= currentTime && note.time + note.duration >= currentTime
          const trackColor = trackColors[note.trackIndex] ?? string.color

          return (
            <div
              key={note.id}
              className={`falling-note ${active ? 'is-active' : ''}`}
              style={{
                left: `${x}%`,
                top: `${y}%`,
                height,
                borderColor: string.color,
                background: `linear-gradient(180deg, ${trackColor}, rgba(255,255,255,.12))`,
              }}
              title={`${note.trackName}: ${noteName(note.midi)} on ${string.name} fret ${placement.fret}`}
            >
              <span>{placement.fret}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
