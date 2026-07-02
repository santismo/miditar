import { useEffect, useMemo, useRef } from 'react'
import { GUITAR_STRINGS } from '../lib/fretboard'
import type { MidiMarker, MidiNote, MidiPlacement, ParsedMidi } from '../lib/midi'
import { activeMarkerAtTick, midiTicksToSeconds, secondsToTicks } from '../lib/midi'

type TabViewProps = {
  midi: ParsedMidi
  notes: MidiNote[]
  markers: MidiMarker[]
  placements: Map<string, MidiPlacement>
  currentTime: number
  isPlaying: boolean
  onScrub: (time: number) => void
  trackColors?: Record<number, string>
}

type TabMeasure = {
  index: number
  start: number
  end: number
  notes: MidiNote[]
  markers: MidiMarker[]
}

type TabNoteRender = {
  note: MidiNote
  placement: MidiPlacement
  startX: number
  endX: number
  y: number
  startsInMeasure: boolean
  color: string
}

const TAB_MEASURE_WIDTH = 360
const TAB_GAP = 11
const TAB_LINE_LEFT = 35
const TAB_LINE_RIGHT = TAB_MEASURE_WIDTH - 15
const TAB_TIME_LEFT = TAB_LINE_LEFT
const TAB_TIME_WIDTH = TAB_LINE_RIGHT - TAB_LINE_LEFT
const TAB_STRING_TOP = 47
const TAB_STRING_GAP = 21

function getMeasureTicks(midi: ParsedMidi) {
  const signature = midi.timeSignatures[0]
  if (!signature) return midi.ppq * 4
  return midi.ppq * 4 * (signature.numerator / signature.denominator)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function stringY(stringIndex: number) {
  return TAB_STRING_TOP + stringIndex * TAB_STRING_GAP
}

function displayStringName(name: string) {
  return name.replace(/\d+$/, '')
}

function TabMeasureView({
  measure,
  placements,
  trackColors = {},
}: {
  measure: TabMeasure
  placements: Map<string, MidiPlacement>
  trackColors?: Record<number, string>
}) {
  const measureTicks = measure.end - measure.start
  const tabNotes = useMemo(() => {
    return measure.notes
      .map((note): TabNoteRender | null => {
        const placement = placements.get(note.id)
        if (!placement) return null
        const visibleStart = clamp(note.tick, measure.start, measure.end)
        const visibleEnd = clamp(note.endTick, measure.start, measure.end)
        if (visibleEnd <= visibleStart) return null
        const startX = TAB_TIME_LEFT + ((visibleStart - measure.start) / measureTicks) * TAB_TIME_WIDTH
        const endX = TAB_TIME_LEFT + ((visibleEnd - measure.start) / measureTicks) * TAB_TIME_WIDTH
        const string = GUITAR_STRINGS[placement.stringIndex]
        return {
          note,
          placement,
          startX,
          endX,
          y: stringY(placement.stringIndex),
          startsInMeasure: note.tick >= measure.start && note.tick < measure.end,
          color: trackColors[note.trackIndex] ?? string?.color ?? '#f0c65a',
        }
      })
      .filter((item): item is TabNoteRender => item !== null)
      .sort((a, b) => a.placement.stringIndex - b.placement.stringIndex || a.note.tick - b.note.tick)
  }, [measure.end, measure.notes, measure.start, measureTicks, placements, trackColors])

  return (
    <div className="tab-measure" data-measure={measure.index}>
      <span className="measure-number">{measure.index + 1}</span>
      {measure.markers.map((marker) => {
        const x = TAB_TIME_LEFT + ((marker.tick - measure.start) / measureTicks) * TAB_TIME_WIDTH
        return (
          <span key={`${marker.tick}-${marker.text}`} className="sheet-chord tab-chord" style={{ left: x }}>
            {marker.text}
          </span>
        )
      })}

      <div className="tab-lines" aria-hidden="true">
        {GUITAR_STRINGS.map((string) => (
          <div key={string.index} className="tab-string" style={{ top: stringY(string.index) }}>
            <span className="tab-string-name">{displayStringName(string.name)}</span>
            <span className="tab-string-rule" />
          </div>
        ))}
      </div>

      {tabNotes.map((item) => {
        const width = Math.max(3, item.endX - item.startX)
        return (
          <span key={`${measure.index}-${item.note.id}`} className="tab-note-layer">
            <span
              className="tab-note-sustain"
              style={{
                left: item.startX,
                top: item.y,
                width,
                backgroundColor: item.color,
              }}
            />
            {item.startsInMeasure && (
              <span
                className="tab-note-fret"
                style={{
                  left: item.startX,
                  top: item.y,
                  borderColor: item.color,
                  color: item.color,
                }}
              >
                {item.placement.fret}
              </span>
            )}
          </span>
        )
      })}
    </div>
  )
}

export function TabView({
  midi,
  notes,
  markers,
  placements,
  currentTime,
  isPlaying,
  onScrub,
  trackColors,
}: TabViewProps) {
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
      measureIndex * (TAB_MEASURE_WIDTH + TAB_GAP) + TAB_TIME_LEFT + (localTick / measureTicks) * TAB_TIME_WIDTH
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
    const absoluteX = Math.max(0, container.scrollLeft - TAB_TIME_LEFT)
    const measureIndex = Math.max(0, Math.floor(absoluteX / (TAB_MEASURE_WIDTH + TAB_GAP)))
    const measureStartX = measureIndex * (TAB_MEASURE_WIDTH + TAB_GAP)
    const localX = clamp(container.scrollLeft - measureStartX - TAB_TIME_LEFT, 0, TAB_TIME_WIDTH)
    const tick = clamp(measureIndex * measureTicks + (localX / TAB_TIME_WIDTH) * measureTicks, 0, midi.durationTicks)
    const nextTime = midiTicksToSeconds(midi, tick)
    if (Math.abs(nextTime - currentTime) < 0.01) return
    onScrub(nextTime)
    settleUserScroll()
  }

  return (
    <section className="sheet-panel tab-panel" aria-label="Scrollable guitar tab" data-playing={isPlaying}>
      <div className="panel-mini-header">
        <span>Tab</span>
        <strong>{marker?.text || midi.title}</strong>
      </div>
      <div className="sheet-frame tab-frame">
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
              <TabMeasureView
                key={measure.index}
                measure={measure}
                placements={placements}
                trackColors={trackColors}
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
