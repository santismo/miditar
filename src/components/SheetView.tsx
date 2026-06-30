import { useEffect, useMemo, useRef } from 'react'
import type { MidiMarker, MidiNote, ParsedMidi } from '../lib/midi'
import { midiTicksToSeconds, noteName, secondsToTicks } from '../lib/midi'

type SheetViewProps = {
  midi: ParsedMidi
  notes: MidiNote[]
  markers: MidiMarker[]
  currentTime: number
  isPlaying: boolean
  onScrub: (time: number) => void
  trackColors?: Record<number, string>
}

const MEASURE_WIDTH = 260
const MEASURE_HEIGHT = 136
const STAFF_TOP = 48
const STAFF_GAP = 12

function getMeasureTicks(midi: ParsedMidi) {
  const signature = midi.timeSignatures[0]
  if (!signature) return midi.ppq * 4
  return midi.ppq * 4 * (signature.numerator / signature.denominator)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function noteY(note: MidiNote, minPitch: number, maxPitch: number) {
  const range = Math.max(1, maxPitch - minPitch)
  return 110 - ((note.midi - minPitch) / range) * 72
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

export function SheetView({
  midi,
  notes,
  markers,
  currentTime,
  isPlaying,
  onScrub,
  trackColors = {},
}: SheetViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const programmaticScrollUntilRef = useRef(0)
  const userScrollRef = useRef(false)
  const userScrollTimerRef = useRef<number | null>(null)
  const currentTick = secondsToTicks(midi, currentTime)
  const measureTicks = getMeasureTicks(midi)
  const measureCount = Math.max(1, Math.ceil(midi.durationTicks / measureTicks))
  const minPitch = notes.length ? Math.min(...notes.map((note) => note.midi)) - 2 : 48
  const maxPitch = notes.length ? Math.max(...notes.map((note) => note.midi)) + 2 : 76
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
        markers: markers.filter((marker) => marker.type === 'marker' && marker.tick >= start && marker.tick < end),
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
            {measures.map((measure) => {
              return (
                <svg
                  key={measure.index}
                  className="sheet-measure"
                  data-measure={measure.index}
                  viewBox={`0 0 ${MEASURE_WIDTH} ${MEASURE_HEIGHT}`}
                  role="img"
                  aria-label={`Measure ${measure.index + 1}`}
                >
                  <rect x="0" y="0" width={MEASURE_WIDTH} height={MEASURE_HEIGHT} rx="6" />
                  <text x="10" y="19" className="measure-number">
                    {measure.index + 1}
                  </text>
                  {measure.markers.map((marker) => {
                    const x = 32 + ((marker.tick - measure.start) / measureTicks) * (MEASURE_WIDTH - 52)
                    return (
                      <text key={`${marker.tick}-${marker.text}`} x={x} y="20" className="sheet-chord">
                        {marker.text}
                      </text>
                    )
                  })}
                  {Array.from({ length: 5 }).map((_, line) => {
                    const y = STAFF_TOP + line * STAFF_GAP
                    return <line key={line} x1="10" x2={MEASURE_WIDTH - 10} y1={y} y2={y} />
                  })}
                  <line x1="10" x2="10" y1={STAFF_TOP} y2={STAFF_TOP + STAFF_GAP * 4} className="barline" />
                  <line
                    x1={MEASURE_WIDTH - 10}
                    x2={MEASURE_WIDTH - 10}
                    y1={STAFF_TOP}
                    y2={STAFF_TOP + STAFF_GAP * 4}
                    className="barline"
                  />
                  {measure.notes.map((note) => {
                    const x = 22 + ((note.tick - measure.start) / measureTicks) * (MEASURE_WIDTH - 46)
                    const w = Math.max(8, (note.durationTicks / measureTicks) * (MEASURE_WIDTH - 46))
                    const y = noteY(note, minPitch, maxPitch)
                    const color = trackColors[note.trackIndex] ?? '#7bd88f'
                    return (
                      <g key={note.id}>
                        <rect
                          x={x}
                          y={y - 3}
                          width={w}
                          height="6"
                          rx="3"
                          className="sheet-duration"
                          style={{ fill: `${color}42` }}
                        />
                        <ellipse cx={x} cy={y} rx="7" ry="5" className="sheet-note" style={{ fill: color }}>
                          <title>{`${note.trackName}: ${noteName(note.midi)}`}</title>
                        </ellipse>
                        <line x1={x + 6} x2={x + 6} y1={y} y2={y - 27} className="stem" />
                      </g>
                    )
                  })}
                </svg>
              )
            })}
            <div className="sheet-pad" aria-hidden="true" />
          </div>
        </div>
        <div className="center-playhead" aria-hidden="true" />
      </div>
    </section>
  )
}
