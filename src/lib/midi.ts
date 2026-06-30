export type MidiNote = {
  id: string
  trackIndex: number
  trackName: string
  channel: number
  midi: number
  velocity: number
  tick: number
  durationTicks: number
  endTick: number
  time: number
  duration: number
}

export type MidiMarker = {
  tick: number
  time: number
  text: string
  type: 'marker' | 'lyric' | 'text'
}

export type TempoEvent = {
  tick: number
  time: number
  bpm: number
  mpq: number
}

export type TimeSignatureEvent = {
  tick: number
  time: number
  numerator: number
  denominator: number
  clocksPerClick: number
  thirtySecondNotes: number
}

export type KeySignatureEvent = {
  tick: number
  time: number
  sf: number
  minor: boolean
}

export type MidiTrack = {
  index: number
  name: string
  notes: MidiNote[]
  channels: number[]
  programs: Record<number, number>
}

export type ParsedMidi = {
  fileName: string
  title: string
  format: number
  ppq: number
  durationTicks: number
  duration: number
  tempos: TempoEvent[]
  timeSignatures: TimeSignatureEvent[]
  keySignatures: KeySignatureEvent[]
  markers: MidiMarker[]
  tracks: MidiTrack[]
}

export type MidiPlacement = {
  noteId: string
  stringIndex: number
  fret: number
}

type RawNote = Omit<MidiNote, 'time' | 'duration'>
type RawMarker = Omit<MidiMarker, 'time'>
type RawTempo = Omit<TempoEvent, 'time' | 'bpm'> & { bpm?: number }
type RawTimeSignature = Omit<TimeSignatureEvent, 'time'>
type RawKeySignature = Omit<KeySignatureEvent, 'time'>

const DEFAULT_MPQ = 500000
const TEXT_DECODER = new TextDecoder('utf-8')

function readUint16(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 8) | bytes[offset + 1]
}

function readUint32(bytes: Uint8Array, offset: number) {
  return (
    (bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]
  ) >>> 0
}

function readVarLength(bytes: Uint8Array, offset: number) {
  let value = 0
  let cursor = offset

  while (cursor < bytes.length) {
    const byte = bytes[cursor]
    cursor += 1
    value = (value << 7) | (byte & 0x7f)
    if ((byte & 0x80) === 0) break
  }

  return { value, offset: cursor }
}

function encodeVarLength(value: number) {
  let buffer = value & 0x7f
  const bytes = []

  while ((value >>= 7)) {
    buffer <<= 8
    buffer |= (value & 0x7f) | 0x80
  }

  while (true) {
    bytes.push(buffer & 0xff)
    if (buffer & 0x80) buffer >>= 8
    else break
  }

  return bytes
}

function decodeText(payload: Uint8Array) {
  const trimmed = payload.filter((byte) => byte !== 0)
  try {
    return TEXT_DECODER.decode(trimmed).trim()
  } catch {
    return Array.from(trimmed)
      .map((byte) => String.fromCharCode(byte))
      .join('')
      .trim()
  }
}

function uniqueSorted(values: Iterable<number>) {
  return [...new Set(values)].sort((a, b) => a - b)
}

function normalizeTempos(rawTempos: RawTempo[], ppq: number) {
  const sorted = [...rawTempos].sort((a, b) => a.tick - b.tick)
  if (!sorted.some((tempo) => tempo.tick === 0)) {
    sorted.unshift({ tick: 0, mpq: DEFAULT_MPQ })
  }

  return sorted.map((tempo) => {
    const bpm = 60000000 / tempo.mpq
    return {
      tick: tempo.tick,
      time: ticksToSeconds(tempo.tick, sorted, ppq),
      bpm,
      mpq: tempo.mpq,
    }
  })
}

function ticksToSeconds(tick: number, tempos: RawTempo[] | TempoEvent[], ppq: number) {
  const sorted = [...tempos].sort((a, b) => a.tick - b.tick)
  let lastTick = 0
  let seconds = 0
  let mpq = DEFAULT_MPQ

  for (const tempo of sorted) {
    if (tempo.tick > tick) break
    seconds += ((tempo.tick - lastTick) * mpq) / ppq / 1000000
    lastTick = tempo.tick
    mpq = tempo.mpq
  }

  seconds += ((tick - lastTick) * mpq) / ppq / 1000000
  return seconds
}

export function secondsToTicks(midi: ParsedMidi, seconds: number) {
  const tempos = midi.tempos.length
    ? midi.tempos
    : [{ tick: 0, time: 0, bpm: 120, mpq: DEFAULT_MPQ }]

  let lastTick = 0
  let lastSecond = 0
  let mpq = DEFAULT_MPQ

  for (const tempo of tempos) {
    if (tempo.time > seconds) break
    lastTick = tempo.tick
    lastSecond = tempo.time
    mpq = tempo.mpq
  }

  const elapsed = Math.max(0, seconds - lastSecond)
  return Math.round(lastTick + (elapsed * 1000000 * midi.ppq) / mpq)
}

export function noteName(midi: number) {
  const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
  const octave = Math.floor(midi / 12) - 1
  return `${names[midi % 12]}${octave}`
}

export function parseMidiFile(buffer: ArrayBuffer, fileName = 'Untitled.mid'): ParsedMidi {
  const bytes = new Uint8Array(buffer)
  if (decodeText(bytes.slice(0, 4)) !== 'MThd') {
    throw new Error('This does not look like a Standard MIDI file.')
  }

  const headerLength = readUint32(bytes, 4)
  const format = readUint16(bytes, 8)
  const trackCount = readUint16(bytes, 10)
  const ppq = readUint16(bytes, 12)

  if (ppq & 0x8000) {
    throw new Error('SMPTE time division is not supported yet.')
  }

  let offset = 8 + headerLength
  const rawTracks: Array<{
    index: number
    name: string
    notes: RawNote[]
    channels: Set<number>
    programs: Record<number, number>
  }> = []
  const rawMarkers: RawMarker[] = []
  const rawTempos: RawTempo[] = []
  const rawTimeSignatures: RawTimeSignature[] = []
  const rawKeySignatures: RawKeySignature[] = []
  let title = fileName.replace(/\.(mid|midi)$/i, '')
  let durationTicks = 0

  for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
    const chunkType = decodeText(bytes.slice(offset, offset + 4))
    if (chunkType !== 'MTrk') {
      throw new Error(`Expected MTrk at track ${trackIndex + 1}.`)
    }

    const trackLength = readUint32(bytes, offset + 4)
    const endOffset = offset + 8 + trackLength
    let cursor = offset + 8
    let tick = 0
    let runningStatus: number | null = null
    let trackName = `Track ${trackIndex + 1}`
    let noteSequence = 0
    const activeNotes = new Map<string, RawNote[]>()
    const rawNotes: RawNote[] = []
    const channels = new Set<number>()
    const programs: Record<number, number> = {}

    while (cursor < endOffset) {
      const delta = readVarLength(bytes, cursor)
      tick += delta.value
      cursor = delta.offset
      durationTicks = Math.max(durationTicks, tick)

      let status = bytes[cursor]
      let firstDataByte: number | null = null

      if (status < 0x80) {
        if (runningStatus === null) {
          throw new Error(`Invalid running status in track ${trackIndex + 1}.`)
        }
        firstDataByte = status
        status = runningStatus
        cursor += 1
      } else {
        cursor += 1
        if (status < 0xf0) runningStatus = status
      }

      if (status === 0xff) {
        const metaType = bytes[cursor]
        cursor += 1
        const length = readVarLength(bytes, cursor)
        cursor = length.offset
        const payload = bytes.slice(cursor, cursor + length.value)
        cursor += length.value

        if (metaType === 0x2f) break
        if (metaType === 0x03) {
          trackName = decodeText(payload) || trackName
          if (trackIndex === 0 && trackName) title = trackName.trim()
        } else if (metaType === 0x01 || metaType === 0x05 || metaType === 0x06) {
          const text = decodeText(payload)
          if (text) {
            rawMarkers.push({
              tick,
              text,
              type: metaType === 0x06 ? 'marker' : metaType === 0x05 ? 'lyric' : 'text',
            })
          }
        } else if (metaType === 0x51 && payload.length >= 3) {
          const mpq = (payload[0] << 16) | (payload[1] << 8) | payload[2]
          rawTempos.push({ tick, mpq })
        } else if (metaType === 0x58 && payload.length >= 4) {
          rawTimeSignatures.push({
            tick,
            numerator: payload[0],
            denominator: 2 ** payload[1],
            clocksPerClick: payload[2],
            thirtySecondNotes: payload[3],
          })
        } else if (metaType === 0x59 && payload.length >= 2) {
          const sf = payload[0] > 127 ? payload[0] - 256 : payload[0]
          rawKeySignatures.push({ tick, sf, minor: payload[1] === 1 })
        }

        continue
      }

      if (status === 0xf0 || status === 0xf7) {
        const length = readVarLength(bytes, cursor)
        cursor = length.offset + length.value
        continue
      }

      const eventType = status & 0xf0
      const channel = status & 0x0f
      const data1 = firstDataByte ?? bytes[cursor]
      if (firstDataByte === null) cursor += 1

      if (eventType === 0xc0 || eventType === 0xd0) {
        if (eventType === 0xc0) programs[channel + 1] = data1
        continue
      }

      const data2 = bytes[cursor]
      cursor += 1

      if (eventType === 0x90 && data2 > 0) {
        const key = `${channel}:${data1}`
        const note: RawNote = {
          id: `${trackIndex}-${noteSequence}`,
          trackIndex,
          trackName,
          channel: channel + 1,
          midi: data1,
          velocity: data2 / 127,
          tick,
          durationTicks: 0,
          endTick: tick,
        }
        noteSequence += 1
        if (!activeNotes.has(key)) activeNotes.set(key, [])
        activeNotes.get(key)!.push(note)
        channels.add(channel + 1)
      } else if (eventType === 0x80 || (eventType === 0x90 && data2 === 0)) {
        const key = `${channel}:${data1}`
        const stack = activeNotes.get(key)
        const note = stack?.shift()
        if (note) {
          note.durationTicks = Math.max(1, tick - note.tick)
          note.endTick = tick
          rawNotes.push(note)
        }
      }
    }

    for (const stack of activeNotes.values()) {
      for (const note of stack) {
        note.durationTicks = Math.max(1, durationTicks - note.tick)
        note.endTick = note.tick + note.durationTicks
        rawNotes.push(note)
      }
    }

    rawTracks.push({
      index: trackIndex,
      name: trackName.trim(),
      notes: rawNotes.sort((a, b) => a.tick - b.tick || a.midi - b.midi),
      channels,
      programs,
    })

    offset = endOffset
  }

  const tempos = normalizeTempos(rawTempos, ppq)
  const tracks: MidiTrack[] = rawTracks.map((track) => ({
    index: track.index,
    name: track.name,
    channels: uniqueSorted(track.channels),
    programs: track.programs,
    notes: track.notes.map((note) => {
      const time = ticksToSeconds(note.tick, tempos, ppq)
      const end = ticksToSeconds(note.endTick, tempos, ppq)
      return {
        ...note,
        trackName: track.name,
        time,
        duration: Math.max(0.01, end - time),
      }
    }),
  }))

  const duration = ticksToSeconds(durationTicks, tempos, ppq)

  return {
    fileName,
    title,
    format,
    ppq,
    durationTicks,
    duration,
    tempos,
    timeSignatures: rawTimeSignatures.map((event) => ({
      ...event,
      time: ticksToSeconds(event.tick, tempos, ppq),
    })),
    keySignatures: rawKeySignatures.map((event) => ({
      ...event,
      time: ticksToSeconds(event.tick, tempos, ppq),
    })),
    markers: rawMarkers
      .map((marker) => ({ ...marker, time: ticksToSeconds(marker.tick, tempos, ppq) }))
      .sort((a, b) => a.tick - b.tick),
    tracks,
  }
}

function stringBytes(value: string) {
  return [...new TextEncoder().encode(value)]
}

function metaEvent(type: number, payload: number[]) {
  return [0xff, type, ...encodeVarLength(payload.length), ...payload]
}

function trackChunk(events: Array<{ tick: number; order: number; bytes: number[] }>, endTick: number) {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order)
  const body: number[] = []
  let previousTick = 0

  for (const event of sorted) {
    const tick = Math.max(0, event.tick)
    body.push(...encodeVarLength(tick - previousTick), ...event.bytes)
    previousTick = tick
  }

  body.push(...encodeVarLength(Math.max(0, endTick - previousTick)), 0xff, 0x2f, 0x00)
  const length = body.length

  return [
    ...stringBytes('MTrk'),
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    ...body,
  ]
}

function bytesFromMpq(mpq: number) {
  return [(mpq >>> 16) & 0xff, (mpq >>> 8) & 0xff, mpq & 0xff]
}

export function exportGuitarMappedMidi(
  source: ParsedMidi,
  track: MidiTrack,
  placements: Map<string, MidiPlacement>,
) {
  const endTick = Math.max(source.durationTicks, ...track.notes.map((note) => note.endTick))
  const metaEvents: Array<{ tick: number; order: number; bytes: number[] }> = [
    { tick: 0, order: 0, bytes: metaEvent(0x03, stringBytes(`${source.title} chords`)) },
    { tick: 0, order: 1, bytes: metaEvent(0x01, stringBytes('Created with Miditar')) },
  ]

  for (const tempo of source.tempos) {
    metaEvents.push({ tick: tempo.tick, order: 2, bytes: metaEvent(0x51, bytesFromMpq(tempo.mpq)) })
  }

  for (const signature of source.timeSignatures) {
    metaEvents.push({
      tick: signature.tick,
      order: 3,
      bytes: metaEvent(0x58, [
        signature.numerator,
        Math.round(Math.log2(signature.denominator)),
        signature.clocksPerClick,
        signature.thirtySecondNotes,
      ]),
    })
  }

  for (const marker of source.markers) {
    if (marker.type === 'marker') {
      metaEvents.push({ tick: marker.tick, order: 4, bytes: metaEvent(0x06, stringBytes(marker.text)) })
    }
  }

  const guitarEvents: Array<{ tick: number; order: number; bytes: number[] }> = [
    { tick: 0, order: 0, bytes: metaEvent(0x03, stringBytes(`${track.name || 'Guitar'} mapped`)) },
  ]

  for (let stringIndex = 0; stringIndex < 6; stringIndex += 1) {
    const channel = 10 + stringIndex
    guitarEvents.push({ tick: 0, order: 1, bytes: [0xc0 | channel, 26] })
  }

  for (const note of track.notes) {
    const placement = placements.get(note.id)
    if (!placement) continue
    const channel = 10 + placement.stringIndex
    const velocity = Math.min(127, Math.max(1, Math.round(note.velocity * 127)))
    guitarEvents.push({ tick: note.tick, order: 3, bytes: [0x90 | channel, note.midi, velocity] })
    guitarEvents.push({ tick: note.endTick, order: 2, bytes: [0x80 | channel, note.midi, 0] })
  }

  const header = [
    ...stringBytes('MThd'),
    0x00,
    0x00,
    0x00,
    0x06,
    0x00,
    0x01,
    0x00,
    0x02,
    (source.ppq >>> 8) & 0xff,
    source.ppq & 0xff,
  ]
  const bytes = [
    ...header,
    ...trackChunk(metaEvents, endTick),
    ...trackChunk(guitarEvents, endTick),
  ]

  return new Uint8Array(bytes)
}

export function createDemoMidi(): ParsedMidi {
  const ppq = 480
  const tempos: TempoEvent[] = [{ tick: 0, time: 0, bpm: 112, mpq: 535714 }]
  const chordNames = ['Dm7', 'G7', 'Cmaj7', 'A7', 'Dm7', 'G7', 'Em7', 'A7']
  const markers: MidiMarker[] = chordNames.map((text, index) => ({
    tick: index * ppq * 4,
    time: ticksToSeconds(index * ppq * 4, tempos, ppq),
    text,
    type: 'marker',
  }))
  const pattern = [62, 65, 69, 72, 74, 72, 69, 65]
  const counterPattern = [50, 55, 59, 62, 52, 57, 60, 64]
  const notes: MidiNote[] = []
  const counterNotes: MidiNote[] = []

  for (let bar = 0; bar < 8; bar += 1) {
    for (let step = 0; step < 4; step += 1) {
      const tick = bar * ppq * 4 + step * ppq
      const midi = pattern[(bar + step) % pattern.length]
      const time = ticksToSeconds(tick, tempos, ppq)
      const endTick = tick + ppq * 0.82
      notes.push({
        id: `demo-${bar}-${step}`,
        trackIndex: 1,
        trackName: 'Demo Guitar',
        channel: 1,
        midi,
        velocity: 0.78,
        tick,
        durationTicks: ppq * 0.82,
        endTick,
        time,
        duration: ticksToSeconds(endTick, tempos, ppq) - time,
      })
    }

    for (let step = 0; step < 2; step += 1) {
      const tick = bar * ppq * 4 + step * ppq * 2
      const midi = counterPattern[(bar + step) % counterPattern.length]
      const time = ticksToSeconds(tick, tempos, ppq)
      const endTick = tick + ppq * 1.55
      counterNotes.push({
        id: `demo-counter-${bar}-${step}`,
        trackIndex: 2,
        trackName: 'Demo Counterline',
        channel: 2,
        midi,
        velocity: 0.64,
        tick,
        durationTicks: ppq * 1.55,
        endTick,
        time,
        duration: ticksToSeconds(endTick, tempos, ppq) - time,
      })
    }
  }

  const durationTicks = ppq * 32
  return {
    fileName: 'Miditar Demo.mid',
    title: 'Miditar Demo',
    format: 1,
    ppq,
    durationTicks,
    duration: ticksToSeconds(durationTicks, tempos, ppq),
    tempos,
    timeSignatures: [
      { tick: 0, time: 0, numerator: 4, denominator: 4, clocksPerClick: 24, thirtySecondNotes: 8 },
    ],
    keySignatures: [],
    markers,
    tracks: [
      { index: 1, name: 'Demo Guitar', notes, channels: [1], programs: { 1: 26 } },
      { index: 2, name: 'Demo Counterline', notes: counterNotes, channels: [2], programs: { 2: 24 } },
    ],
  }
}
