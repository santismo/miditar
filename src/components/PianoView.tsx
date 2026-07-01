import type { MidiNote } from '../lib/midi'
import { noteName } from '../lib/midi'
import { FULL_PIANO_RANGE, pianoKeysForRange, type PianoRange } from '../lib/pianoLayout'
import { NoteGlyph } from './NoteGlyph'

type PianoViewProps = {
  notes: MidiNote[]
  currentTime: number
  trackColors?: Record<number, string>
  range?: PianoRange
}

export function PianoView({ notes, currentTime, trackColors = {}, range = FULL_PIANO_RANGE }: PianoViewProps) {
  const activeNotes = notes.filter(
    (note) => note.time <= currentTime + 0.03 && note.time + note.duration >= currentTime - 0.03,
  )
  const keys = pianoKeysForRange(range)
  const activeByMidi = new Map<number, MidiNote>()

  activeNotes.forEach((note) => {
    activeByMidi.set(note.midi, note)
  })

  function renderKey(key: (typeof keys)[number]) {
    const activeNote = activeByMidi.get(key.midi)
    const color = activeNote ? (trackColors[activeNote.trackIndex] ?? '#f0c65a') : undefined
    const label = activeNote ? noteName(activeNote.midi) : key.label
    const title = activeNote ? `${activeNote.trackName}: ${noteName(activeNote.midi)}` : key.label || undefined

    return (
      <span
        key={key.midi}
        className={`piano-key ${key.isBlack ? 'is-black' : 'is-white'} ${activeNote ? 'is-active' : ''}`}
        style={{
          left: `${key.left}%`,
          width: `${key.width}%`,
          ...(color
            ? {
                background: `linear-gradient(180deg, ${color}, rgba(7, 9, 7, 0.92))`,
              }
            : {}),
        }}
        title={title}
      >
        {label && (activeNote ? <strong><NoteGlyph name={label} /></strong> : <em>{label}</em>)}
      </span>
    )
  }

  return (
    <div className="piano-view" aria-label="Piano keyboard">
      <div className="piano-white-keys" aria-hidden="true">
        {keys.filter((key) => !key.isBlack).map(renderKey)}
      </div>
      <div className="piano-black-keys" aria-hidden="true">
        {keys.filter((key) => key.isBlack).map(renderKey)}
      </div>
    </div>
  )
}
