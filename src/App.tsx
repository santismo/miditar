import { type CSSProperties, type DragEvent, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import { Dices, Download, FileMusic, FolderOpen, Guitar, Palette, Pause, Play, Settings, X } from 'lucide-react'
import './App.css'
import { FlowView } from './components/FlowView'
import { Fretboard } from './components/Fretboard'
import { PianoView } from './components/PianoView'
import { SheetView } from './components/SheetView'
import { TabView } from './components/TabView'
import { FRETBOARD_THEMES, type FretboardThemeId } from './components/fretboardThemes'
import {
  loadExampleSong,
  loadExampleSongs,
  type ExampleSongEntry,
} from './lib/exampleSongs'
import { mapNotesToFretboard } from './lib/fretboard'
import {
  createDemoMidi,
  activeMarkerAtTime,
  exportGuitarMappedMidi,
  midiTicksToSeconds,
  noteName,
  parseMidiFile,
  secondsToTicks,
  type MidiNote,
  type MidiTrack,
  type ParsedMidi,
} from './lib/midi'
import { loadRecentMidiState, saveRecentMidiState, type RecentMidiFile } from './lib/recentMidiStore'
import { pianoRangeForNotes } from './lib/pianoLayout'
import {
  DEFAULT_STRING_CHANNEL_MAP,
  STRING_CHANNEL_PRESETS,
  STRING_CHANNEL_STRINGS,
  clampMidiChannel,
  normalizeStringChannelMap,
  presetById,
  type StringChannelMap,
  type StringChannelPresetId,
} from './lib/stringChannels'
import {
  isSampleInstrument,
  playbackInstrumentLabel,
  PLAYBACK_INSTRUMENTS,
  SamplePlaybackEngine,
  type PlaybackInstrumentId,
} from './lib/sampleEngine'

const TRACK_COLORS = ['#f05d51', '#48b6ff', '#f2c14e', '#7bd88f']
const DEMO_SONG = createDemoMidi()
const MAX_SCRUB_AUDITION_NOTES = 12
const DEFAULT_FLOW_DENSITY = 168
const MIN_FLOW_DENSITY = 88
const MAX_FLOW_DENSITY = 320
const FLOW_DENSITY_STEP = 12
const MIN_TEMPO_BPM = 40
const MAX_TEMPO_BPM = 240
const TEMPO_STEP = 1
const DEFAULT_INSTRUMENT_HEIGHT = 16
const DESKTOP_DEFAULT_INSTRUMENT_HEIGHT = 22
const MIN_INSTRUMENT_HEIGHT = 12
const MAX_INSTRUMENT_HEIGHT = 30

type TrackSelection = [number | null, number | null, number | null]
type TrackSlot = 0 | 1 | 2
type ActiveAudioEngine =
  | { kind: 'synth'; synth: Tone.PolySynth }
  | { kind: 'sample'; engine: SamplePlaybackEngine; instrumentId: Exclude<PlaybackInstrumentId, 'synth'> }
type ScrubVoice = { kind: 'synth'; pitch: string } | { kind: 'sample' }
type InstrumentViewMode = 'guitar' | 'piano'
type NotationViewMode = 'tab' | 'sheet'
type GuitarNeckDisplayMode = 'flat' | 'rocksmith'
type AppVariant = 'mobile' | 'desktop'
type AppProps = {
  variant?: AppVariant
  desktopSizing?: boolean
}
type ShortcutActions = {
  togglePlayback: () => void
  jumpByMeasure: (direction: -1 | 1) => void
}
const TRACK_SLOT_LABELS = ['Primary Track', 'Secondary Track', 'Bass Track']
const BUILT_IN_DEMO_EXAMPLE = '__demo__'
const GUITAR_INSTRUMENTS = new Set<PlaybackInstrumentId>([
  'sample:guitar-acoustic',
  'sample:guitar-nylon',
  'sample:guitar-electric',
  'sample:bass-electric',
  'synth',
])
const PIANO_INSTRUMENTS = new Set<PlaybackInstrumentId>(['sample:piano', 'synth'])
const SMART_MELODY_SLOT_LABELS = ['Track 1 (Primary)', 'Track 2 (Secondary)', 'Track 3 (Bass)']
const RocksmithNeckView = lazy(() =>
  import('./components/RocksmithNeckView').then((module) => ({ default: module.RocksmithNeckView })),
)

function playableTracks(song: ParsedMidi) {
  return song.tracks.filter((track) => track.notes.length)
}

function chooseDefaultTracks(song: ParsedMidi): TrackSelection {
  const tracks = playableTracks(song)
  const piano = tracks.find((track) => /piano|keys|keyboard|rhodes|wurl/i.test(track.name))
  const melody = tracks.find((track) => /melody|melodie|lead|solo/i.test(track.name))
  const guitar = tracks.find((track) => /guitar/i.test(track.name))
  const fallback = [...tracks].sort((a, b) => b.notes.length - a.notes.length)
  const first = piano?.index ?? melody?.index ?? guitar?.index ?? fallback[0]?.index ?? null
  const second =
    melody && melody.index !== first
      ? melody.index
        : piano && piano.index !== first
          ? piano.index
          : fallback.find((track) => track.index !== first)?.index ?? null
  const third = null
  return [first, second, third]
}

function safeFileName(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '') || 'miditar'
}

function trackLabel(track: MidiTrack) {
  const channelText = track.channels.length ? `ch ${track.channels.join(', ')}` : 'no channel'
  return `${track.name || `Track ${track.index + 1}`} - ${track.notes.length} notes - ${channelText}`
}

function currentMarkerText(song: ParsedMidi, currentTime: number) {
  return activeMarkerAtTime(song, currentTime)?.text ?? ''
}

function clampTime(time: number, song: ParsedMidi) {
  return Math.min(song.duration, Math.max(0, time))
}

function clampTempoBpm(value: number) {
  return Math.min(MAX_TEMPO_BPM, Math.max(MIN_TEMPO_BPM, Math.round(value)))
}

function songTempoBpm(song: ParsedMidi) {
  const firstTempo = song.tempos.find((tempo) => tempo.tick === 0) ?? song.tempos[0]
  return clampTempoBpm(firstTempo?.bpm ?? 120)
}

function measureTicksForSong(song: ParsedMidi) {
  const signature = song.timeSignatures[0]
  if (!signature) return song.ppq * 4
  return song.ppq * 4 * (signature.numerator / signature.denominator)
}

function clampFlowDensity(value: number) {
  return Math.min(MAX_FLOW_DENSITY, Math.max(MIN_FLOW_DENSITY, Math.round(value)))
}

function clampInstrumentHeight(value: number) {
  return Math.min(MAX_INSTRUMENT_HEIGHT, Math.max(MIN_INSTRUMENT_HEIGHT, Math.round(value)))
}

function instrumentsForViewMode(viewMode: InstrumentViewMode) {
  const allowed = viewMode === 'piano' ? PIANO_INSTRUMENTS : GUITAR_INSTRUMENTS
  return PLAYBACK_INSTRUMENTS.filter((instrument) => allowed.has(instrument.id))
}

function defaultInstrumentForViewMode(viewMode: InstrumentViewMode): PlaybackInstrumentId {
  return viewMode === 'piano' ? 'sample:piano' : 'sample:guitar-acoustic'
}

function shouldIgnoreKeyboardShortcut(event: KeyboardEvent) {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return true
  const target = event.target
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return Boolean(target.closest('input, textarea, select, button, [role="textbox"], [contenteditable="true"]'))
}

function App({ variant = 'mobile', desktopSizing = false }: AppProps = {}) {
  const [songs, setSongs] = useState<ParsedMidi[]>([DEMO_SONG])
  const [songIndex, setSongIndex] = useState(0)
  const [selectedTrackIndexes, setSelectedTrackIndexes] = useState<TrackSelection>(() => chooseDefaultTracks(DEMO_SONG))
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [tempoBpm, setTempoBpm] = useState(() => songTempoBpm(DEMO_SONG))
  const [instrumentViewMode, setInstrumentViewMode] = useState<InstrumentViewMode>('guitar')
  const [notationViewMode, setNotationViewMode] = useState<NotationViewMode>('tab')
  const [guitarNeckDisplayMode, setGuitarNeckDisplayMode] = useState<GuitarNeckDisplayMode>('flat')
  const [smartGuitarMode, setSmartGuitarMode] = useState(true)
  const [smartGuitarMelody, setSmartGuitarMelody] = useState(true)
  const [chordMelodyMode, setChordMelodyMode] = useState(true)
  const [smartMelodyTrackSlot, setSmartMelodyTrackSlot] = useState<TrackSlot>(1)
  const [useSourceStringChannels, setUseSourceStringChannels] = useState(false)
  const [stringChannelPreset, setStringChannelPreset] = useState<StringChannelPresetId>('miditar-11')
  const [stringChannelMap, setStringChannelMap] = useState<StringChannelMap>(DEFAULT_STRING_CHANNEL_MAP)
  const [flowDensity, setFlowDensity] = useState(DEFAULT_FLOW_DENSITY)
  const [instrumentHeight, setInstrumentHeight] = useState(() =>
    desktopSizing ? DESKTOP_DEFAULT_INSTRUMENT_HEIGHT : DEFAULT_INSTRUMENT_HEIGHT,
  )
  const [playbackInstrumentId, setPlaybackInstrumentId] =
    useState<PlaybackInstrumentId>('sample:guitar-acoustic')
  const [fretboardTheme, setFretboardTheme] = useState<FretboardThemeId>('dark')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [error, setError] = useState('')
  const [audioStatus, setAudioStatus] = useState('')
  const [exampleSongs, setExampleSongs] = useState<ExampleSongEntry[]>([])
  const [exampleLoading, setExampleLoading] = useState(false)
  const [recentMidiFiles, setRecentMidiFiles] = useState<RecentMidiFile[] | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const synthRef = useRef<Tone.PolySynth | null>(null)
  const sampleEngineRef = useRef<SamplePlaybackEngine | null>(null)
  const playOffsetRef = useRef(0)
  const playStartedAtRef = useRef(0)
  const playbackRunRef = useRef(0)
  const scrubRunRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const scrubAuditionRef = useRef<Map<string, ScrubVoice>>(new Map())
  const scrubReleaseTimerRef = useRef<number | null>(null)
  const shortcutActionsRef = useRef<ShortcutActions>({
    togglePlayback: () => undefined,
    jumpByMeasure: () => undefined,
  })

  const song = songs[songIndex] ?? songs[0]
  const sourceTempoBpm = songTempoBpm(song)
  const playbackRate = speed * (tempoBpm / sourceTempoBpm)
  const playbackInstruments = useMemo(() => instrumentsForViewMode(instrumentViewMode), [instrumentViewMode])
  const tracks = playableTracks(song)
  const selectedTracks = useMemo(() => {
    const seen = new Set<number>()
    const selected: MidiTrack[] = []
    for (const trackIndex of selectedTrackIndexes) {
      if (trackIndex === null || seen.has(trackIndex)) continue
      const track = song.tracks.find((item) => item.index === trackIndex)
      if (!track) continue
      selected.push(track)
      seen.add(track.index)
    }
    return selected
  }, [selectedTrackIndexes, song])
  const combinedNotes = useMemo(
    () =>
      selectedTracks
        .flatMap((track) => track.notes)
        .sort((a, b) => a.tick - b.tick || a.trackIndex - b.trackIndex || a.midi - b.midi),
    [selectedTracks],
  )
  const pianoRange = useMemo(() => pianoRangeForNotes(combinedNotes), [combinedNotes])
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
    selectedTrackIndexes.forEach((trackIndex, index) => {
      if (trackIndex === null || colors[trackIndex]) return
      colors[trackIndex] = TRACK_COLORS[index % TRACK_COLORS.length]
    })
    return colors
  }, [selectedTrackIndexes])
  const melodySourceSlot: TrackSlot = smartGuitarMode && smartGuitarMelody ? smartMelodyTrackSlot : 1
  const melodyTrackIndexes = useMemo(() => {
    const indexes = new Set<number>()
    const melodyTrack = selectedTrackIndexes[melodySourceSlot]
    if (melodyTrack !== null) indexes.add(melodyTrack)
    return indexes
  }, [melodySourceSlot, selectedTrackIndexes])
  const bassTrackIndexes = useMemo(() => {
    const indexes = new Set<number>()
    const bassTrack = selectedTrackIndexes[2]
    if (bassTrack !== null) indexes.add(bassTrack)
    return indexes
  }, [selectedTrackIndexes])
  const notePlacements = useMemo(
    () =>
      mapNotesToFretboard(combinedNotes, {
        smart: smartGuitarMode,
        smartMelody: smartGuitarMode && smartGuitarMelody,
        chordMelody: smartGuitarMode && smartGuitarMelody && chordMelodyMode,
        melodyTrackIndexes,
        bassTrackIndexes,
        sourceChannelMap: stringChannelMap,
        useSourceChannels: useSourceStringChannels,
      }),
    [
      bassTrackIndexes,
      combinedNotes,
      chordMelodyMode,
      melodyTrackIndexes,
      smartGuitarMelody,
      smartGuitarMode,
      stringChannelMap,
      useSourceStringChannels,
    ],
  )
  const currentChord = currentMarkerText(song, currentTime)

  useEffect(() => {
    if (!song) return
    setSelectedTrackIndexes(chooseDefaultTracks(song))
    setCurrentTime(0)
    setTempoBpm(songTempoBpm(song))
    stopPlayback()
  }, [songIndex, song])

  useEffect(() => {
    let cancelled = false

    setExampleLoading(true)
    void loadExampleSongs()
      .then((entries) => {
        if (!cancelled) setExampleSongs(entries)
      })
      .catch(() => {
        if (!cancelled) setExampleSongs([])
      })
      .finally(() => {
        if (!cancelled) setExampleLoading(false)
      })

    void loadRecentMidiState()
      .then((state) => {
        if (cancelled || !state?.files.length) return
        const parsed = state.files.map((file) => parseMidiFile(file.buffer.slice(0), file.name))
        const nextIndex = Math.min(parsed.length - 1, Math.max(0, state.songIndex))
        setRecentMidiFiles(state.files)
        setSongs(parsed)
        setSongIndex(nextIndex)
        setSelectedTrackIndexes(chooseDefaultTracks(parsed[nextIndex]))
        setCurrentTime(0)
        setTempoBpm(songTempoBpm(parsed[nextIndex]))
      })
      .catch(() => {
        if (!cancelled) setRecentMidiFiles(null)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (playbackInstruments.some((instrument) => instrument.id === playbackInstrumentId)) return
    stopPlayback()
    releaseAllScrubAudition()
    sampleEngineRef.current?.releaseAll()
    setAudioStatus('')
    setPlaybackInstrumentId(defaultInstrumentForViewMode(instrumentViewMode))
  }, [instrumentViewMode, playbackInstrumentId, playbackInstruments])

  useEffect(() => {
    return () => {
      stopPlayback()
      releaseAllScrubAudition()
      synthRef.current?.dispose()
      sampleEngineRef.current?.dispose()
    }
  }, [])

  useEffect(() => {
    if (!isPlaying) return

    const tick = () => {
      const elapsed = (performance.now() - playStartedAtRef.current) / 1000
      const nextTime = Math.min(song.duration, playOffsetRef.current + elapsed * playbackRate)
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
  }, [isPlaying, playbackRate, song.duration])

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

  function getSampleEngine() {
    const rawContext = Tone.getContext().rawContext
    if (!rawContext || !('createGain' in rawContext)) {
      throw new Error('Sample playback is not available in this browser.')
    }

    const context = rawContext as AudioContext
    if (!sampleEngineRef.current || sampleEngineRef.current.context !== context) {
      sampleEngineRef.current?.dispose()
      sampleEngineRef.current = new SamplePlaybackEngine(context)
    }
    return sampleEngineRef.current
  }

  async function prepareAudioEngine(): Promise<ActiveAudioEngine> {
    await Tone.start()
    if (!isSampleInstrument(playbackInstrumentId)) {
      setAudioStatus('')
      return { kind: 'synth', synth: getSynth() }
    }

    try {
      const engine = getSampleEngine()
      const label = playbackInstrumentLabel(playbackInstrumentId)
      setAudioStatus(`Loading ${label}...`)
      await engine.load(playbackInstrumentId, (loaded, total) => {
        setAudioStatus(`${label} ${loaded}/${total}`)
      })
      setAudioStatus(`${label} ready`)
      return { kind: 'sample', engine, instrumentId: playbackInstrumentId }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sample instrument unavailable.'
      setAudioStatus(`Sample unavailable; using Synth`)
      setError(message)
      return { kind: 'synth', synth: getSynth() }
    }
  }

  function mappedMidi(note: MidiNote) {
    if (instrumentViewMode === 'piano') return note.midi
    const placement = notePlacements.get(note.id)
    return placement?.midi ?? note.midi
  }

  function mappedNoteName(note: MidiNote) {
    return noteName(mappedMidi(note))
  }

  function clearScrubReleaseTimer() {
    if (scrubReleaseTimerRef.current !== null) {
      window.clearTimeout(scrubReleaseTimerRef.current)
      scrubReleaseTimerRef.current = null
    }
  }

  function releaseScrubAudition(retainIds = new Set<string>()) {
    const synth = synthRef.current
    const sampleEngine = sampleEngineRef.current
    for (const [noteId, voice] of scrubAuditionRef.current) {
      if (retainIds.has(noteId)) continue
      if (voice.kind === 'synth') synth?.triggerRelease(voice.pitch)
      else sampleEngine?.triggerRelease(noteId)
      scrubAuditionRef.current.delete(noteId)
    }
    if (!scrubAuditionRef.current.size) clearScrubReleaseTimer()
  }

  function releaseAllScrubAudition() {
    scrubRunRef.current += 1
    clearScrubReleaseTimer()
    releaseScrubAudition()
  }

  function scheduleScrubRelease() {
    clearScrubReleaseTimer()
    if (!scrubAuditionRef.current.size) return
    scrubReleaseTimerRef.current = window.setTimeout(() => {
      releaseAllScrubAudition()
    }, 1200)
  }

  function auditionAt(time: number) {
    const activeNotes = combinedNotes
      .filter((note) => note.time <= time + 0.025 && note.time + note.duration >= time - 0.025)
      .sort((a, b) => a.midi - b.midi || a.trackIndex - b.trackIndex)
      .slice(0, MAX_SCRUB_AUDITION_NOTES)
    const activeIds = new Set(activeNotes.map((note) => note.id))
    const runId = scrubRunRef.current + 1
    scrubRunRef.current = runId

    if (!activeNotes.length) {
      releaseScrubAudition()
      return
    }

    void prepareAudioEngine().then((engine) => {
      if (scrubRunRef.current !== runId) return
      releaseScrubAudition(activeIds)
      const start = engine.kind === 'sample' ? engine.engine.context.currentTime + 0.006 : Tone.now()
      activeNotes.forEach((note, index) => {
        if (scrubAuditionRef.current.has(note.id)) return
        const velocity = Math.max(0.18, note.velocity * 0.66)
        if (engine.kind === 'sample') {
          scrubAuditionRef.current.set(note.id, { kind: 'sample' })
          void engine.engine.triggerAttack(
            engine.instrumentId,
            note.id,
            mappedMidi(note),
            start + index * 0.004,
            velocity,
          )
          return
        }

        const pitch = mappedNoteName(note)
        scrubAuditionRef.current.set(note.id, { kind: 'synth', pitch })
        engine.synth.triggerAttack(pitch, start + index * 0.004, velocity)
      })
      scheduleScrubRelease()
    })
  }

  async function playFrom(time = currentTime) {
    if (!combinedNotes.length) return
    releaseAllScrubAudition()
    const runId = playbackRunRef.current + 1
    playbackRunRef.current = runId
    const startTime = clampTime(time, song)
    playOffsetRef.current = startTime
    playStartedAtRef.current = performance.now()
    setCurrentTime(startTime)
    setIsPlaying(true)
    setError('')

    try {
      const engine = await prepareAudioEngine()
      if (playbackRunRef.current !== runId) return
      const transport = Tone.getTransport()
      const audioStartTime = clampTime(
        startTime + ((performance.now() - playStartedAtRef.current) / 1000) * playbackRate,
        song,
      )
      transport.stop()
      transport.cancel(0)
      transport.seconds = 0
      playOffsetRef.current = audioStartTime
      playStartedAtRef.current = performance.now()
      setCurrentTime(audioStartTime)

      for (const note of combinedNotes) {
        if (note.time + note.duration < audioStartTime) continue
        const start = Math.max(0, (note.time - audioStartTime) / playbackRate)
        const duration = Math.max(0.03, note.duration / playbackRate)
        transport.schedule((scheduledTime) => {
          if (engine.kind === 'sample') {
            void engine.engine.triggerAttackRelease(
              engine.instrumentId,
              `play:${note.id}`,
              mappedMidi(note),
              scheduledTime,
              duration,
              note.velocity * 0.78,
            )
            return
          }
          engine.synth.triggerAttackRelease(mappedNoteName(note), duration, scheduledTime, note.velocity * 0.78)
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
    releaseAllScrubAudition()
    sampleEngineRef.current?.releaseAll()
    const transport = Tone.getTransport()
    const elapsed = (performance.now() - playStartedAtRef.current) / 1000
    const nextTime = clampTime(playOffsetRef.current + elapsed * playbackRate, song)
    transport.pause()
    setCurrentTime(nextTime)
    setIsPlaying(false)
  }

  function stopPlayback() {
    playbackRunRef.current += 1
    releaseAllScrubAudition()
    sampleEngineRef.current?.releaseAll()
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    const transport = Tone.getTransport()
    transport.stop()
    transport.cancel(0)
    transport.seconds = 0
    playStartedAtRef.current = 0
    setIsPlaying(false)
  }

  function scrubTo(time: number) {
    if (isPlaying) stopPlayback()
    const nextTime = clampTime(time, song)
    playOffsetRef.current = nextTime
    setCurrentTime(nextTime)
    auditionAt(nextTime)
  }

  function jumpByMeasure(direction: -1 | 1) {
    const measureTicks = measureTicksForSong(song)
    const currentTick = secondsToTicks(song, currentTime)
    const nextTick = Math.min(song.durationTicks, Math.max(0, Math.round(currentTick + direction * measureTicks)))
    const nextTime = midiTicksToSeconds(song, nextTick)

    if (isPlaying) {
      stopPlayback()
      void playFrom(nextTime)
      return
    }

    scrubTo(nextTime)
  }

  shortcutActionsRef.current = {
    togglePlayback: () => {
      if (isPlaying) pausePlayback()
      else void playFrom()
    },
    jumpByMeasure,
  }

  useEffect(() => {
    if (variant !== 'desktop' && !desktopSizing) return

    function handleKeyDown(event: KeyboardEvent) {
      if (shouldIgnoreKeyboardShortcut(event)) return

      if (event.code === 'Space') {
        event.preventDefault()
        if (event.repeat) return
        shortcutActionsRef.current.togglePlayback()
        return
      }

      if (event.code === 'ArrowLeft') {
        event.preventDefault()
        shortcutActionsRef.current.jumpByMeasure(-1)
        return
      }

      if (event.code === 'ArrowRight') {
        event.preventDefault()
        shortcutActionsRef.current.jumpByMeasure(1)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [desktopSizing, variant])

  async function loadFiles(fileList: FileList | File[]) {
    const files = [...fileList].filter((file) => /\.(mid|midi)$/i.test(file.name))
    if (!files.length) return

    try {
      stopPlayback()
      releaseAllScrubAudition()
      setError('')
      const loadedFiles = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          lastModified: file.lastModified,
          buffer: await file.arrayBuffer(),
        })),
      )
      const parsed = loadedFiles.map((file) => parseMidiFile(file.buffer.slice(0), file.name))
      setSongs(parsed)
      setSongIndex(0)
      setRecentMidiFiles(loadedFiles)
      setSelectedTrackIndexes(chooseDefaultTracks(parsed[0]))
      setCurrentTime(0)
      setTempoBpm(songTempoBpm(parsed[0]))
      setSettingsOpen(false)
      void saveRecentMidiState({ files: loadedFiles, songIndex: 0 })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load MIDI file.')
    }
  }

  function updateTrackSlot(slot: TrackSlot, value: string) {
    stopPlayback()
    releaseAllScrubAudition()
    setCurrentTime(0)
    setSelectedTrackIndexes((current) => {
      const next: TrackSelection = [...current]
      next[slot] = value === 'none' ? null : Number(value)
      return next
    })
  }

  function updateFlowDensity(value: number) {
    if (!Number.isFinite(value)) return
    setFlowDensity(clampFlowDensity(value))
  }

  function updateInstrumentHeight(value: number) {
    if (!Number.isFinite(value)) return
    setInstrumentHeight(clampInstrumentHeight(value))
  }

  function updateSmartMelodyTrackSlot(value: string) {
    const slot = Number(value)
    if (slot !== 0 && slot !== 1 && slot !== 2) return
    stopPlayback()
    releaseAllScrubAudition()
    setSmartMelodyTrackSlot(slot)
  }

  function updateTempoBpm(value: number) {
    if (!Number.isFinite(value)) return
    if (isPlaying) pausePlayback()
    setTempoBpm(clampTempoBpm(value))
  }

  function updatePlaybackInstrument(value: PlaybackInstrumentId) {
    stopPlayback()
    releaseAllScrubAudition()
    sampleEngineRef.current?.releaseAll()
    setAudioStatus('')
    setError('')
    setPlaybackInstrumentId(value)
  }

  function updateInstrumentViewMode(value: InstrumentViewMode) {
    stopPlayback()
    releaseAllScrubAudition()
    sampleEngineRef.current?.releaseAll()
    setAudioStatus('')
    setError('')
    setInstrumentViewMode(value)
    setPlaybackInstrumentId(defaultInstrumentForViewMode(value))
  }

  function updateNotationViewMode(value: NotationViewMode) {
    releaseAllScrubAudition()
    setNotationViewMode(value)
  }

  function updateStringChannelPreset(value: StringChannelPresetId) {
    setStringChannelPreset(value)
    if (value === 'custom') return
    setStringChannelMap(presetById(value).channels)
  }

  function updateStringChannel(stringIndex: number, channel: number) {
    setStringChannelPreset('custom')
    setStringChannelMap((current) => {
      const next = normalizeStringChannelMap(current)
      next[stringIndex] = clampMidiChannel(channel)
      return next
    })
  }

  function renderSmartMelodyControls() {
    return (
      <>
        <label className="toggle-field">
          <span>Smart Guitar Melody</span>
          <input
            type="checkbox"
            checked={smartGuitarMelody}
            disabled={!smartGuitarMode}
            onChange={(event) => {
              stopPlayback()
              releaseAllScrubAudition()
              setSmartGuitarMelody(event.target.checked)
            }}
          />
        </label>

        <label className="toggle-field">
          <span>Chord Melody Mode</span>
          <input
            type="checkbox"
            checked={chordMelodyMode}
            disabled={!smartGuitarMode || !smartGuitarMelody}
            onChange={(event) => {
              stopPlayback()
              releaseAllScrubAudition()
              setChordMelodyMode(event.target.checked)
            }}
          />
        </label>

        <label className="field">
          <span>Melody Track</span>
          <select
            value={smartMelodyTrackSlot}
            disabled={!smartGuitarMode || !smartGuitarMelody}
            onChange={(event) => updateSmartMelodyTrackSlot(event.target.value)}
          >
            {([0, 1, 2] as TrackSlot[]).map((slot) => (
              <option key={slot} value={slot}>
                {SMART_MELODY_SLOT_LABELS[slot]}
              </option>
            ))}
          </select>
        </label>
      </>
    )
  }

  function renderNotationView() {
    if (instrumentViewMode === 'guitar' && notationViewMode === 'tab') {
      return (
        <TabView
          midi={song}
          notes={combinedNotes}
          markers={song.markers}
          placements={notePlacements}
          currentTime={currentTime}
          isPlaying={isPlaying}
          onScrub={scrubTo}
          trackColors={trackColors}
          melodyTrackIndexes={melodyTrackIndexes}
        />
      )
    }

    return (
      <SheetView
        midi={song}
        notes={combinedNotes}
        markers={song.markers}
        currentTime={currentTime}
        isPlaying={isPlaying}
        onScrub={scrubTo}
        trackColors={trackColors}
        melodyTrackIndexes={melodyTrackIndexes}
      />
    )
  }

  function renderRocksmithFlowView() {
    return (
      <section className="flow-panel rocksmith-flow-panel" aria-label="Experimental 3D MIDI note flight">
        <div className="panel-mini-header">
          <span>3D MIDI</span>
          <strong>{currentChord || '-'}</strong>
        </div>
        <div className="flow-frame rocksmith-flow-frame">
          <Suspense fallback={<div className="rocksmith-neck-view" aria-hidden="true" />}>
            <RocksmithNeckView
              notes={combinedNotes}
              placements={notePlacements}
              currentTime={currentTime}
              isPlaying={isPlaying}
              currentChord={currentChord}
              themeId={fretboardTheme}
            />
          </Suspense>
        </div>
      </section>
    )
  }

  function renderMidiFlowView() {
    if (instrumentViewMode === 'guitar' && guitarNeckDisplayMode === 'rocksmith') {
      return renderRocksmithFlowView()
    }

    return (
      <FlowView
        midi={song}
        notes={combinedNotes}
        markers={song.markers}
        placements={notePlacements}
        currentTime={currentTime}
        isPlaying={isPlaying}
        onScrub={scrubTo}
        trackColors={trackColors}
        pixelsPerSecond={flowDensity}
        viewMode={instrumentViewMode}
        pianoRange={pianoRange}
        melodyTrackIndexes={melodyTrackIndexes}
      />
    )
  }

  function renderGuitarInstrument(stretchToFit: boolean) {
    return (
      <Fretboard
        notes={combinedNotes}
        placements={notePlacements}
        currentTime={currentTime}
        trackColors={trackColors}
        themeId={fretboardTheme}
        stretchToFit={stretchToFit}
      />
    )
  }

  function renderLiveInstrument(stretchToFit: boolean) {
    if (instrumentViewMode === 'piano') {
      return (
        <PianoView
          notes={combinedNotes}
          currentTime={currentTime}
          trackColors={trackColors}
          range={pianoRange}
          melodyTrackIndexes={melodyTrackIndexes}
        />
      )
    }

    return renderGuitarInstrument(stretchToFit)
  }

  function liveInstrumentLabel() {
    return instrumentViewMode === 'piano' ? 'Piano' : 'Fretboard'
  }

  function liveInstrumentAriaLabel() {
    return instrumentViewMode === 'piano' ? 'Live piano keyboard' : 'Stationary guitar neck'
  }

  function exportMappedMidi() {
    if (!virtualTrack) return
    const bytes = exportGuitarMappedMidi(song, virtualTrack, notePlacements, stringChannelMap)
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
    releaseAllScrubAudition()
    setSongIndex(index)
    setCurrentTime(0)
    setTempoBpm(songTempoBpm(songs[index] ?? song))
    if (recentMidiFiles?.length) void saveRecentMidiState({ files: recentMidiFiles, songIndex: index })
  }

  async function chooseExampleSong(value: string) {
    if (!value) return
    stopPlayback()
    releaseAllScrubAudition()
    setError('')
    setExampleLoading(true)

    try {
      if (value === BUILT_IN_DEMO_EXAMPLE) {
        setSongs([DEMO_SONG])
        setSongIndex(0)
        setRecentMidiFiles(null)
        setSelectedTrackIndexes(chooseDefaultTracks(DEMO_SONG))
        setCurrentTime(0)
        setTempoBpm(songTempoBpm(DEMO_SONG))
        setSettingsOpen(false)
        return
      }

      const entry = exampleSongs.find((item) => item.id === value)
      if (!entry) return
      const loaded = await loadExampleSong(entry)
      const loadedFile: RecentMidiFile = {
        name: `${entry.title}.mid`,
        lastModified: Date.now(),
        buffer: loaded.buffer,
      }
      setSongs([loaded.song])
      setSongIndex(0)
      setRecentMidiFiles([loadedFile])
      setSelectedTrackIndexes(chooseDefaultTracks(loaded.song))
      setCurrentTime(0)
      setTempoBpm(songTempoBpm(loaded.song))
      setSettingsOpen(false)
      void saveRecentMidiState({ files: [loadedFile], songIndex: 0 })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load example song.')
    } finally {
      setExampleLoading(false)
    }
  }

  function chooseRandomExampleSong() {
    if (!exampleSongs.length || exampleLoading) return
    const entry = exampleSongs[Math.floor(Math.random() * exampleSongs.length)]
    if (!entry) return
    void chooseExampleSong(entry.id)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    loadFiles(event.dataTransfer.files)
  }

  if (variant === 'desktop') {
    return (
      <div className="app-shell desktop-shell" onDrop={handleDrop} onDragOver={(event) => event.preventDefault()}>
        <header className="desktop-header">
          <div className="brand" aria-label="Miditar">
            <div className="brand-mark">
              <Guitar size={23} strokeWidth={2.2} />
            </div>
            <h1>Miditar</h1>
          </div>

          <div className="desktop-song-summary">
            <strong>{song.title}</strong>
            {currentChord && <span>{currentChord}</span>}
          </div>

          <div className="desktop-header-actions">
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
            <button type="button" className="button secondary desktop-action-button" onClick={() => fileInputRef.current?.click()}>
              <FolderOpen size={18} />
              Open MIDI
            </button>
            <button type="button" className="button secondary desktop-action-button" onClick={exportMappedMidi} disabled={!virtualTrack}>
              <Download size={18} />
              Export
            </button>
          </div>
        </header>

        <main className="desktop-main">
          <aside className="desktop-sidebar" aria-label="Library and playback controls">
            <section className="desktop-control-section">
              <h2>Library</h2>
              <label className="field">
                <span>
                  <FileMusic size={15} />
                  Load Example Song
                </span>
                <div className="select-action-row">
                  <select
                    value=""
                    disabled={exampleLoading}
                    onChange={(event) => void chooseExampleSong(event.target.value)}
                  >
                    <option value="">{exampleLoading ? 'Loading...' : 'Choose example...'}</option>
                    <option value={BUILT_IN_DEMO_EXAMPLE}>Built-in Demo</option>
                    {exampleSongs.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.title}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="icon-button inline-icon-button"
                    aria-label="Load random example song"
                    title="Load random example song"
                    disabled={exampleLoading || !exampleSongs.length}
                    onClick={chooseRandomExampleSong}
                  >
                    <Dices size={19} />
                  </button>
                </div>
              </label>

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
            </section>

            <section className="desktop-control-section">
              <h2>Tracks</h2>
              <div className="track-grid">
                {([0, 1, 2] as TrackSlot[]).map((slot) => {
                  const selectedIndex = selectedTrackIndexes[slot]
                  return (
                    <label className="field" key={slot}>
                      <span>
                        <i className="track-dot" style={{ background: TRACK_COLORS[slot] }} />
                        {TRACK_SLOT_LABELS[slot]}
                      </span>
                      <select
                        value={selectedIndex ?? 'none'}
                        onChange={(event) => updateTrackSlot(slot, event.target.value)}
                      >
                        <option value="none">None</option>
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
            </section>

            <section className="desktop-control-section">
              <h2>Playback</h2>
              <label className="field">
                <span>View Mode</span>
                <select
                  value={instrumentViewMode}
                  onChange={(event) => updateInstrumentViewMode(event.target.value as InstrumentViewMode)}
                >
                  <option value="guitar">Guitar Fretboard</option>
                  <option value="piano">Piano Keyboard</option>
                </select>
              </label>

              {instrumentViewMode === 'guitar' && (
                <label className="field">
                  <span>Notation</span>
                  <select
                    value={notationViewMode}
                    onChange={(event) => updateNotationViewMode(event.target.value as NotationViewMode)}
                  >
                    <option value="tab">Guitar Tab</option>
                    <option value="sheet">Sheet Music</option>
                  </select>
                </label>
              )}

              <label className="field">
                <span>
                  <Guitar size={15} />
                  Sound
                </span>
                <select
                  value={playbackInstrumentId}
                  onChange={(event) => updatePlaybackInstrument(event.target.value as PlaybackInstrumentId)}
                >
                  {playbackInstruments.map((instrument) => (
                    <option key={instrument.id} value={instrument.id}>
                      {instrument.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="range-field">
                <span>Tempo</span>
                <input
                  type="range"
                  min={MIN_TEMPO_BPM}
                  max={MAX_TEMPO_BPM}
                  step={TEMPO_STEP}
                  value={tempoBpm}
                  onChange={(event) => updateTempoBpm(Number(event.target.value))}
                />
                <b>{tempoBpm} bpm</b>
              </label>

              <label className="range-field">
                <span>Speed</span>
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

              <label className="range-field">
                <span>MIDI Density</span>
                <input
                  type="range"
                  min={MIN_FLOW_DENSITY}
                  max={MAX_FLOW_DENSITY}
                  step={FLOW_DENSITY_STEP}
                  value={flowDensity}
                  onChange={(event) => updateFlowDensity(Number(event.target.value))}
                />
                <b>{flowDensity}</b>
              </label>
            </section>

            {(error || audioStatus) && (
              <section className="desktop-control-section">
                {error && <div className="error-text">{error}</div>}
                {audioStatus && <div className="status-text">{audioStatus}</div>}
              </section>
            )}
          </aside>

          <section className="desktop-stage" aria-label="Desktop MIDI views">
            {renderNotationView()}
            {renderMidiFlowView()}
          </section>

          <aside
            className="desktop-inspector"
            aria-label="Instrument and guitar controls"
            style={{ '--desktop-instrument-height': `${Math.max(26, instrumentHeight + 16)}%` } as CSSProperties}
          >
            <section className="desktop-instrument-panel">
              <div className="panel-mini-header">
                <span>{liveInstrumentLabel()}</span>
                <strong>{currentChord || song.title}</strong>
              </div>
              <div
                className="desktop-live-instrument neck-panel"
                data-neck-theme={fretboardTheme}
                data-view-mode={instrumentViewMode}
                aria-label={liveInstrumentAriaLabel()}
              >
                {renderLiveInstrument(true)}
              </div>
            </section>

            <section className="desktop-control-section">
              <h2>Instrument</h2>
              <label className="range-field">
                <span>Height</span>
                <input
                  aria-label="Instrument height"
                  type="range"
                  min={MIN_INSTRUMENT_HEIGHT}
                  max={MAX_INSTRUMENT_HEIGHT}
                  step="1"
                  value={instrumentHeight}
                  onChange={(event) => updateInstrumentHeight(Number(event.target.value))}
                />
                <b>{instrumentHeight}%</b>
              </label>

              {instrumentViewMode === 'guitar' && (
                <>
                  <label className="toggle-field">
                    <span>Smart Guitar Mode</span>
                    <input
                      type="checkbox"
                      checked={smartGuitarMode}
                      onChange={(event) => {
                        stopPlayback()
                        releaseAllScrubAudition()
                        setSmartGuitarMode(event.target.checked)
                      }}
                    />
                  </label>

                  {renderSmartMelodyControls()}

                  <label className="field">
                    <span>MIDI Display</span>
                    <select
                      value={guitarNeckDisplayMode}
                      onChange={(event) => setGuitarNeckDisplayMode(event.target.value as GuitarNeckDisplayMode)}
                    >
                      <option value="flat">2D Falling Notes</option>
                      <option value="rocksmith">3D Fret Flight</option>
                    </select>
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
                </>
              )}
            </section>

            {instrumentViewMode === 'guitar' && (
              <section className="desktop-control-section">
                <h2>String Channels</h2>
                <label className="field">
                  <span>Preset</span>
                  <select
                    value={stringChannelPreset}
                    onChange={(event) => updateStringChannelPreset(event.target.value as StringChannelPresetId)}
                  >
                    {STRING_CHANNEL_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                    <option value="custom">Custom</option>
                  </select>
                </label>

                {stringChannelPreset === 'custom' && (
                  <div className="channel-grid">
                    {STRING_CHANNEL_STRINGS.map((string) => (
                      <label className="field compact-field" key={string.index}>
                        <span>{string.label}</span>
                        <select
                          value={stringChannelMap[string.index]}
                          onChange={(event) => updateStringChannel(string.index, Number(event.target.value))}
                        >
                          {Array.from({ length: 16 }).map((_, index) => (
                            <option key={index + 1} value={index + 1}>
                              ch {index + 1}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                )}

                <label className="toggle-field">
                  <span>Use MIDI Channels As Strings</span>
                  <input
                    type="checkbox"
                    checked={useSourceStringChannels}
                    onChange={(event) => {
                      stopPlayback()
                      releaseAllScrubAudition()
                      setUseSourceStringChannels(event.target.checked)
                    }}
                  />
                </label>
              </section>
            )}
          </aside>
        </main>
      </div>
    )
  }

  return (
    <div
      className={desktopSizing ? 'app-shell app-shell-wide' : 'app-shell'}
      onDrop={handleDrop}
      onDragOver={(event) => event.preventDefault()}
    >
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

            <label className="field">
              <span>
                <FileMusic size={15} />
                Load Example Song
              </span>
              <div className="select-action-row">
                <select
                  value=""
                  disabled={exampleLoading}
                  onChange={(event) => void chooseExampleSong(event.target.value)}
                >
                  <option value="">{exampleLoading ? 'Loading...' : 'Choose example...'}</option>
                  <option value={BUILT_IN_DEMO_EXAMPLE}>Built-in Demo</option>
                  {exampleSongs.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.title}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="icon-button inline-icon-button"
                  aria-label="Load random example song"
                  title="Load random example song"
                  disabled={exampleLoading || !exampleSongs.length}
                  onClick={chooseRandomExampleSong}
                >
                  <Dices size={19} />
                </button>
              </div>
            </label>

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
              {([0, 1, 2] as TrackSlot[]).map((slot) => {
                const selectedIndex = selectedTrackIndexes[slot]
                return (
                  <label className="field" key={slot}>
                    <span>
                      <i className="track-dot" style={{ background: TRACK_COLORS[slot] }} />
                      {TRACK_SLOT_LABELS[slot]}
                    </span>
                    <select
                      value={selectedIndex ?? 'none'}
                      onChange={(event) => updateTrackSlot(slot, event.target.value)}
                    >
                      <option value="none">None</option>
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

            <label className="field">
              <span>View Mode</span>
              <select
                value={instrumentViewMode}
                onChange={(event) => updateInstrumentViewMode(event.target.value as InstrumentViewMode)}
              >
                <option value="guitar">Guitar Fretboard</option>
                <option value="piano">Piano Keyboard</option>
              </select>
            </label>

            {instrumentViewMode === 'guitar' && (
              <label className="field">
                <span>Notation</span>
                <select
                  value={notationViewMode}
                  onChange={(event) => updateNotationViewMode(event.target.value as NotationViewMode)}
                >
                  <option value="tab">Guitar Tab</option>
                  <option value="sheet">Sheet Music</option>
                </select>
              </label>
            )}

            {instrumentViewMode === 'guitar' && (
              <>
                <label className="toggle-field">
                  <span>Smart Guitar Mode</span>
                  <input
                    type="checkbox"
                    checked={smartGuitarMode}
                    onChange={(event) => {
                      stopPlayback()
                      releaseAllScrubAudition()
                      setSmartGuitarMode(event.target.checked)
                    }}
                  />
                </label>

                {renderSmartMelodyControls()}

                <label className="field">
                  <span>MIDI Display</span>
                  <select
                    value={guitarNeckDisplayMode}
                    onChange={(event) => setGuitarNeckDisplayMode(event.target.value as GuitarNeckDisplayMode)}
                  >
                    <option value="flat">2D Falling Notes</option>
                    <option value="rocksmith">3D Fret Flight</option>
                  </select>
                </label>

                <label className="field">
                  <span>String Channels</span>
                  <select
                    value={stringChannelPreset}
                    onChange={(event) => updateStringChannelPreset(event.target.value as StringChannelPresetId)}
                  >
                    {STRING_CHANNEL_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                    <option value="custom">Custom</option>
                  </select>
                </label>

                {stringChannelPreset === 'custom' && (
                  <div className="channel-grid">
                    {STRING_CHANNEL_STRINGS.map((string) => (
                      <label className="field compact-field" key={string.index}>
                        <span>{string.label}</span>
                        <select
                          value={stringChannelMap[string.index]}
                          onChange={(event) => updateStringChannel(string.index, Number(event.target.value))}
                        >
                          {Array.from({ length: 16 }).map((_, index) => (
                            <option key={index + 1} value={index + 1}>
                              ch {index + 1}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                )}

                <label className="toggle-field">
                  <span>Use MIDI Channels As Strings</span>
                  <input
                    type="checkbox"
                    checked={useSourceStringChannels}
                    onChange={(event) => {
                      stopPlayback()
                      releaseAllScrubAudition()
                      setUseSourceStringChannels(event.target.checked)
                    }}
                  />
                </label>
              </>
            )}

            <label className="field">
              <span>
                <Guitar size={15} />
                Sound
              </span>
              <select
                value={playbackInstrumentId}
                onChange={(event) => updatePlaybackInstrument(event.target.value as PlaybackInstrumentId)}
              >
                {playbackInstruments.map((instrument) => (
                  <option key={instrument.id} value={instrument.id}>
                    {instrument.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="range-field">
              <span>Tempo</span>
              <input
                type="range"
                min={MIN_TEMPO_BPM}
                max={MAX_TEMPO_BPM}
                step={TEMPO_STEP}
                value={tempoBpm}
                onChange={(event) => updateTempoBpm(Number(event.target.value))}
              />
              <b>{tempoBpm} bpm</b>
            </label>

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

            <label className="range-field">
              <span>MIDI Density</span>
              <input
                type="range"
                min={MIN_FLOW_DENSITY}
                max={MAX_FLOW_DENSITY}
                step={FLOW_DENSITY_STEP}
                value={flowDensity}
                onChange={(event) => updateFlowDensity(Number(event.target.value))}
              />
              <b>{flowDensity}</b>
            </label>

            <label className="range-field">
              <span>Instrument Height</span>
              <input
                aria-label="Instrument height"
                type="range"
                min={MIN_INSTRUMENT_HEIGHT}
                max={MAX_INSTRUMENT_HEIGHT}
                step="1"
                value={instrumentHeight}
                onChange={(event) => updateInstrumentHeight(Number(event.target.value))}
              />
              <b>{instrumentHeight}%</b>
            </label>

            {instrumentViewMode === 'guitar' && (
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
            )}

            {error && <div className="error-text">{error}</div>}
            {audioStatus && <div className="status-text">{audioStatus}</div>}
          </aside>
        </div>
      )}

      <main
        className="main-stage"
        style={{ '--instrument-height': `${instrumentHeight}%` } as CSSProperties}
      >
        {renderNotationView()}
        {renderMidiFlowView()}
        <section
          className="neck-panel"
          data-neck-theme={fretboardTheme}
          data-view-mode={instrumentViewMode}
          aria-label={liveInstrumentAriaLabel()}
        >
          {renderLiveInstrument(desktopSizing)}
        </section>
      </main>
    </div>
  )
}

export default App
