import { midiTicksToSeconds, parseMidiFile, type MidiNote, type MidiPlacement, type ParsedMidi } from './midi'

export const MIDI_FILE_PATTERN = /\.(mid|midi)$/i
export const TAB_FILE_PATTERN = /\.(gp|gp3|gp4|gp5|gpx|musicxml|mxl|xml)$/i
export const SUPPORTED_MUSIC_FILE_PATTERN = /\.(mid|midi|gp|gp3|gp4|gp5|gpx|musicxml|mxl|xml)$/i

type AlphaTab = typeof import('@coderline/alphatab')
type AlphaScore = import('@coderline/alphatab').model.Score
type AlphaBeat = import('@coderline/alphatab').model.Beat

type ExactSourceNote = {
  trackIndex: number
  tick: number
  midi: number
  stringIndex: number
  fret: number
}

function sourceFormat(fileName: string): ParsedMidi['sourceFormat'] {
  return /\.(musicxml|mxl|xml)$/i.test(fileName) ? 'musicxml' : 'guitar-pro'
}

function scoreToMidi(alphaTab: AlphaTab, score: AlphaScore) {
  const midiFile = new alphaTab.midi.MidiFile()
  midiFile.format = alphaTab.midi.MidiFileFormat.MultiTrack
  midiFile.division = 960
  const handler = new alphaTab.midi.AlphaSynthMidiFileHandler(midiFile, true)
  const generator = new alphaTab.midi.MidiFileGenerator(score, new alphaTab.Settings(), handler)
  generator.generate()
  return { bytes: midiFile.toBinary(), generator }
}

function sourceNotesForBeat(beat: AlphaBeat, playbackStart: number): ExactSourceNote[] {
  const staff = beat.voice.bar.staff
  const stringCount = staff.tuning.length
  if (!stringCount) return []

  return beat.notes.flatMap((note) => {
    const stringIndex = stringCount - note.string
    if (!note.isStringed || stringIndex < 0 || stringIndex > 5) return []
    return [{
      trackIndex: staff.track.index,
      tick: playbackStart,
      midi: note.realValue,
      stringIndex,
      fret: note.fret,
    }]
  })
}

function exactSourceNotes(scoreData: ReturnType<typeof scoreToMidi>) {
  const sourceNotes: ExactSourceNote[] = []
  const chordMarkers: Array<{ tick: number; text: string }> = []
  const seenBeats = new Set<string>()
  const seenChords = new Set<string>()

  for (const masterBar of scoreData.generator.tickLookup.masterBars) {
    let slice = masterBar.firstBeat
    while (slice) {
      for (const item of slice.highlightedBeats) {
        const beatKey = `${item.beat.id}:${item.playbackStart}`
        if (seenBeats.has(beatKey)) continue
        seenBeats.add(beatKey)
        sourceNotes.push(...sourceNotesForBeat(item.beat, item.playbackStart))

        const chord = item.beat.chord?.name?.trim()
        if (chord) {
          const chordKey = `${item.playbackStart}:${chord}`
          if (!seenChords.has(chordKey)) {
            seenChords.add(chordKey)
            chordMarkers.push({ tick: item.playbackStart, text: chord })
          }
        }
      }
      slice = slice.nextBeat
    }
  }

  return { sourceNotes, chordMarkers }
}

function matchExactPlacements(parsed: ParsedMidi, sourceNotes: ExactSourceNote[]) {
  const placements: MidiPlacement[] = []
  const claimed = new Set<string>()
  const notesByTrackAndPitch = new Map<string, MidiNote[]>()

  for (const track of parsed.tracks) {
    for (const note of track.notes) {
      const key = `${track.index}:${note.midi}`
      if (!notesByTrackAndPitch.has(key)) notesByTrackAndPitch.set(key, [])
      notesByTrackAndPitch.get(key)!.push(note)
    }
  }

  for (const source of sourceNotes) {
    const exactTrack = notesByTrackAndPitch.get(`${source.trackIndex}:${source.midi}`) ?? []
    const allTracks = parsed.tracks.flatMap((track) => notesByTrackAndPitch.get(`${track.index}:${source.midi}`) ?? [])
    const candidates = exactTrack.length ? exactTrack : allTracks
    const match = candidates
      .filter((note) => !claimed.has(note.id))
      .sort((a, b) => Math.abs(a.tick - source.tick) - Math.abs(b.tick - source.tick))[0]
    if (!match || Math.abs(match.tick - source.tick) > parsed.ppq / 2) continue
    claimed.add(match.id)
    placements.push({
      noteId: match.id,
      stringIndex: source.stringIndex,
      fret: source.fret,
      midi: match.midi,
    })
  }

  return placements
}

export async function importTabFile(buffer: ArrayBuffer, fileName: string): Promise<ParsedMidi> {
  const alphaTab = await import('@coderline/alphatab')
  const settings = new alphaTab.Settings()
  const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(buffer), settings)
  const scoreData = scoreToMidi(alphaTab, score)
  const bytes = scoreData.bytes
  const midiBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const parsed = parseMidiFile(midiBuffer, fileName)
  const source = exactSourceNotes(scoreData)
  const markers = source.chordMarkers.length
    ? source.chordMarkers.map((marker) => ({
        ...marker,
        time: midiTicksToSeconds(parsed, marker.tick),
        type: 'marker' as const,
        source: 'file' as const,
      }))
    : parsed.markers

  return {
    ...parsed,
    fileName,
    title: score.title?.trim() || fileName.replace(/\.[^.]+$/, ''),
    sourceFormat: sourceFormat(fileName),
    exactPlacements: matchExactPlacements(parsed, source.sourceNotes),
    markers,
  }
}

export async function parseSupportedMusicFile(buffer: ArrayBuffer, fileName: string): Promise<ParsedMidi> {
  if (MIDI_FILE_PATTERN.test(fileName)) return parseMidiFile(buffer, fileName)
  if (TAB_FILE_PATTERN.test(fileName)) return importTabFile(buffer, fileName)
  throw new Error(`Unsupported music file: ${fileName}`)
}
