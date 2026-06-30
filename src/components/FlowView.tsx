import { type PointerEvent, useEffect, useMemo, useRef } from 'react'
import type { MidiMarker, MidiNote, MidiPlacement, ParsedMidi } from '../lib/midi'
import { midiTicksToSeconds, noteName } from '../lib/midi'
import { GUITAR_STRINGS } from '../lib/fretboard'
import {
  FRETBOARD_LEFT,
  FRETBOARD_VIEW_WIDTH,
  fretLineX,
} from '../lib/fretboardLayout'

type FlowViewProps = {
  midi: ParsedMidi
  notes: MidiNote[]
  markers: MidiMarker[]
  placements: Map<string, MidiPlacement>
  currentTime: number
  isPlaying: boolean
  onScrub: (time: number) => void
  trackColors?: Record<number, string>
  pixelsPerSecond?: number
}

const DEFAULT_PIXELS_PER_SECOND = 168

function timelineTop(midi: ParsedMidi, time: number, pixelsPerSecond: number) {
  return Math.max(0, midi.duration - time) * pixelsPerSecond
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

function getMeasureTicks(midi: ParsedMidi) {
  const signature = midi.timeSignatures[0]
  if (!signature) return midi.ppq * 4
  return midi.ppq * 4 * (signature.numerator / signature.denominator)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function markerAt(markers: MidiMarker[], time: number) {
  let active: MidiMarker | null = null
  for (const marker of markers) {
    if (marker.type !== 'marker') continue
    if (marker.time <= time + 0.02) active = marker
    else break
  }
  return active
}

function measureNumberForTick(tick: number, measureTicks: number) {
  return Math.floor(tick / measureTicks) + 1
}

function isNearMeasureStart(tick: number, measureTicks: number) {
  const localTick = tick % measureTicks
  return localTick < measureTicks * 0.025 || measureTicks - localTick < measureTicks * 0.025
}

function fretSlot(placement: MidiPlacement, maxFret: number) {
  if (placement.fret <= 0) {
    const right = FRETBOARD_LEFT
    const left = FRETBOARD_LEFT - 50
    return { left, right, width: right - left }
  }

  const left = fretLineX(placement.fret - 1, maxFret)
  const right = fretLineX(placement.fret, maxFret)
  return { left, right, width: right - left }
}

export function FlowView({
  midi,
  notes,
  markers,
  placements,
  currentTime,
  isPlaying,
  onScrub,
  trackColors = {},
  pixelsPerSecond = DEFAULT_PIXELS_PER_SECOND,
}: FlowViewProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const programmaticScrollUntilRef = useRef(0)
  const userScrollRef = useRef(false)
  const userScrollTimerRef = useRef<number | null>(null)
  const timelineScrubbingRef = useRef(false)
  const marker = currentMarker(markers, currentTime)
  const contentHeight = Math.max(520, midi.duration * pixelsPerSecond)
  const maxFret = 22
  const timelinePercent = midi.duration ? clamp(currentTime / midi.duration, 0, 1) * 100 : 0
  const measureTicks = getMeasureTicks(midi)
  const measureMarkers = useMemo(() => {
    const count = Math.max(1, Math.ceil(midi.durationTicks / measureTicks))
    return Array.from({ length: count }).map((_, index) => {
      const startTick = index * measureTicks
      const endTick = Math.min(midi.durationTicks, startTick + measureTicks)
      const startTime = midiTicksToSeconds(midi, startTick)
      const endTime = midiTicksToSeconds(midi, endTick)
      return {
        index,
        top: timelineTop(midi, endTime, pixelsPerSecond),
        lineTop: timelineTop(midi, startTime, pixelsPerSecond),
        height: Math.max(1, timelineTop(midi, startTime, pixelsPerSecond) - timelineTop(midi, endTime, pixelsPerSecond)),
        marker: markerAt(markers, startTime),
      }
    })
  }, [markers, measureTicks, midi, pixelsPerSecond])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const targetTop = timelineTop(midi, currentTime, pixelsPerSecond)
    if (Math.abs(container.scrollTop - targetTop) < 0.5) return
    programmaticScrollUntilRef.current = performance.now() + 220
    container.scrollTop = Math.max(0, targetTop)
  }, [currentTime, midi, pixelsPerSecond])

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
    const container = scrollRef.current
    if (!container || isPlaying || !userScrollRef.current || performance.now() < programmaticScrollUntilRef.current) {
      return
    }
    const nextTime = Math.min(midi.duration, Math.max(0, midi.duration - container.scrollTop / pixelsPerSecond))
    if (Math.abs(nextTime - currentTime) < 0.01) return
    onScrub(nextTime)
    settleUserScroll()
  }

  function scrubTimeline(clientX: number, target: HTMLDivElement) {
    const rect = target.getBoundingClientRect()
    const percent = clamp((clientX - rect.left) / rect.width, 0, 1)
    onScrub(percent * midi.duration)
  }

  function handleTimelinePointerDown(event: PointerEvent<HTMLDivElement>) {
    timelineScrubbingRef.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    scrubTimeline(event.clientX, event.currentTarget)
  }

  function handleTimelinePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!timelineScrubbingRef.current) return
    scrubTimeline(event.clientX, event.currentTarget)
  }

  function handleTimelinePointerUp(event: PointerEvent<HTMLDivElement>) {
    timelineScrubbingRef.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <section className="flow-panel" aria-label="Scrollable falling MIDI notes" data-playing={isPlaying}>
      <div className="panel-mini-header">
        <span>MIDI</span>
        <strong>{marker?.text || '-'}</strong>
      </div>
      <div className="flow-frame">
        <div
          className="flow-scroll"
          ref={scrollRef}
          onScroll={handleScroll}
          onWheel={beginUserScroll}
          onPointerDown={beginUserScroll}
          onPointerUp={settleUserScroll}
          onPointerCancel={settleUserScroll}
          onTouchStart={beginUserScroll}
          onTouchEnd={settleUserScroll}
          onTouchCancel={settleUserScroll}
        >
          <div className="flow-spacer flow-spacer-start" />
          <div className="flow-content" style={{ height: contentHeight }}>
            {measureMarkers.map((measure) => (
              <div
                key={`band-${measure.index}`}
                className={`falling-bar-band ${measure.index % 2 ? 'is-alt' : ''}`}
                style={{ top: measure.top, height: measure.height }}
              />
            ))}
            <div className="fret-guides" aria-hidden="true">
              {Array.from({ length: maxFret + 1 }).map((_, fret) => (
                <div key={fret} style={{ left: `${(fretLineX(fret, maxFret) / FRETBOARD_VIEW_WIDTH) * 100}%` }}>
                  {fret > 0 && [3, 5, 7, 9, 12, 15, 17].includes(fret) ? fret : ''}
                </div>
              ))}
            </div>
            {measureMarkers.map((measure) => (
              <div key={`line-${measure.index}`} className="falling-barline" style={{ top: measure.lineTop }}>
                <span>{measure.index + 1}</span>
                {measure.marker && <strong>{measure.marker.text}</strong>}
              </div>
            ))}
            {markers
              .filter((event) => event.type === 'marker' && !isNearMeasureStart(event.tick, measureTicks))
              .map((event) => (
                <div
                  key={`${event.tick}-${event.text}`}
                  className="falling-mid-chord"
                  style={{ top: timelineTop(midi, event.time, pixelsPerSecond) }}
                >
                  <span>{measureNumberForTick(event.tick, measureTicks)}</span>
                  <strong>{event.text}</strong>
                </div>
              ))}
            {notes.map((note) => {
              const placement = placements.get(note.id)
              if (!placement) return null
              const string = GUITAR_STRINGS[placement.stringIndex]
              const slot = fretSlot(placement, maxFret)
              const x = (slot.left / FRETBOARD_VIEW_WIDTH) * 100
              const width = Math.max(0.92, (slot.width / FRETBOARD_VIEW_WIDTH) * 100)
              const y = timelineTop(midi, note.time, pixelsPerSecond)
              const height = Math.max(16, note.duration * pixelsPerSecond)
              const active = note.time <= currentTime && note.time + note.duration >= currentTime
              const trackColor = trackColors[note.trackIndex] ?? string.color
              const displayMidi = placement.midi ?? note.midi

              return (
                <div
                  key={note.id}
                  className={`falling-note ${active ? 'is-active' : ''}`}
                  style={{
                    left: `${x}%`,
                    width: `max(8px, ${width}%)`,
                    top: y,
                    height,
                    borderColor: string.color,
                    background: `linear-gradient(180deg, ${trackColor}, rgba(255,255,255,.12))`,
                  }}
                  title={`${note.trackName}: ${noteName(displayMidi)} on ${string.name} fret ${placement.fret}`}
                >
                  <span>{placement.fret}</span>
                </div>
              )
            })}
          </div>
          <div className="flow-spacer flow-spacer-end" />
        </div>
        <div
          className="flow-fretboard-playhead"
          aria-label="Timeline scrubber"
          onPointerDown={handleTimelinePointerDown}
          onPointerMove={handleTimelinePointerMove}
          onPointerUp={handleTimelinePointerUp}
          onPointerCancel={handleTimelinePointerUp}
        >
          <span style={{ left: `${timelinePercent}%` }} />
        </div>
      </div>
    </section>
  )
}
