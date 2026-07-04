import { type PointerEvent, type ReactNode, useEffect, useMemo, useRef } from 'react'
import type { MidiMarker, MidiNote, MidiPlacement, ParsedMidi } from '../lib/midi'
import { activeMarkerAtTick, midiTicksToSeconds, noteName, secondsToTicks } from '../lib/midi'
import { GUITAR_STRINGS } from '../lib/fretboard'
import { dedupeNotesByStartPitch } from '../lib/displayNotes'
import {
  FRETBOARD_LEFT,
  FRETBOARD_VIEW_WIDTH,
  fretLineX,
} from '../lib/fretboardLayout'
import { FULL_PIANO_RANGE, pianoKeysForRange, pianoKeySlot, type PianoRange } from '../lib/pianoLayout'
import { NoteGlyph } from './NoteGlyph'

type FlowViewMode = 'guitar' | 'piano'

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
  viewMode?: FlowViewMode
  pianoRange?: PianoRange
  melodyTrackIndexes?: Set<number>
}

type LaneSplit = {
  index: number
  count: number
}

const DEFAULT_PIXELS_PER_SECOND = 168

function timelineTop(midi: ParsedMidi, time: number, pixelsPerSecond: number) {
  return Math.max(0, midi.duration - time) * pixelsPerSecond
}

function getMeasureTicks(midi: ParsedMidi) {
  const signature = midi.timeSignatures[0]
  if (!signature) return midi.ppq * 4
  return midi.ppq * 4 * (signature.numerator / signature.denominator)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
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

function pitchClassLabel(midi: number) {
  return noteName(midi).replace(/-?\d+$/, '')
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
  viewMode = 'guitar',
  pianoRange = FULL_PIANO_RANGE,
  melodyTrackIndexes = new Set(),
}: FlowViewProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const programmaticScrollUntilRef = useRef(0)
  const userScrollRef = useRef(false)
  const userScrollTimerRef = useRef<number | null>(null)
  const timelineScrubbingRef = useRef(false)
  const currentTick = secondsToTicks(midi, currentTime)
  const marker = activeMarkerAtTick(markers, currentTick)
  const contentHeight = Math.max(520, midi.duration * pixelsPerSecond)
  const maxFret = 22
  const pianoKeys = useMemo(() => pianoKeysForRange(pianoRange), [pianoRange])
  const displayNotes = useMemo(
    () => dedupeNotesByStartPitch(notes, melodyTrackIndexes),
    [melodyTrackIndexes, notes],
  )
  const timelinePercent = midi.duration ? clamp(currentTime / midi.duration, 0, 1) * 100 : 0
  const measureTicks = getMeasureTicks(midi)
  const guitarLaneSplits = useMemo(() => {
    const groups = new Map<string, MidiNote[]>()
    for (const note of displayNotes) {
      const placement = placements.get(note.id)
      if (!placement) continue
      const key = `${note.tick}:${placement.fret}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(note)
    }

    const splits = new Map<string, LaneSplit>()
    for (const group of groups.values()) {
      if (group.length <= 1) continue
      const sorted = [...group].sort((a, b) => {
        const aPlacement = placements.get(a.id)!
        const bPlacement = placements.get(b.id)!
        return bPlacement.stringIndex - aPlacement.stringIndex || a.midi - b.midi
      })
      sorted.forEach((note, index) => {
        splits.set(note.id, { index, count: sorted.length })
      })
    }
    return splits
  }, [displayNotes, placements])
  const notesNearTick = useMemo(() => {
    const tolerance = Math.max(1, measureTicks / 64)
    return (tick: number) =>
      displayNotes.some((note) => note.tick <= tick + tolerance && note.endTick >= tick - tolerance)
  }, [displayNotes, measureTicks])
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
        marker: activeMarkerAtTick(markers, startTick),
        hasNotesAtLine: notesNearTick(startTick),
      }
    })
  }, [markers, measureTicks, midi, notesNearTick, pixelsPerSecond])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const targetTop = timelineTop(midi, currentTime, pixelsPerSecond)
    const delta = targetTop - container.scrollTop
    if (Math.abs(delta) < 0.5) return
    programmaticScrollUntilRef.current = performance.now() + 220
    container.scrollTop = Math.max(0, targetTop)
  }, [currentTime, isPlaying, midi, pixelsPerSecond])

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
            {viewMode === 'piano' ? (
              <div className="piano-guides" aria-hidden="true">
                {pianoKeys.map((key) => (
                  <div
                    key={key.midi}
                    className={key.isBlack ? 'is-black' : 'is-white'}
                    style={{ left: `${key.left}%`, width: `${key.width}%` }}
                  >
                    {key.label}
                  </div>
                ))}
              </div>
            ) : (
              <div className="fret-guides" aria-hidden="true">
                {Array.from({ length: maxFret + 1 }).map((_, fret) => (
                  <div key={fret} style={{ left: `${(fretLineX(fret, maxFret) / FRETBOARD_VIEW_WIDTH) * 100}%` }}>
                    {fret > 0 && [3, 5, 7, 9, 12, 15, 17].includes(fret) ? fret : ''}
                  </div>
                ))}
              </div>
            )}
            {measureMarkers.map((measure) => (
              <div
                key={`line-${measure.index}`}
                className={`falling-barline ${measure.hasNotesAtLine ? 'has-midi-overlap' : ''}`}
                style={{ top: measure.lineTop }}
              >
                <span>{measure.index + 1}</span>
                {measure.marker && <strong>{measure.marker.text}</strong>}
              </div>
            ))}
            {markers
              .filter((event) => event.type === 'marker' && !isNearMeasureStart(event.tick, measureTicks))
              .map((event) => (
                <div
                  key={`${event.tick}-${event.text}`}
                  className={`falling-mid-chord ${notesNearTick(event.tick) ? 'has-midi-overlap' : ''}`}
                  style={{ top: timelineTop(midi, event.time, pixelsPerSecond) }}
                >
                  <span>{measureNumberForTick(event.tick, measureTicks)}</span>
                  <strong>{event.text}</strong>
                </div>
              ))}
            {displayNotes.map((note) => {
              const trackColor = trackColors[note.trackIndex]
              let x = 0
              let width = 0
              let borderColor = trackColor ?? '#f0c65a'
              let background = `linear-gradient(180deg, ${trackColor ?? '#f0c65a'}, rgba(255,255,255,.12))`
              let title = `${note.trackName}: ${noteName(note.midi)}`
              let label: ReactNode = <NoteGlyph name={pitchClassLabel(note.midi)} />
              let keyKind = 'white'

              if (viewMode === 'piano') {
                const slot = pianoKeySlot(note.midi, pianoRange)
                x = slot.left
                width = slot.width
                keyKind = slot.isBlack ? 'black' : 'white'
              } else {
                const placement = placements.get(note.id)
                if (!placement) return null
                const string = GUITAR_STRINGS[placement.stringIndex]
                const slot = fretSlot(placement, maxFret)
                const split = guitarLaneSplits.get(note.id)
                const splitLeft = split ? slot.left + (slot.width * split.index) / split.count : slot.left
                const splitWidth = split ? slot.width / split.count : slot.width
                x = (splitLeft / FRETBOARD_VIEW_WIDTH) * 100
                width = Math.max(0.42, (splitWidth / FRETBOARD_VIEW_WIDTH) * 100)
                borderColor = string.color
                background = `linear-gradient(180deg, ${string.color}, rgba(255,255,255,.12))`
                const displayMidi = placement.midi ?? note.midi
                title = `${note.trackName}: ${noteName(displayMidi)} on ${string.name} fret ${placement.fret}`
                label = String(placement.fret)
              }

              const y = timelineTop(midi, note.time, pixelsPerSecond)
              const height = Math.max(16, note.duration * pixelsPerSecond)
              const active = note.time <= currentTime && note.time + note.duration >= currentTime

              return (
                <div
                  key={note.id}
                  className={`falling-note ${viewMode === 'piano' ? 'is-piano' : 'is-guitar'} ${active ? 'is-active' : ''}`}
                  data-key-kind={keyKind}
                  style={{
                    left: `${x}%`,
                    width: viewMode === 'piano' ? `${width}%` : `max(8px, ${width}%)`,
                    top: y,
                    height,
                    borderColor,
                    background,
                  }}
                  title={title}
                >
                  <span className="note-label">{label}</span>
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
