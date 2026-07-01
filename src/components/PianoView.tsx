import type { MidiNote } from '../lib/midi'
import { noteName } from '../lib/midi'
import { PIANO_KEYS, pianoKeySlot } from '../lib/pianoLayout'

type PianoViewProps = {
  notes: MidiNote[]
  currentTime: number
  trackColors?: Record<number, string>
}

export function PianoView({ notes, currentTime, trackColors = {} }: PianoViewProps) {
  const activeNotes = notes.filter(
    (note) => note.time <= currentTime + 0.03 && note.time + note.duration >= currentTime - 0.03,
  )

  return (
    <div className="piano-view" aria-label="Piano keyboard">
      <div className="piano-white-keys" aria-hidden="true">
        {PIANO_KEYS.filter((key) => !key.isBlack).map((key) => (
          <span key={key.midi} className="piano-key is-white" style={{ left: `${key.left}%`, width: `${key.width}%` }}>
            {key.label}
          </span>
        ))}
      </div>
      <div className="piano-black-keys" aria-hidden="true">
        {PIANO_KEYS.filter((key) => key.isBlack).map((key) => (
          <span key={key.midi} className="piano-key is-black" style={{ left: `${key.left}%`, width: `${key.width}%` }} />
        ))}
      </div>
      {activeNotes.map((note) => {
        const slot = pianoKeySlot(note.midi)
        const color = trackColors[note.trackIndex] ?? '#f0c65a'
        return (
          <span
            key={note.id}
            className={`piano-active-note ${slot.isBlack ? 'is-black' : 'is-white'}`}
            style={{
              left: `${slot.left}%`,
              width: `${slot.width}%`,
              background: color,
            }}
            title={`${note.trackName}: ${noteName(note.midi)}`}
          >
            {noteName(note.midi).replace(/\d+$/, '')}
          </span>
        )
      })}
    </div>
  )
}
