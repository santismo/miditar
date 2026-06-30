import { useEffect, useMemo, useRef } from 'react'
import type { MidiMarker, MidiNote, ParsedMidi } from '../lib/midi'
import { midiTicksToSeconds, secondsToTicks } from '../lib/midi'

type SheetViewProps = {
  midi: ParsedMidi
  notes: MidiNote[]
  markers: MidiMarker[]
  currentTime: number
  isPlaying: boolean
  onScrub: (time: number) => void
  trackColors?: Record<number, string>
}

type Measure = {
  index: number
  start: number
  end: number
  notes: MidiNote[]
  markers: MidiMarker[]
}

type VexflowModule = typeof import('vexflow')
type VexStaveNote = InstanceType<VexflowModule['StaveNote']>

const MEASURE_WIDTH = 300
const MEASURE_HEIGHT = 154
const SIXTEENTH_DIVISIONS = 4
const SHARP_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b']
const FLAT_NAMES = ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b']
const MAJOR_KEYS = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#']
const MINOR_KEYS = ['Abm', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm', 'Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'A#m']

function getMeasureTicks(midi: ParsedMidi) {
  const signature = midi.timeSignatures[0]
  if (!signature) return midi.ppq * 4
  return midi.ppq * 4 * (signature.numerator / signature.denominator)
}

function activeTimeSignature(midi: ParsedMidi) {
  return midi.timeSignatures[0] ?? {
    tick: 0,
    time: 0,
    numerator: 4,
    denominator: 4,
    clocksPerClick: 24,
    thirtySecondNotes: 8,
  }
}

function keySignatureName(midi: ParsedMidi) {
  const signature = midi.keySignatures[0]
  if (!signature) return null
  const index = signature.sf + 7
  if (index < 0 || index >= MAJOR_KEYS.length) return null
  return signature.minor ? MINOR_KEYS[index] : MAJOR_KEYS[index]
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function currentMarker(markers: MidiMarker[], currentTime: number) {
  let active: MidiMarker | null = null
  for (const marker of markers) {
    if (marker.type !== 'marker') continue
    if (marker.time <= currentTime + 0.02) active = marker
    else break
  }
  return active
}

function durationToVex(ticks: number, ppq: number) {
  const quarterNotes = Math.max(0.125, ticks / ppq)
  if (quarterNotes >= 3.25) return { duration: 'w', ticks: ppq * 4 }
  if (quarterNotes >= 1.5) return { duration: 'h', ticks: ppq * 2 }
  if (quarterNotes >= 0.75) return { duration: 'q', ticks: ppq }
  if (quarterNotes >= 0.375) return { duration: '8', ticks: ppq / 2 }
  return { duration: '16', ticks: ppq / 4 }
}

function midiToVexKey(midi: number, preferFlats: boolean) {
  const pitchClass = midi % 12
  const name = (preferFlats ? FLAT_NAMES : SHARP_NAMES)[pitchClass]
  const octave = Math.floor(midi / 12) - 1
  const accidental = name.includes('#') ? '#' : name.includes('b') ? 'b' : null
  return { key: `${name}/${octave}`, accidental }
}

function addRest(tickables: VexStaveNote[], ticks: number, ppq: number, Vex: VexflowModule) {
  let remaining = ticks
  while (remaining >= ppq / 8) {
    const duration = durationToVex(remaining, ppq)
    tickables.push(new Vex.StaveNote({ keys: ['b/4'], duration: `${duration.duration}r` }))
    remaining -= duration.ticks
  }
}

function buildNotationNotes(measure: Measure, midi: ParsedMidi, Vex: VexflowModule) {
  const unitTicks = midi.ppq / SIXTEENTH_DIVISIONS
  const preferFlats = (midi.keySignatures[0]?.sf ?? 0) < 0
  const groups = new Map<number, MidiNote[]>()

  for (const note of measure.notes) {
    const start = clamp(note.tick, measure.start, measure.end)
    const local = Math.round((start - measure.start) / unitTicks) * unitTicks
    if (!groups.has(local)) groups.set(local, [])
    groups.get(local)!.push(note)
  }

  const starts = [...groups.keys()].sort((a, b) => a - b)
  const tickables: VexStaveNote[] = []
  let cursor = 0

  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index]
    const group = groups.get(start)!
    if (start > cursor) addRest(tickables, start - cursor, midi.ppq, Vex)

    const nextStart = starts[index + 1] ?? measure.end - measure.start
    const groupEnd = Math.max(...group.map((note) => clamp(note.endTick, measure.start, measure.end) - measure.start))
    const duration = durationToVex(Math.max(unitTicks, Math.min(groupEnd, nextStart) - start), midi.ppq)
    const selectedNotes = [...group]
      .sort((a, b) => a.midi - b.midi || b.velocity - a.velocity)
      .slice(0, 6)
    const pitches = selectedNotes.map((note) => midiToVexKey(note.midi, preferFlats))
    const staveNote = new Vex.StaveNote({
      clef: 'treble',
      keys: pitches.map((pitch) => pitch.key),
      duration: duration.duration,
    })

    pitches.forEach((pitch, pitchIndex) => {
      if (pitch.accidental) staveNote.addModifier(new Vex.Accidental(pitch.accidental), pitchIndex)
    })
    tickables.push(staveNote)
    cursor = start + duration.ticks
  }

  if (cursor < measure.end - measure.start) {
    addRest(tickables, measure.end - measure.start - cursor, midi.ppq, Vex)
  }
  return tickables.length ? tickables : [new Vex.StaveNote({ keys: ['b/4'], duration: 'wr' })]
}

function MeasureNotation({
  measure,
  midi,
  showSignature,
}: {
  measure: Measure
  midi: ParsedMidi
  showSignature: boolean
}) {
  const notationRef = useRef<HTMLDivElement | null>(null)
  const signature = activeTimeSignature(midi)
  const keyName = keySignatureName(midi)

  useEffect(() => {
    const node = notationRef.current
    if (!node) return
    node.innerHTML = ''
    let cancelled = false

    void import('vexflow').then((Vex) => {
      if (cancelled) return
      try {
        const renderer = new Vex.Renderer(node, Vex.Renderer.Backends.SVG)
        renderer.resize(MEASURE_WIDTH, MEASURE_HEIGHT)
        const context = renderer.getContext()
        context.setFillStyle('#d8e0d0')
        context.setStrokeStyle('#d8e0d0')

        const stave = new Vex.Stave(10, 36, MEASURE_WIDTH - 20)
        if (showSignature) {
          stave.addClef('treble')
          if (keyName) stave.addKeySignature(keyName)
          stave.addTimeSignature(`${signature.numerator}/${signature.denominator}`)
        }
        stave.setContext(context).draw()

        const tickables = buildNotationNotes(measure, midi, Vex)
        const voice = new Vex.Voice({
          numBeats: signature.numerator,
          beatValue: signature.denominator,
        }).setMode(Vex.Voice.Mode.SOFT)
        voice.addTickables(tickables)
        new Vex.Formatter().joinVoices([voice]).format([voice], showSignature ? MEASURE_WIDTH - 120 : MEASURE_WIDTH - 44)
        voice.draw(context, stave)

        const beams = Vex.Beam.generateBeams(tickables.filter((note) => !note.isRest()))
        beams.forEach((beam) => beam.setContext(context).draw())
      } catch {
        node.innerHTML = ''
      }
    })

    return () => {
      cancelled = true
    }
  }, [keyName, measure, midi, showSignature, signature.denominator, signature.numerator])

  return (
    <div className="sheet-measure" data-measure={measure.index}>
      <div className="sheet-notation" ref={notationRef} />
      <span className="measure-number">{measure.index + 1}</span>
      {measure.markers.map((marker) => {
        const measureTicks = measure.end - measure.start
        const x = 32 + ((marker.tick - measure.start) / measureTicks) * (MEASURE_WIDTH - 62)
        return (
          <span key={`${marker.tick}-${marker.text}`} className="sheet-chord" style={{ left: x }}>
            {marker.text}
          </span>
        )
      })}
    </div>
  )
}

export function SheetView({
  midi,
  notes,
  markers,
  currentTime,
  isPlaying,
  onScrub,
}: SheetViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const programmaticScrollUntilRef = useRef(0)
  const userScrollRef = useRef(false)
  const userScrollTimerRef = useRef<number | null>(null)
  const currentTick = secondsToTicks(midi, currentTime)
  const measureTicks = getMeasureTicks(midi)
  const measureCount = Math.max(1, Math.ceil(midi.durationTicks / measureTicks))
  const marker = currentMarker(markers, currentTime)

  const measures = useMemo(() => {
    return Array.from({ length: measureCount }).map((_, index) => {
      const start = index * measureTicks
      const end = start + measureTicks
      return {
        index,
        start,
        end,
        notes: notes.filter((note) => note.tick < end && note.endTick > start),
        markers: markers.filter((item) => item.type === 'marker' && item.tick >= start && item.tick < end),
      }
    })
  }, [markers, measureCount, measureTicks, notes])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const absoluteX = (currentTick / measureTicks) * MEASURE_WIDTH
    if (Math.abs(container.scrollLeft - absoluteX) < 0.5) return
    programmaticScrollUntilRef.current = performance.now() + 220
    container.scrollLeft = Math.max(0, absoluteX)
  }, [currentTick, measureTicks])

  function beginUserScroll() {
    if (isPlaying) return
    userScrollRef.current = true
    if (userScrollTimerRef.current !== null) window.clearTimeout(userScrollTimerRef.current)
  }

  function settleUserScroll() {
    if (userScrollTimerRef.current !== null) window.clearTimeout(userScrollTimerRef.current)
    userScrollTimerRef.current = window.setTimeout(() => {
      userScrollRef.current = false
    }, 900)
  }

  function handleScroll() {
    const container = containerRef.current
    if (!container || isPlaying || !userScrollRef.current || performance.now() < programmaticScrollUntilRef.current) {
      return
    }
    const absoluteX = container.scrollLeft
    const tick = clamp((absoluteX / MEASURE_WIDTH) * measureTicks, 0, midi.durationTicks)
    const nextTime = midiTicksToSeconds(midi, tick)
    if (Math.abs(nextTime - currentTime) < 0.01) return
    onScrub(nextTime)
    settleUserScroll()
  }

  return (
    <section className="sheet-panel" aria-label="Scrollable sheet music" data-playing={isPlaying}>
      <div className="panel-mini-header">
        <span>Sheet</span>
        <strong>{marker?.text || midi.title}</strong>
      </div>
      <div className="sheet-frame">
        <div
          className="sheet-scroll"
          ref={containerRef}
          onScroll={handleScroll}
          onWheel={beginUserScroll}
          onPointerDown={beginUserScroll}
          onPointerUp={settleUserScroll}
          onPointerCancel={settleUserScroll}
          onTouchStart={beginUserScroll}
          onTouchEnd={settleUserScroll}
          onTouchCancel={settleUserScroll}
        >
          <div className="sheet-system">
            <div className="sheet-pad" aria-hidden="true" />
            {measures.map((measure) => (
              <MeasureNotation key={measure.index} measure={measure} midi={midi} showSignature={measure.index === 0} />
            ))}
            <div className="sheet-pad" aria-hidden="true" />
          </div>
        </div>
        <div className="center-playhead" aria-hidden="true" />
      </div>
    </section>
  )
}
