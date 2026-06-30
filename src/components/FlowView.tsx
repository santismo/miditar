import { useEffect, useRef } from 'react'
import type { MidiMarker, MidiNote, MidiPlacement, ParsedMidi } from '../lib/midi'
import { noteName } from '../lib/midi'
import { GUITAR_STRINGS } from '../lib/fretboard'
import { fretboardPoint } from '../lib/fretboardLayout'

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
  const marker = currentMarker(markers, currentTime)
  const contentHeight = Math.max(520, midi.duration * pixelsPerSecond)

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
          <div className="flow-spacer" />
          <div className="flow-content" style={{ height: contentHeight }}>
            <div className="string-guides" aria-hidden="true">
              {GUITAR_STRINGS.map((string) => (
                <div key={string.name} style={{ left: `${6 + string.index * 17.6}%` }}>
                  {string.name}
                </div>
              ))}
            </div>
            {markers
              .filter((event) => event.type === 'marker')
              .map((event) => (
                <div
                  key={`${event.tick}-${event.text}`}
                  className="falling-chord"
                  style={{ top: timelineTop(midi, event.time, pixelsPerSecond) }}
                >
                  {event.text}
                </div>
              ))}
            {notes.map((note) => {
              const placement = placements.get(note.id)
              if (!placement) return null
              const point = fretboardPoint(placement)
              const string = GUITAR_STRINGS[placement.stringIndex]
              const x = (point.x / 1080) * 100
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
          <div className="flow-spacer" />
        </div>
        <div className="flow-center-playhead" aria-hidden="true" />
      </div>
    </section>
  )
}
