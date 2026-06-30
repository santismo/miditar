import { type DragEvent, useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import { Download, FileMusic, FolderOpen, Guitar, Palette, Pause, Play, Settings, X } from 'lucide-react'
import './App.css'
import { FlowView } from './components/FlowView'
import { Fretboard } from './components/Fretboard'
import { SheetView } from './components/SheetView'
import { FRETBOARD_THEMES, type FretboardThemeId } from './components/fretboardThemes'
import { mapNotesToFretboard } from './lib/fretboard'
import {
  createDemoMidi,
  exportGuitarMappedMidi,
  noteName,
  parseMidiFile,
  type MidiNote,
  type MidiTrack,
  type ParsedMidi,
} from './lib/midi'

const TRACK_COLORS = ['#f05d51', '#48b6ff', '#f2c14e', '#7bd88f']
const DEMO_SONG = createDemoMidi()
const MAX_SCRUB_AUDITION_NOTES = 12

function playableTracks(song: ParsedMidi) {
  return song.tracks.filter((track) => track.notes.length)
}

function chooseDefaultTracks(song: ParsedMidi): [number, number | null] {
  const tracks = playableTracks(song)
  const piano = tracks.find((track) => /piano|keys|keyboard|rhodes|wurl/i.test(track.name))
  const melody = tracks.find((track) => /melody|melodie|lead|solo/i.test(track.name))
  const guitar = tracks.find((track) => /guitar/i.test(track.name))
  const fallback = [...tracks].sort((a, b) => b.notes.length - a.notes.length)
  const first = piano?.index ?? melody?.index ?? guitar?.index ?? fallback[0]?.index ?? song.tracks[0]?.index ?? 0
  const second =
    melody && melody.index !== first
      ? melody.index
      : piano && piano.index !== first
        ? piano.index
        : fallback.find((track) => track.index !== first)?.index ?? null
  return [first, second]
}

function safeFileName(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '') || 'miditar'
}

function trackLabel(track: MidiTrack) {
  const channelText = track.channels.length ? `ch ${track.channels.join(', ')}` : 'no channel'
  return `${track.name || `Track ${track.index + 1}`} - ${track.notes.length} notes - ${channelText}`
}

function currentMarkerText(song: ParsedMidi, currentTime: number) {
  let active = ''
  for (const marker of song.markers) {
    if (marker.type !== 'marker') continue
    if (marker.time <= currentTime + 0.02) active = marker.text
    else break
  }
  return active
}

function clampTime(time: number, song: ParsedMidi) {
  return Math.min(song.duration, Math.max(0, time))
}

function App() {
  const [songs, setSongs] = useState<ParsedMidi[]>([DEMO_SONG])
  const [songIndex, setSongIndex] = useState(0)
  const [selectedTrackIndexes, setSelectedTrackIndexes] = useState<[number, number | null]>(() =>
    chooseDefaultTracks(DEMO_SONG),
  )
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [fretboardTheme, setFretboardTheme] = useState<FretboardThemeId>('dark')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const synthRef = useRef<Tone.PolySynth | null>(null)
  const playOffsetRef = useRef(0)
  const playStartedAtRef = useRef(0)
  const playbackRunRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const lastAuditionKeyRef = useRef('')
  const lastAuditionAtRef = useRef(0)
  const lastScrubTimeRef = useRef(0)

  const song = songs[songIndex] ?? songs[0]
  const tracks = playableTracks(song)
  const selectedTracks = useMemo(
    () =>
      selectedTrackIndexes
        .map((trackIndex) =>
          trackIndex === null ? null : song.tracks.find((track) => track.index === trackIndex),
        )
        .filter((track): track is MidiTrack => Boolean(track)),
    [selectedTrackIndexes, song],
  )
  const combinedNotes = useMemo(
    () =>
      selectedTracks
        .flatMap((track) => track.notes)
        .sort((a, b) => a.tick - b.tick || a.trackIndex - b.trackIndex || a.midi - b.midi),
    [selectedTracks],
  )
  const virtualTrack: MidiTrack | null = selectedTracks.length
    ? {
        index: -1,
        name: selectedTracks.map((track) => track.name || `Track ${track.index + 1}`).join(' + '),
        notes: combinedNotes,
        channels: [...new Set(selectedTracks.flatMap((track) => track.channels))],
        programs: {},
      }
    : null
  const trackColors = useMemo(() => {
    const colors: Record<number, string> = {}
    selectedTracks.forEach((track, index) => {
      colors[track.index] = TRACK_COLORS[index % TRACK_COLORS.length]
    })
    return colors
  }, [selectedTracks])
  const notePlacements = useMemo(() => mapNotesToFretboard(combinedNotes), [combinedNotes])
  const currentChord = currentMarkerText(song, currentTime)

  useEffect(() => {
    if (!song) return
    setSelectedTrackIndexes(chooseDefaultTracks(song))
    setCurrentTime(0)
    lastAuditionKeyRef.current = ''
    lastScrubTimeRef.current = 0
    stopPlayback()
  }, [songIndex, song])

  useEffect(() => {
    return () => {
      stopPlayback()
      synthRef.current?.dispose()
    }
  }, [])

  useEffect(() => {
    if (!isPlaying) return

    const tick = () => {
      const elapsed = (performance.now() - playStartedAtRef.current) / 1000
      const nextTime = Math.min(song.duration, playOffsetRef.current + elapsed * speed)
      setCurrentTime(nextTime)
      if (nextTime >= song.duration) {
        stopPlayback()
        setCurrentTime(song.duration)
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [isPlaying, song.duration, speed])

  function getSynth() {
    if (!synthRef.current) {
      synthRef.current = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.01, decay: 0.08, sustain: 0.42, release: 0.18 },
      }).toDestination()
      synthRef.current.volume.value = -9
    }
    return synthRef.current
  }

  async function playFrom(time = currentTime) {
    if (!combinedNotes.length) return
    const runId = playbackRunRef.current + 1
    playbackRunRef.current = runId
    const startTime = clampTime(time, song)
    playOffsetRef.current = startTime
    playStartedAtRef.current = performance.now()
    lastScrubTimeRef.current = startTime
    setCurrentTime(startTime)
    setIsPlaying(true)
    setError('')

    try {
      await Tone.start()
      if (playbackRunRef.current !== runId) return
      const synth = getSynth()
      const transport = Tone.getTransport()
      const audioStartTime = clampTime(
        startTime + ((performance.now() - playStartedAtRef.current) / 1000) * speed,
        song,
      )
      transport.stop()
      transport.cancel(0)
      transport.seconds = 0
      playOffsetRef.current = audioStartTime
      playStartedAtRef.current = performance.now()
      lastScrubTimeRef.current = audioStartTime
      setCurrentTime(audioStartTime)

      for (const note of combinedNotes) {
        if (note.time + note.duration < audioStartTime) continue
        const start = Math.max(0, (note.time - audioStartTime) / speed)
        const duration = Math.max(0.03, note.duration / speed)
        transport.schedule((scheduledTime) => {
          synth.triggerAttackRelease(noteName(note.midi), duration, scheduledTime, note.velocity * 0.78)
        }, start)
      }

      transport.start('+0.03')
    } catch (err) {
      if (playbackRunRef.current === runId) {
        stopPlayback()
        setError(err instanceof Error ? err.message : 'Could not start playback.')
      }
    }
  }

  function pausePlayback() {
    playbackRunRef.current += 1
    const transport = Tone.getTransport()
    const elapsed = (performance.now() - playStartedAtRef.current) / 1000
    const nextTime = clampTime(playOffsetRef.current + elapsed * speed, song)
    transport.pause()
    lastScrubTimeRef.current = nextTime
    setCurrentTime(nextTime)
    setIsPlaying(false)
  }

  function stopPlayback() {
    playbackRunRef.current += 1
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    const transport = Tone.getTransport()
    transport.stop()
    transport.cancel(0)
    transport.seconds = 0
    playStartedAtRef.current = 0
    setIsPlaying(false)
  }

  function auditionDuration(note: MidiNote) {
    return Math.min(3, Math.max(0.08, note.duration))
  }

  function auditionNotes(notes: MidiNote[], keySuffix: string) {
    const now = performance.now()
    if (now - lastAuditionAtRef.current < 25) return

    const key = `${keySuffix}:${notes.map((note) => note.id).join('|')}`
    if (!key || key === lastAuditionKeyRef.current) return

    lastAuditionKeyRef.current = key
    lastAuditionAtRef.current = now
    void Tone.start().then(() => {
      const synth = getSynth()
      const start = Tone.now()
      notes.forEach((note, index) => {
        synth.triggerAttackRelease(
          noteName(note.midi),
          auditionDuration(note),
          start + index * 0.004,
          Math.max(0.18, note.velocity * 0.66),
        )
      })
    })
  }

  function auditionAt(previousTime: number, nextTime: number) {
    const low = Math.min(previousTime, nextTime) - 0.012
    const high = Math.max(previousTime, nextTime) + 0.012
    const crossedNotes = combinedNotes
      .filter((note) => note.time >= low && note.time <= high)
      .sort((a, b) => Math.abs(a.time - nextTime) - Math.abs(b.time - nextTime) || a.midi - b.midi)
      .slice(0, MAX_SCRUB_AUDITION_NOTES)
      .sort((a, b) => a.time - b.time || a.midi - b.midi)

    if (crossedNotes.length) {
      auditionNotes(crossedNotes, previousTime <= nextTime ? 'crossed-forward' : 'crossed-back')
      return
    }

    const activeNotes = combinedNotes
      .filter((note) => note.time <= nextTime + 0.035 && note.time + note.duration >= nextTime - 0.035)
      .slice(0, MAX_SCRUB_AUDITION_NOTES)
    if (activeNotes.length) auditionNotes(activeNotes, 'active')
  }

  function scrubTo(time: number) {
    if (isPlaying) stopPlayback()
    const previousTime = lastScrubTimeRef.current
    const nextTime = clampTime(time, song)
    playOffsetRef.current = nextTime
    lastScrubTimeRef.current = nextTime
    setCurrentTime(nextTime)
    auditionAt(previousTime, nextTime)
  }

  async function loadFiles(fileList: FileList | File[]) {
    const files = [...fileList].filter((file) => /\.(mid|midi)$/i.test(file.name))
    if (!files.length) return

    try {
      stopPlayback()
      setError('')
      const parsed = await Promise.all(
        files.map(async (file) => parseMidiFile(await file.arrayBuffer(), file.name)),
      )
      setSongs(parsed)
      setSongIndex(0)
      setSelectedTrackIndexes(chooseDefaultTracks(parsed[0]))
      setCurrentTime(0)
      setSettingsOpen(false)
      lastAuditionKeyRef.current = ''
      lastScrubTimeRef.current = 0
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load MIDI file.')
    }
  }

  function updateTrackSlot(slot: 0 | 1, value: string) {
    stopPlayback()
    setCurrentTime(0)
    lastAuditionKeyRef.current = ''
    lastScrubTimeRef.current = 0
    setSelectedTrackIndexes((current) => {
      const next: [number, number | null] = [...current]
      if (slot === 0) next[0] = value === 'none' ? current[0] : Number(value)
      else next[1] = value === 'none' ? null : Number(value)
      return next
    })
  }

  function exportMappedMidi() {
    if (!virtualTrack) return
    const bytes = exportGuitarMappedMidi(song, virtualTrack, notePlacements)
    const blob = new Blob([bytes], { type: 'audio/midi' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${safeFileName(song.title)}_${safeFileName(virtualTrack.name || 'tracks')}_miditar.mid`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function chooseSong(index: number) {
    stopPlayback()
    setSongIndex(index)
    setCurrentTime(0)
    lastAuditionKeyRef.current = ''
    lastScrubTimeRef.current = 0
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    loadFiles(event.dataTransfer.files)
  }

  return (
    <div className="app-shell" onDrop={handleDrop} onDragOver={(event) => event.preventDefault()}>
      <header className="app-header">
        <div className="brand" aria-label="Miditar">
          <div className="brand-mark">
            <Guitar size={23} strokeWidth={2.2} />
          </div>
          <h1>Miditar</h1>
        </div>

        <div className="song-heading">
          <strong>{song.title}</strong>
          {currentChord && <span>{currentChord}</span>}
        </div>

        <div className="header-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".mid,.midi,audio/midi"
            multiple
            onChange={(event) => event.target.files && loadFiles(event.target.files)}
          />
          <button
            type="button"
            className="play-button"
            aria-label={isPlaying ? 'Pause' : 'Play'}
            onClick={() => (isPlaying ? pausePlayback() : void playFrom())}
          >
            {isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Settings"
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <Settings size={21} />
          </button>
        </div>
      </header>

      {settingsOpen && (
        <div className="settings-layer">
          <button
            type="button"
            className="settings-backdrop"
            aria-label="Close settings"
            onClick={() => setSettingsOpen(false)}
          />
          <aside className="settings-panel" aria-label="Settings">
            <div className="settings-title">
              <strong>Settings</strong>
              <button type="button" className="icon-button" aria-label="Close settings" onClick={() => setSettingsOpen(false)}>
                <X size={19} />
              </button>
            </div>

            <button type="button" className="button primary" onClick={() => fileInputRef.current?.click()}>
              <FolderOpen size={18} />
              Open MIDI
            </button>

            <button type="button" className="button secondary" onClick={exportMappedMidi} disabled={!virtualTrack}>
              <Download size={18} />
              Export Guitar MIDI
            </button>

            {songs.length > 1 && (
              <label className="field">
                <span>
                  <FileMusic size={15} />
                  Song
                </span>
                <select value={songIndex} onChange={(event) => chooseSong(Number(event.target.value))}>
                  {songs.map((item, index) => (
                    <option key={`${item.fileName}-${index}`} value={index}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="track-grid">
              {[0, 1].map((slot) => {
                const selectedIndex = selectedTrackIndexes[slot as 0 | 1]
                return (
                  <label className="field" key={slot}>
                    <span>
                      <i className="track-dot" style={{ background: TRACK_COLORS[slot] }} />
                      {slot === 0 ? 'Primary Track' : 'Secondary Track'}
                    </span>
                    <select
                      value={selectedIndex ?? 'none'}
                      onChange={(event) => updateTrackSlot(slot as 0 | 1, event.target.value)}
                    >
                      {slot === 1 && <option value="none">None</option>}
                      {tracks.map((track) => (
                        <option key={track.index} value={track.index}>
                          {trackLabel(track)}
                        </option>
                      ))}
                    </select>
                  </label>
                )
              })}
            </div>

            <label className="range-field">
              <span>Playback Speed</span>
              <input
                type="range"
                min="0.35"
                max="1.5"
                step="0.05"
                value={speed}
                onChange={(event) => {
                  const nextSpeed = Number(event.target.value)
                  if (isPlaying) pausePlayback()
                  setSpeed(nextSpeed)
                }}
              />
              <b>{speed.toFixed(2)}x</b>
            </label>

            <label className="field">
              <span>
                <Palette size={15} />
                Fretboard Theme
              </span>
              <select
                value={fretboardTheme}
                onChange={(event) => setFretboardTheme(event.target.value as FretboardThemeId)}
              >
                {FRETBOARD_THEMES.map((theme) => (
                  <option key={theme.id} value={theme.id}>
                    {theme.label}
                  </option>
                ))}
              </select>
            </label>

            {error && <div className="error-text">{error}</div>}
          </aside>
        </div>
      )}

      <main className="main-stage">
        <SheetView
          midi={song}
          notes={combinedNotes}
          markers={song.markers}
          currentTime={currentTime}
          isPlaying={isPlaying}
          onScrub={scrubTo}
          trackColors={trackColors}
        />
        <FlowView
          midi={song}
          notes={combinedNotes}
          markers={song.markers}
          placements={notePlacements}
          currentTime={currentTime}
          isPlaying={isPlaying}
          onScrub={scrubTo}
          trackColors={trackColors}
        />
        <section className="neck-panel" data-neck-theme={fretboardTheme} aria-label="Live guitar neck">
          <Fretboard
            notes={combinedNotes}
            placements={notePlacements}
            currentTime={currentTime}
            trackColors={trackColors}
            themeId={fretboardTheme}
          />
        </section>
      </main>
    </div>
  )
}

export default App
