import type { MidiNote } from './midi'

function noteKey(note: MidiNote) {
  return `${note.tick}:${note.midi}`
}

export function preferDisplayNote(
  current: MidiNote,
  candidate: MidiNote,
  preferredTrackIndexes: Set<number> = new Set(),
) {
  const currentPreferred = preferredTrackIndexes.has(current.trackIndex)
  const candidatePreferred = preferredTrackIndexes.has(candidate.trackIndex)
  if (currentPreferred !== candidatePreferred) return candidatePreferred ? candidate : current
  if (current.velocity !== candidate.velocity) return candidate.velocity > current.velocity ? candidate : current
  if (current.durationTicks !== candidate.durationTicks) {
    return candidate.durationTicks > current.durationTicks ? candidate : current
  }
  return candidate.trackIndex < current.trackIndex ? candidate : current
}

export function dedupeNotesByStartPitch(
  notes: MidiNote[],
  preferredTrackIndexes: Set<number> = new Set(),
) {
  const preferred = new Map<string, MidiNote>()
  for (const note of notes) {
    const key = noteKey(note)
    const current = preferred.get(key)
    preferred.set(key, current ? preferDisplayNote(current, note, preferredTrackIndexes) : note)
  }

  return notes.filter((note) => preferred.get(noteKey(note)) === note)
}
