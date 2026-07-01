import { useEffect, useMemo, useRef } from 'react'
import type { MidiMarker, MidiNote, ParsedMidi } from '../lib/midi'
import { activeMarkerAtTick, midiTicksToSeconds, secondsToTicks } from '../lib/midi'

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
type ClefName = 'treble' | 'bass'
type VexDurationName = 'w' | 'h' | 'q' | '8' | '16' | '32'

const MEASURE_WIDTH = 360
const MEASURE_HEIGHT = 188
const MEASURE_GAP = 11
const MEASURE_TIME_LEFT = 32
const MEASURE_TIME_WIDTH = MEASURE_WIDTH - 62
const THIRTY_SECOND_DIVISIONS = 8
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

function durationToVex(ticks: number, ppq: number) {
  const unitTicks = ppq / THIRTY_SECOND_DIVISIONS
  const units = Math.max(1, Math.round(ticks / unitTicks))
  const durations: { units: number; duration: VexDurationName; dots: number }[] = [
    { units: 32, duration: 'w', dots: 0 },
    { units: 24, duration: 'h', dots: 1 },
    { units: 16, duration: 'h', dots: 0 },
    { units: 12, duration: 'q', dots: 1 },
    { units: 8, duration: 'q', dots: 0 },
    { units: 6, duration: '8', dots: 1 },
    { units: 4, duration: '8', dots: 0 },
    { units: 3, duration: '16', dots: 1 },
    { units: 2, duration: '16', dots: 0 },
    { units: 1, duration: '32', dots: 0 },
  ]
  const match = durations.find((item) => units >= item.units) ?? durations[durations.length - 1]
  return { duration: match.duration, dots: match.dots, ticks: match.units * unitTicks }
}

function vexDurationString(duration: ReturnType<typeof durationToVex>, rest = false) {
  return `${duration.duration}${'d'.repeat(duration.dots)}${rest ? 'r' : ''}`
}

function attachDots(note: VexStaveNote, dots: number, Vex: VexflowModule) {
  for (let index = 0; index < dots; index += 1) {
    Vex.Dot.buildAndAttach([note], { all: true })
  }
}

function midiToVexKey(midi: number, preferFlats: boolean) {
  const pitchClass = midi % 12
  const name = (preferFlats ? FLAT_NAMES : SHARP_NAMES)[pitchClass]
  const octave = Math.floor(midi / 12) - 1
  const accidental = name.includes('#') ? '#' : name.includes('b') ? 'b' : null
  return { key: `${name}/${octave}`, accidental }
}

function restKey(clef: ClefName) {
  return clef === 'bass' ? 'd/3' : 'b/4'
}

function clefForMeasure(measure: Measure): ClefName {
  if (!measure.notes.length) return 'treble'
  const averageMidi = measure.notes.reduce((total, note) => total + note.midi, 0) / measure.notes.length
  return averageMidi < 57 ? 'bass' : 'treble'
}

function addRest(tickables: VexStaveNote[], ticks: number, ppq: number, clef: ClefName, Vex: VexflowModule) {
  let remaining = ticks
  while (remaining >= ppq / THIRTY_SECOND_DIVISIONS) {
    const duration = durationToVex(remaining, ppq)
    const rest = new Vex.StaveNote({
      clef,
      keys: [restKey(clef)],
      duration: vexDurationString(duration, true),
    })
    attachDots(rest, duration.dots, Vex)
    tickables.push(rest)
    remaining -= duration.ticks
  }
}

function buildNotationNotes(measure: Measure, midi: ParsedMidi, clef: ClefName, Vex: VexflowModule) {
  const unitTicks = midi.ppq / THIRTY_SECOND_DIVISIONS
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
    if (start > cursor) addRest(tickables, start - cursor, midi.ppq, clef, Vex)

    const nextStart = starts[index + 1] ?? measure.end - measure.start
    const groupEnd = Math.max(...group.map((note) => clamp(note.endTick, measure.start, measure.end) - measure.start))
    const duration = durationToVex(Math.max(unitTicks, Math.min(groupEnd, nextStart) - start), midi.ppq)
    const selectedNotes = [...group]
      .sort((a, b) => a.midi - b.midi || b.velocity - a.velocity)
      .filter((note, noteIndex, sorted) => sorted.findIndex((item) => item.midi === note.midi) === noteIndex)
      .slice(0, 6)
    const pitches = selectedNotes.map((note) => midiToVexKey(note.midi, preferFlats))
    const staveNote = new Vex.StaveNote({
      clef,
      keys: pitches.map((pitch) => pitch.key),
      duration: vexDurationString(duration),
      autoStem: true,
    })

    pitches.forEach((pitch, pitchIndex) => {
      if (pitch.accidental) staveNote.addModifier(new Vex.Accidental(pitch.accidental), pitchIndex)
    })
    attachDots(staveNote, duration.dots, Vex)
    tickables.push(staveNote)
    cursor = start + duration.ticks
  }

  if (cursor < measure.end - measure.start) {
    addRest(tickables, measure.end - measure.start - cursor, midi.ppq, clef, Vex)
  }
  return tickables.length ? tickables : [new Vex.StaveNote({ clef, keys: [restKey(clef)], duration: 'wr' })]
}

function MeasureNotation({
  measure,
  midi,
  showSignature,
  showClef,
}: {
  measure: Measure
  midi: ParsedMidi
  showSignature: boolean
  showClef: boolean
}) {
  const notationRef = useRef<HTMLDivElement | null>(null)
  const signature = activeTimeSignature(midi)
  const keyName = keySignatureName(midi)
  const clef = clefForMeasure(measure)

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
        const svg = node.querySelector('svg')
        svg?.setAttribute('viewBox', `0 0 ${MEASURE_WIDTH} ${MEASURE_HEIGHT}`)
        svg?.setAttribute('preserveAspectRatio', 'xMidYMid meet')
        const context = renderer.getContext()
        context.setFillStyle('#d8e0d0')
        context.setStrokeStyle('#d8e0d0')

        const stave = new Vex.Stave(12, 54, MEASURE_WIDTH - 24)
        if (showClef) stave.addClef(clef)
        if (showSignature) {
          if (keyName) stave.addKeySignature(keyName)
          stave.addTimeSignature(`${signature.numerator}/${signature.denominator}`)
        }
        stave.setContext(context).draw()

        const tickables = buildNotationNotes(measure, midi, clef, Vex)
        const voice = new Vex.Voice({
          numBeats: signature.numerator,
          beatValue: signature.denominator,
        }).setMode(Vex.Voice.Mode.SOFT)
        voice.addTickables(tickables)
        new Vex.Formatter()
          .joinVoices([voice])
          .format([voice], showSignature || showClef ? MEASURE_WIDTH - 148 : MEASURE_WIDTH - 56)
        voice.draw(context, stave)
      } catch {
        node.innerHTML = ''
      }
    })

    return () => {
      cancelled = true
    }
  }, [clef, keyName, measure, midi, showClef, showSignature, signature.denominator, signature.numerator])

  return (
    <div className="sheet-measure" data-measure={measure.index}>
      <div className="sheet-notation" ref={notationRef} />
      <span className="measure-number">{measure.index + 1}</span>
      {measure.markers.map((marker) => {
        const measureTicks = measure.end - measure.start
        const x = MEASURE_TIME_LEFT + ((marker.tick - measure.start) / measureTicks) * MEASURE_TIME_WIDTH
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
  const marker = activeMarkerAtTick(markers, currentTick)

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
    const measureIndex = Math.floor(currentTick / measureTicks)
    const localTick = currentTick - measureIndex * measureTicks
    const absoluteX =
      measureIndex * (MEASURE_WIDTH + MEASURE_GAP) +
      MEASURE_TIME_LEFT +
      (localTick / measureTicks) * MEASURE_TIME_WIDTH
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
    const absoluteX = Math.max(0, container.scrollLeft - MEASURE_TIME_LEFT)
    const measureIndex = Math.max(0, Math.floor(absoluteX / (MEASURE_WIDTH + MEASURE_GAP)))
    const measureStartX = measureIndex * (MEASURE_WIDTH + MEASURE_GAP)
    const localX = clamp(container.scrollLeft - measureStartX - MEASURE_TIME_LEFT, 0, MEASURE_TIME_WIDTH)
    const tick = clamp(measureIndex * measureTicks + (localX / MEASURE_TIME_WIDTH) * measureTicks, 0, midi.durationTicks)
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
              <MeasureNotation
                key={measure.index}
                measure={measure}
                midi={midi}
                showSignature={measure.index === 0}
                showClef={measure.index === 0}
              />
            ))}
            <div className="sheet-pad" aria-hidden="true" />
          </div>
        </div>
        <div className="center-playhead" aria-hidden="true" />
      </div>
    </section>
  )
}
