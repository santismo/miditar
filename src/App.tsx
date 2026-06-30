import { useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import {
  Download,
  FileMusic,
  FolderOpen,
  Gauge,
  Guitar,
  ListMusic,
  Pause,
  Play,
  SkipBack,
  Square,
  Upload,
} from 'lucide-react'
import './App.css'
import { FlowView } from './components/FlowView'
import { SheetView } from './components/SheetView'
import { GUITAR_STRINGS, mapNotesToFretboard } from './lib/fretboard'
import {
  createDemoMidi,
  exportGuitarMappedMidi,
  noteName,
  parseMidiFile,
  type MidiTrack,
  type ParsedMidi,
} from './lib/midi'

type ViewMode = 'flow' | 'sheet'

function chooseDefaultTrack(song: ParsedMidi) {
  const tracks = song.tracks.filter((track) => track.notes.length)
  const guitar = tracks.find((track) => /guitar/i.test(track.name))
  const melody = tracks.find((track) => /melody/i.test(track.name))
  const fallback = [...tracks].sort((a, b) => b.notes.length - a.notes.length)[0]
  return guitar?.index ?? melody?.index ?? fallback?.index ?? song.tracks[0]?.index ?? 0
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const wholeSeconds = Math.floor(seconds % 60)
  return `${minutes}:${String(wholeSeconds).padStart(2, '0')}`
}

function safeFileName(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '') || 'miditar'
}

function trackLabel(track: MidiTrack) {
  const channelText = track.channels.length ? `ch ${track.channels.join(', ')}` : 'no channel'
  return `${track.name || `Track ${track.index + 1}`} - ${track.notes.length} notes - ${channelText}`
}

function App() {
  const [songs, setSongs] = useState<ParsedMidi[]>([createDemoMidi()])
  const [songIndex, setSongIndex] = useState(0)
  const [selectedTrackIndex, setSelectedTrackIndex] = useState(1)
  const [viewMode, setViewMode] = useState<ViewMode>('flow')
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const synthRef = useRef<Tone.PolySynth | null>(null)
  const playOffsetRef = useRef(0)
  const rafRef = useRef<number | null>(null)

  const song = songs[songIndex] ?? songs[0]
  const selectedTrack =
    song.tracks.find((track) => track.index === selectedTrackIndex) ??
    song.tracks.find((track) => track.notes.length) ??
    song.tracks[0]
  const notePlacements = useMemo(
    () => mapNotesToFretboard(selectedTrack?.notes ?? []),
    [selectedTrack],
  )
  const mappedCount = selectedTrack?.notes.filter((note) => notePlacements.has(note.id)).length ?? 0
  const currentNote = selectedTrack?.notes.find(
    (note) => note.time <= currentTime && note.time + note.duration >= currentTime,
  )

  useEffect(() => {
    if (!song) return
    setSelectedTrackIndex(chooseDefaultTrack(song))
    setCurrentTime(0)
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
      const transport = Tone.getTransport()
      const nextTime = Math.min(song.duration, playOffsetRef.current + transport.seconds * speed)
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
      synthRef.current.volume.value = -8
    }
    return synthRef.current
  }

  function playFrom(time = currentTime) {
    if (!selectedTrack) return
    void Tone.start()
    const synth = getSynth()
    const transport = Tone.getTransport()
    transport.stop()
    transport.cancel(0)
    transport.seconds = 0
    playOffsetRef.current = time

    for (const note of selectedTrack.notes) {
      if (note.time + note.duration < time) continue
      const start = Math.max(0, (note.time - time) / speed)
      const duration = Math.max(0.03, note.duration / speed)
      transport.schedule((scheduledTime) => {
        synth.triggerAttackRelease(noteName(note.midi), duration, scheduledTime, note.velocity)
      }, start)
    }

    transport.start('+0.03')
    setIsPlaying(true)
  }

  function pausePlayback() {
    const transport = Tone.getTransport()
    const nextTime = Math.min(song.duration, playOffsetRef.current + transport.seconds * speed)
    transport.pause()
    setCurrentTime(nextTime)
    setIsPlaying(false)
  }

  function stopPlayback() {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    const transport = Tone.getTransport()
    transport.stop()
    transport.cancel(0)
    transport.seconds = 0
    setIsPlaying(false)
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
      setSelectedTrackIndex(chooseDefaultTrack(parsed[0]))
      setCurrentTime(0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load MIDI file.')
    }
  }

  function exportMappedMidi() {
    if (!selectedTrack) return
    const bytes = exportGuitarMappedMidi(song, selectedTrack, notePlacements)
    const blob = new Blob([bytes], { type: 'audio/midi' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${safeFileName(song.title)}_${safeFileName(selectedTrack.name || 'track')}_miditar.mid`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    loadFiles(event.dataTransfer.files)
  }

  return (
    <div
      className="app-shell"
      onDrop={handleDrop}
      onDragOver={(event) => event.preventDefault()}
    >
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">
            <Guitar size={24} strokeWidth={2.2} />
          </div>
          <div>
            <h1>Miditar</h1>
            <p>MIDI to fretboard trainer</p>
          </div>
        </div>
        <div className="header-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".mid,.midi,audio/midi"
            multiple
            onChange={(event) => event.target.files && loadFiles(event.target.files)}
          />
          <button type="button" className="button secondary" onClick={() => fileInputRef.current?.click()}>
            <FolderOpen size={18} />
            Open
          </button>
          <button type="button" className="button secondary" onClick={exportMappedMidi} disabled={!mappedCount}>
            <Download size={18} />
            Export
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="library-panel">
          <div className="panel-title">
            <ListMusic size={18} />
            Songs
          </div>
          <div className="song-list">
            {songs.map((item, index) => (
              <button
                key={`${item.fileName}-${index}`}
                type="button"
                className={index === songIndex ? 'is-selected' : ''}
                onClick={() => setSongIndex(index)}
              >
                <FileMusic size={16} />
                <span>{item.title}</span>
              </button>
            ))}
          </div>
          <label className="field">
            <span>Track</span>
            <select
              value={selectedTrack?.index ?? 0}
              onChange={(event) => {
                stopPlayback()
                setSelectedTrackIndex(Number(event.target.value))
                setCurrentTime(0)
              }}
            >
              {song.tracks
                .filter((track) => track.notes.length)
                .map((track) => (
                  <option key={track.index} value={track.index}>
                    {trackLabel(track)}
                  </option>
                ))}
            </select>
          </label>
          <div className="mapping-status">
            <strong>{mappedCount}</strong>
            <span>of {selectedTrack?.notes.length ?? 0} notes mapped</span>
          </div>
          <div className="string-map">
            {GUITAR_STRINGS.map((string) => (
              <div key={string.name}>
                <i style={{ background: string.color }} />
                <span>{string.name}</span>
                <b>ch {string.channel}</b>
              </div>
            ))}
          </div>
          {error && <div className="error-text">{error}</div>}
        </aside>

        <section className="main-stage">
          <div className="mode-tabs" role="tablist" aria-label="View mode">
            <button
              type="button"
              className={viewMode === 'flow' ? 'is-active' : ''}
              onClick={() => setViewMode('flow')}
            >
              <Guitar size={17} />
              Fretboard
            </button>
            <button
              type="button"
              className={viewMode === 'sheet' ? 'is-active' : ''}
              onClick={() => setViewMode('sheet')}
            >
              <ListMusic size={17} />
              Sheet
            </button>
          </div>
          {viewMode === 'flow' ? (
            <FlowView
              notes={selectedTrack?.notes ?? []}
              markers={song.markers}
              placements={notePlacements}
              currentTime={currentTime}
              duration={song.duration}
            />
          ) : (
            <SheetView
              midi={song}
              notes={selectedTrack?.notes ?? []}
              markers={song.markers}
              currentTime={currentTime}
            />
          )}
        </section>
      </main>

      <footer className="transport-bar">
        <div className="transport-buttons">
          <button
            type="button"
            className="icon-button"
            aria-label="Restart"
            onClick={() => {
              stopPlayback()
              setCurrentTime(0)
            }}
          >
            <SkipBack size={21} />
          </button>
          <button
            type="button"
            className="play-button"
            aria-label={isPlaying ? 'Pause' : 'Play'}
            onClick={() => (isPlaying ? pausePlayback() : playFrom())}
          >
            {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Stop"
            onClick={() => {
              stopPlayback()
              setCurrentTime(0)
            }}
          >
            <Square size={19} fill="currentColor" />
          </button>
        </div>
        <label className="range-field timeline-range">
          <span>{formatTime(currentTime)}</span>
          <input
            type="range"
            min="0"
            max={song.duration || 1}
            step="0.01"
            value={Math.min(currentTime, song.duration)}
            onChange={(event) => {
              stopPlayback()
              setCurrentTime(Number(event.target.value))
            }}
          />
          <span>{formatTime(song.duration)}</span>
        </label>
        <label className="range-field speed-field">
          <Gauge size={18} />
          <input
            type="range"
            min="0.35"
            max="1.5"
            step="0.05"
            value={speed}
            onChange={(event) => {
              const nextSpeed = Number(event.target.value)
              const wasPlaying = isPlaying
              if (wasPlaying) pausePlayback()
              setSpeed(nextSpeed)
            }}
          />
          <span>{speed.toFixed(2)}x</span>
        </label>
        <div className="now-playing">
          {currentNote ? noteName(currentNote.midi) : selectedTrack?.name || 'No track'}
        </div>
        <button type="button" className="button upload-compact" onClick={() => fileInputRef.current?.click()}>
          <Upload size={18} />
        </button>
      </footer>
    </div>
  )
}

export default App
