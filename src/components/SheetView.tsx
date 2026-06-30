import { useEffect, useMemo, useRef } from 'react'
import type { MidiMarker, MidiNote, ParsedMidi } from '../lib/midi'
import { noteName, secondsToTicks } from '../lib/midi'

type SheetViewProps = {
  midi: ParsedMidi
  notes: MidiNote[]
  markers: MidiMarker[]
  currentTime: number
}

const MEASURE_WIDTH = 268
const MEASURE_HEIGHT = 128
const STAFF_TOP = 40
const STAFF_GAP = 10

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
  return 96 - ((note.midi - minPitch) / range) * 56
}

function chunk<T>(items: T[], size: number) {
  const rows: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size))
  }
  return rows
}

export function SheetView({ midi, notes, markers, currentTime }: SheetViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const currentTick = secondsToTicks(midi, currentTime)
  const measureTicks = getMeasureTicks(midi)
  const measureCount = Math.max(1, Math.ceil(midi.durationTicks / measureTicks))
  const currentMeasure = clamp(Math.floor(currentTick / measureTicks), 0, measureCount - 1)
  const minPitch = notes.length ? Math.min(...notes.map((note) => note.midi)) - 2 : 48
  const maxPitch = notes.length ? Math.max(...notes.map((note) => note.midi)) + 2 : 76

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
    const node = containerRef.current?.querySelector<HTMLElement>(`[data-measure="${currentMeasure}"]`)
    node?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [currentMeasure])

  return (
    <section className="sheet-panel" aria-label="Scrolling sheet music">
      <div className="sheet-header">
        <div>
          <span>Sheet</span>
          <strong>{midi.title}</strong>
        </div>
        <div>{measureCount} measures</div>
      </div>
      <div className="sheet-scroll" ref={containerRef}>
        {chunk(measures, 4).map((row, rowIndex) => (
          <div className="sheet-system" key={rowIndex}>
            {row.map((measure) => {
              const playhead =
                currentTick >= measure.start && currentTick < measure.end
                  ? ((currentTick - measure.start) / measureTicks) * MEASURE_WIDTH
                  : null

              return (
                <svg
                  key={measure.index}
                  className={`sheet-measure ${measure.index === currentMeasure ? 'is-current' : ''}`}
                  data-measure={measure.index}
                  viewBox={`0 0 ${MEASURE_WIDTH} ${MEASURE_HEIGHT}`}
                  role="img"
                  aria-label={`Measure ${measure.index + 1}`}
                >
                  <rect x="0" y="0" width={MEASURE_WIDTH} height={MEASURE_HEIGHT} rx="6" />
                  <text x="10" y="18" className="measure-number">
                    {measure.index + 1}
                  </text>
                  {measure.markers.map((marker) => {
                    const x = 28 + ((marker.tick - measure.start) / measureTicks) * (MEASURE_WIDTH - 42)
                    return (
                      <text key={`${marker.tick}-${marker.text}`} x={x} y="18" className="sheet-chord">
                        {marker.text}
                      </text>
                    )
                  })}
                  {Array.from({ length: 5 }).map((_, line) => {
                    const y = STAFF_TOP + line * STAFF_GAP
                    return <line key={line} x1="12" x2={MEASURE_WIDTH - 12} y1={y} y2={y} />
                  })}
                  <line x1="12" x2="12" y1={STAFF_TOP} y2={STAFF_TOP + STAFF_GAP * 4} className="barline" />
                  <line
                    x1={MEASURE_WIDTH - 12}
                    x2={MEASURE_WIDTH - 12}
                    y1={STAFF_TOP}
                    y2={STAFF_TOP + STAFF_GAP * 4}
                    className="barline"
                  />
                  {measure.notes.map((note) => {
                    const x = 22 + ((note.tick - measure.start) / measureTicks) * (MEASURE_WIDTH - 48)
                    const w = Math.max(7, (note.durationTicks / measureTicks) * (MEASURE_WIDTH - 48))
                    const y = noteY(note, minPitch, maxPitch)
                    return (
                      <g key={note.id}>
                        <rect x={x} y={y - 3} width={w} height="6" rx="3" className="sheet-duration" />
                        <ellipse cx={x} cy={y} rx="7" ry="5" className="sheet-note">
                          <title>{noteName(note.midi)}</title>
                        </ellipse>
                        <line x1={x + 6} x2={x + 6} y1={y} y2={y - 26} className="stem" />
                      </g>
                    )
                  })}
                  {playhead !== null && <line x1={playhead} x2={playhead} y1="24" y2="112" className="playhead" />}
                </svg>
              )
            })}
          </div>
        ))}
      </div>
    </section>
  )
}
