type NoteGlyphProps = {
  name: string
}

function splitNoteName(name: string) {
  const match = name.match(/^([A-G])([#b]?)(-?\d*)$/)
  if (!match) return { letter: name, accidental: '', octave: '' }
  return {
    letter: match[1],
    accidental: match[2],
    octave: match[3],
  }
}

export function NoteGlyph({ name }: NoteGlyphProps) {
  const note = splitNoteName(name)
  return (
    <span className={`note-glyph ${note.accidental ? 'has-accidental' : ''}`} aria-label={name}>
      {note.accidental && <i>{note.accidental}</i>}
      <b>
        {note.letter}
        {note.octave && <small>{note.octave}</small>}
      </b>
    </span>
  )
}
