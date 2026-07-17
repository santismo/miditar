import { type CSSProperties, type DragEvent, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type JSZip from 'jszip'
import * as Tone from 'tone'
import {
  ChevronLeft,
  ChevronRight,
  Dices,
  Download,
  Eye,
  EyeOff,
  FileMusic,
  FolderOpen,
  Guitar,
  LibraryBig,
  Palette,
  Pause,
  Play,
  RectangleHorizontal,
  Search,
  Settings,
  X,
} from 'lucide-react'
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
  secondsToTicks,
  type MidiNote,
  type MidiTrack,
  type ParsedMidi,
} from './lib/midi'
import { loadRecentMidiState, saveRecentMidiState, type RecentMidiFile } from './lib/recentMidiStore'
import { pianoRangeForNotes } from './lib/pianoLayout'
import { OFFLINE_BUILD } from './lib/buildMode'
import { regenerateChordMarkers, withAnalyzedChordMarkers } from './lib/chordAnalysis'
import { parseSupportedMusicFile, SUPPORTED_MUSIC_FILE_PATTERN } from './lib/tabImport'
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
  type SampleInstrumentId,
  type PlaybackInstrumentId,
} from './lib/sampleEngine'
import { SoundFontPlaybackEngine } from './lib/soundFontEngine'
import { loadStoredSoundFont, removeStoredSoundFont, saveStoredSoundFont } from './lib/soundFontStore'
import {
  formatSoundFontSize,
  rankSoundFonts,
  type OnlineSoundFont,
} from './lib/soundFontCatalog'
import {
  MUSIC_LIBRARY_LABELS,
  MUSIC_LIBRARY_SOURCES,
  type MusicLibraryCategory,
} from './lib/musicLibrary'
import {
  fallbackMusicCatalog,
  flattenMusicCatalog,
  loadMusicCatalog,
  type MusicCatalogEntry,
  type MusicCatalogManifest,
} from './lib/musicCatalog'

const TRACK_COLORS = ['#f05d51', '#48b6ff', '#f2c14e', '#7bd88f']
const DEMO_SONG = createDemoMidi()
const MAX_SCRUB_AUDITION_NOTES = 12
const DEFAULT_FLOW_DENSITY = 168
const MIN_FLOW_DENSITY = 88
const MAX_FLOW_DENSITY = 320
const FLOW_DENSITY_STEP = 4
const MIN_TEMPO_BPM = 40
const MAX_TEMPO_BPM = 240
const TEMPO_STEP = 1
const DEFAULT_INSTRUMENT_HEIGHT = 16
const DESKTOP_DEFAULT_INSTRUMENT_HEIGHT = 22
const MIN_INSTRUMENT_HEIGHT = 12
const MAX_INSTRUMENT_HEIGHT = 30
const CATALOG_PAGE_SIZE = 50
const DOWNLOAD_TIMEOUT_MS = 90_000
const PLAYBACK_SCHEDULE_AHEAD_SECONDS = 3
const PLAYBACK_SCHEDULER_INTERVAL_MS = 400
const PLAYHEAD_UPDATE_INTERVAL_MS = 1000 / 30

type TrackSelection = [number | null, number | null, number | null]
type TrackSlot = 0 | 1 | 2
type ActiveAudioEngine =
  | { kind: 'synth'; synth: Tone.PolySynth }
  | { kind: 'sample'; engine: SamplePlaybackEngine; instrumentId: SampleInstrumentId }
  | { kind: 'soundfont'; engine: SoundFontPlaybackEngine }
type ScrubVoice =
  | { kind: 'synth'; pitch: string }
  | { kind: 'sample' }
  | { kind: 'soundfont'; channel: number; midi: number }
type InstrumentViewMode = 'guitar' | 'piano'
type NotationViewMode = 'tab' | 'sheet'
type GuitarNeckDisplayMode = 'flat' | 'rocksmith'
type CatalogCategory = MusicLibraryCategory | 'all'
type LockableScreenOrientation = ScreenOrientation & {
  lock?: (orientation: 'landscape') => Promise<void>
}
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
const APP_NAME = OFFLINE_BUILD ? 'Miditar Offline' : 'Miditar'
const GUITAR_INSTRUMENTS = new Set<PlaybackInstrumentId>([
  'sample:guitar-acoustic',
  'sample:guitar-nylon',
  'sample:guitar-electric',
  'sample:bass-electric',
  'soundfont:custom',
  'synth',
])
const PIANO_INSTRUMENTS = new Set<PlaybackInstrumentId>(['sample:piano', 'soundfont:custom', 'synth'])
const SMART_MELODY_SLOT_LABELS = ['Track 1 (Primary)', 'Track 2 (Secondary)', 'Track 3 (Bass)']
const MUSIC_LIBRARY_CATEGORIES: MusicLibraryCategory[] = ['guitar', 'piano', 'video-game']
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
  if (OFFLINE_BUILD) return 'synth'
  return viewMode === 'piano' ? 'sample:piano' : 'sample:guitar-acoustic'
}

function shouldIgnoreKeyboardShortcut(event: KeyboardEvent) {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return true
  const target = event.target
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return Boolean(target.closest('input, textarea, select, button, [role="textbox"], [contenteditable="true"]'))
}

async function downloadArrayBuffer(
  urls: string[],
  label: string,
  onProgress?: (receivedBytes: number, totalBytes: number) => void,
) {
  const failures: string[] = []
  for (const url of [...new Set(urls.filter(Boolean))]) {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
    try {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) throw new Error(`returned ${response.status}`)
      const totalBytes = Number(response.headers.get('content-length')) || 0
      if (!response.body) {
        const buffer = await response.arrayBuffer()
        if (!buffer.byteLength) throw new Error('returned an empty file')
        onProgress?.(buffer.byteLength, totalBytes || buffer.byteLength)
        return buffer
      }

      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let receivedBytes = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        chunks.push(value)
        receivedBytes += value.byteLength
        onProgress?.(receivedBytes, totalBytes)
      }
      if (!receivedBytes) throw new Error('returned an empty file')
      const bytes = new Uint8Array(receivedBytes)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      return bytes.buffer
    } catch (error) {
      const message = error instanceof Error && error.name === 'AbortError'
        ? 'timed out'
        : error instanceof Error
          ? error.message
          : 'failed'
      failures.push(message)
    } finally {
      window.clearTimeout(timeout)
    }
  }
  throw new Error(`${label} could not be downloaded${failures.length ? ` (${failures.join('; ')})` : ''}.`)
}

function App({ variant = 'mobile', desktopSizing = false }: AppProps = {}) {
  const [songs, setSongs] = useState<ParsedMidi[]>([DEMO_SONG])
  const [songIndex, setSongIndex] = useState(0)
  const [selectedTrackIndexes, setSelectedTrackIndexes] = useState<TrackSelection>(() => chooseDefaultTracks(DEMO_SONG))
  const [useAllTracks, setUseAllTracks] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [tempoBpm, setTempoBpm] = useState(() => songTempoBpm(DEMO_SONG))
  const [instrumentViewMode, setInstrumentViewMode] = useState<InstrumentViewMode>('guitar')
  const [notationViewMode, setNotationViewMode] = useState<NotationViewMode>('tab')
  const [showNotation, setShowNotation] = useState(true)
  const [guitarNeckDisplayMode, setGuitarNeckDisplayMode] = useState<GuitarNeckDisplayMode>('flat')
  const [smartGuitarMode, setSmartGuitarMode] = useState(true)
  const [smartGuitarMelody, setSmartGuitarMelody] = useState(true)
  const [chordMelodyMode, setChordMelodyMode] = useState(true)
  const [smartMelodyTrackSlot, setSmartMelodyTrackSlot] = useState<TrackSlot>(1)
  const [useSourceStringChannels, setUseSourceStringChannels] = useState(false)
  const [useOriginalTabPositions, setUseOriginalTabPositions] = useState(true)
  const [stringChannelPreset, setStringChannelPreset] = useState<StringChannelPresetId>('miditar-11')
  const [stringChannelMap, setStringChannelMap] = useState<StringChannelMap>(DEFAULT_STRING_CHANNEL_MAP)
  const [flowDensity, setFlowDensity] = useState(DEFAULT_FLOW_DENSITY)
  const [instrumentHeight, setInstrumentHeight] = useState(() =>
    desktopSizing ? DESKTOP_DEFAULT_INSTRUMENT_HEIGHT : DEFAULT_INSTRUMENT_HEIGHT,
  )
  const [playbackInstrumentId, setPlaybackInstrumentId] =
    useState<PlaybackInstrumentId>(() => defaultInstrumentForViewMode('guitar'))
  const [fretboardTheme, setFretboardTheme] = useState<FretboardThemeId>('dark')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [error, setError] = useState('')
  const [audioStatus, setAudioStatus] = useState('')
  const [soundFontName, setSoundFontName] = useState('')
  const [soundFontBrowserOpen, setSoundFontBrowserOpen] = useState(false)
  const [soundFontQuery, setSoundFontQuery] = useState('')
  const [soundFontLoadingId, setSoundFontLoadingId] = useState('')
  const [librarySelection, setLibrarySelection] = useState<Record<MusicLibraryCategory, string>>({
    guitar: '',
    piano: '',
    'video-game': '',
  })
  const [libraryLoadingId, setLibraryLoadingId] = useState('')
  const [catalogManifest, setCatalogManifest] = useState<MusicCatalogManifest | null>(null)
  const [catalogEntries, setCatalogEntries] = useState<MusicCatalogEntry[]>(() => fallbackMusicCatalog())
  const [catalogOpenCategory, setCatalogOpenCategory] = useState<CatalogCategory | null>(null)
  const [catalogQuery, setCatalogQuery] = useState('')
  const [catalogSourceId, setCatalogSourceId] = useState('all')
  const [catalogPage, setCatalogPage] = useState(0)
  const [catalogActivity, setCatalogActivity] = useState('')
  const [currentLibraryEntry, setCurrentLibraryEntry] = useState<MusicCatalogEntry | null>(null)
  const [landscapeMessage, setLandscapeMessage] = useState('')
  const [exampleSongs, setExampleSongs] = useState<ExampleSongEntry[]>([])
  const [exampleLoading, setExampleLoading] = useState(false)
  const [recentMidiFiles, setRecentMidiFiles] = useState<RecentMidiFile[] | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const soundFontInputRef = useRef<HTMLInputElement | null>(null)
  const synthRef = useRef<Tone.PolySynth | null>(null)
  const sampleEngineRef = useRef<SamplePlaybackEngine | null>(null)
  const soundFontEngineRef = useRef<SoundFontPlaybackEngine | null>(null)
  const soundFontBufferRef = useRef<ArrayBuffer | null>(null)
  const archiveRef = useRef<{ key: string; zip: JSZip } | null>(null)
  const playOffsetRef = useRef(0)
  const playStartedAtRef = useRef(0)
  const playbackRunRef = useRef(0)
  const scrubRunRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const playbackSchedulerRef = useRef<number | null>(null)
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
    if (useAllTracks) return tracks
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
  }, [selectedTrackIndexes, song, tracks, useAllTracks])
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
    const coloredIndexes = useAllTracks ? tracks.map((track) => track.index) : selectedTrackIndexes
    coloredIndexes.forEach((trackIndex, index) => {
      if (trackIndex === null || colors[trackIndex]) return
      colors[trackIndex] = TRACK_COLORS[index % TRACK_COLORS.length]
    })
    return colors
  }, [selectedTrackIndexes, tracks, useAllTracks])
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
  const hasOriginalTabPositions = Boolean(song.exactPlacements?.length)
  const notePlacements = useMemo(() => {
    const mapped = mapNotesToFretboard(combinedNotes, {
      smart: smartGuitarMode,
      smartMelody: smartGuitarMode && smartGuitarMelody,
      chordMelody: smartGuitarMode && smartGuitarMelody && chordMelodyMode,
      melodyTrackIndexes,
      bassTrackIndexes,
      sourceChannelMap: stringChannelMap,
      useSourceChannels: useSourceStringChannels,
    })
    if (useOriginalTabPositions) {
      const visibleNotes = new Set(combinedNotes.map((note) => note.id))
      for (const placement of song.exactPlacements ?? []) {
        if (visibleNotes.has(placement.noteId)) mapped.set(placement.noteId, placement)
      }
    }
    return mapped
  }, [
    bassTrackIndexes,
    combinedNotes,
    chordMelodyMode,
    melodyTrackIndexes,
    smartGuitarMelody,
    smartGuitarMode,
    stringChannelMap,
    song.exactPlacements,
    useOriginalTabPositions,
    useSourceStringChannels,
  ])
  const currentChord = currentMarkerText(song, currentTime)
  const connectedFlightMode = instrumentViewMode === 'guitar' && guitarNeckDisplayMode === 'rocksmith'
  const catalogCounts = useMemo(() => {
    const counts: Record<MusicLibraryCategory, number> = { guitar: 0, piano: 0, 'video-game': 0 }
    for (const entry of catalogEntries) counts[entry.category] += 1
    return counts
  }, [catalogEntries])
  const activeCatalogSources = useMemo(() => {
    const sources = catalogManifest?.sources ?? []
    if (!catalogOpenCategory || catalogOpenCategory === 'all') return sources
    return sources.filter((source) => source.category === catalogOpenCategory)
  }, [catalogManifest, catalogOpenCategory])
  const filteredCatalogEntries = useMemo(() => {
    const query = catalogQuery.trim().toLowerCase()
    return catalogEntries.filter((entry) => {
      if (catalogOpenCategory && catalogOpenCategory !== 'all' && entry.category !== catalogOpenCategory) return false
      if (catalogSourceId !== 'all' && entry.sourceId !== catalogSourceId) return false
      if (!query) return true
      return `${entry.title} ${entry.subtitle} ${entry.sourceName} ${entry.path}`.toLowerCase().includes(query)
    })
  }, [catalogEntries, catalogOpenCategory, catalogQuery, catalogSourceId])
  const catalogPageCount = Math.max(1, Math.ceil(filteredCatalogEntries.length / CATALOG_PAGE_SIZE))
  const visibleCatalogEntries = filteredCatalogEntries.slice(
    catalogPage * CATALOG_PAGE_SIZE,
    (catalogPage + 1) * CATALOG_PAGE_SIZE,
  )
  const soundFontMatchText = [
    soundFontQuery,
    song.title,
    song.fileName,
    currentLibraryEntry?.title,
    currentLibraryEntry?.subtitle,
    currentLibraryEntry?.path,
    currentLibraryEntry?.category,
    currentLibraryEntry?.sourceName,
  ].filter(Boolean).join(' ')
  const rankedSoundFonts = useMemo(() => rankSoundFonts(soundFontMatchText), [soundFontMatchText])

  useEffect(() => {
    if (!song) return
    setSelectedTrackIndexes(chooseDefaultTracks(song))
    setUseAllTracks((current) => current && playableTracks(song).length > 1)
    setCurrentTime(0)
    setTempoBpm(songTempoBpm(song))
    setUseOriginalTabPositions(Boolean(song.exactPlacements?.length))
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

    void loadMusicCatalog()
      .then((manifest) => {
        if (cancelled) return
        setCatalogManifest(manifest)
        setCatalogEntries(flattenMusicCatalog(manifest))
      })
      .catch(() => {
        if (!cancelled) setCatalogActivity('Full catalog unavailable; showing the built-in fallback list.')
      })

    void loadRecentMidiState()
      .then(async (state) => {
        if (cancelled || !state?.files.length) return
        const parsed = await Promise.all(
          state.files.map(async (file) =>
            withAnalyzedChordMarkers(await parseSupportedMusicFile(file.buffer.slice(0), file.name)),
          ),
        )
        if (cancelled) return
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

    void loadStoredSoundFont()
      .then((stored) => {
        if (cancelled || !stored) return
        soundFontBufferRef.current = stored.buffer
        setSoundFontName(stored.name)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setCatalogPage(0)
  }, [catalogOpenCategory, catalogQuery, catalogSourceId])

  useEffect(() => {
    if (playbackInstruments.some((instrument) => instrument.id === playbackInstrumentId)) return
    stopPlayback()
    releaseAllScrubAudition()
    sampleEngineRef.current?.releaseAll()
    soundFontEngineRef.current?.releaseAll()
    setAudioStatus('')
    setPlaybackInstrumentId(defaultInstrumentForViewMode(instrumentViewMode))
  }, [instrumentViewMode, playbackInstrumentId, playbackInstruments])

  useEffect(() => {
    return () => {
      stopPlayback()
      releaseAllScrubAudition()
      synthRef.current?.dispose()
      sampleEngineRef.current?.dispose()
      soundFontEngineRef.current?.dispose()
    }
  }, [])

  useEffect(() => {
    const resumeAudio = () => {
      if (document.visibilityState !== 'visible') return
      const rawContext = Tone.getContext().rawContext
      if (rawContext?.state === 'suspended') void rawContext.resume().catch(() => undefined)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        stopPlayback()
        soundFontEngineRef.current?.handleContextInterruption()
        soundFontEngineRef.current = null
        return
      }
      resumeAudio()
    }

    const handlePageHide = () => {
      stopPlayback()
      soundFontEngineRef.current?.handleContextInterruption()
      soundFontEngineRef.current = null
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pageshow', resumeAudio)
    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('pointerdown', resumeAudio, { passive: true })
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pageshow', resumeAudio)
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('pointerdown', resumeAudio)
    }
  }, [])

  useEffect(() => {
    if (!isPlaying) return

    let lastUpdate = 0
    const tick = (frameTime: number) => {
      if (frameTime - lastUpdate < PLAYHEAD_UPDATE_INTERVAL_MS) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }
      lastUpdate = frameTime
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

  function getSoundFontEngine() {
    const rawContext = Tone.getContext().rawContext
    if (!rawContext || !('audioWorklet' in rawContext)) {
      throw new Error('SoundFont playback requires AudioWorklet support in this browser.')
    }

    const context = rawContext as AudioContext
    if (!soundFontEngineRef.current || soundFontEngineRef.current.context !== context) {
      soundFontEngineRef.current?.dispose()
      soundFontEngineRef.current = new SoundFontPlaybackEngine(context)
    }
    return soundFontEngineRef.current
  }

  async function prepareAudioEngine(): Promise<ActiveAudioEngine> {
    await Tone.start()
    if (playbackInstrumentId === 'soundfont:custom') {
      const buffer = soundFontBufferRef.current
      if (!buffer || !soundFontName) {
        setAudioStatus('Load a SoundFont to use this sound mode')
        return { kind: 'synth', synth: getSynth() }
      }

      try {
        const engine = getSoundFontEngine()
        setAudioStatus(`Loading ${soundFontName}...`)
        await engine.load(buffer, `${soundFontName}:${buffer.byteLength}`)
        setAudioStatus(`${soundFontName} ready`)
        return { kind: 'soundfont', engine }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'SoundFont unavailable.'
        setAudioStatus('SoundFont unavailable; using Synth')
        setError(message)
        return { kind: 'synth', synth: getSynth() }
      }
    }

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

  function programForNote(note: MidiNote) {
    return song.tracks.find((track) => track.index === note.trackIndex)?.programs[note.channel] ?? 0
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
    const soundFontEngine = soundFontEngineRef.current
    for (const [noteId, voice] of scrubAuditionRef.current) {
      if (retainIds.has(noteId)) continue
      if (voice.kind === 'synth') synth?.triggerRelease(voice.pitch)
      else if (voice.kind === 'sample') sampleEngine?.triggerRelease(noteId)
      else soundFontEngine?.triggerRelease(voice.channel, voice.midi)
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

        if (engine.kind === 'soundfont') {
          const channel = note.channel - 1
          const midi = mappedMidi(note)
          scrubAuditionRef.current.set(note.id, { kind: 'soundfont', channel, midi })
          engine.engine.triggerAttack(channel, midi, velocity, programForNote(note), start + index * 0.004)
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

      let nextNoteIndex = combinedNotes.findIndex(
        (note) => note.time + note.duration >= audioStartTime,
      )
      if (nextNoteIndex < 0) nextNoteIndex = combinedNotes.length

      const schedulePlaybackWindow = () => {
        if (playbackRunRef.current !== runId) return
        const elapsed = (performance.now() - playStartedAtRef.current) / 1000
        const sourceHorizon =
          audioStartTime + (elapsed + PLAYBACK_SCHEDULE_AHEAD_SECONDS) * playbackRate

        while (nextNoteIndex < combinedNotes.length) {
          const note = combinedNotes[nextNoteIndex]
          if (note.time > sourceHorizon) break
          nextNoteIndex += 1
          if (note.time + note.duration < audioStartTime) continue

          const start = Math.max(0, (note.time - audioStartTime) / playbackRate)
          const duration = Math.max(0.03, note.duration / playbackRate)
          transport.schedule((scheduledTime) => {
            if (playbackRunRef.current !== runId) return
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
            if (engine.kind === 'soundfont') {
              engine.engine.triggerAttackRelease(
                note.channel - 1,
                mappedMidi(note),
                duration,
                note.velocity * 0.78,
                programForNote(note),
                scheduledTime,
              )
              return
            }
            engine.synth.triggerAttackRelease(
              mappedNoteName(note),
              duration,
              scheduledTime,
              note.velocity * 0.78,
            )
          }, start)
        }

        if (nextNoteIndex >= combinedNotes.length) clearPlaybackScheduler()
      }

      clearPlaybackScheduler()
      playbackSchedulerRef.current = window.setInterval(
        schedulePlaybackWindow,
        PLAYBACK_SCHEDULER_INTERVAL_MS,
      )
      schedulePlaybackWindow()
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
    clearPlaybackScheduler()
    releaseAllScrubAudition()
    sampleEngineRef.current?.releaseAll()
    soundFontEngineRef.current?.releaseAll()
    const transport = Tone.getTransport()
    const elapsed = (performance.now() - playStartedAtRef.current) / 1000
    const nextTime = clampTime(playOffsetRef.current + elapsed * playbackRate, song)
    transport.pause()
    setCurrentTime(nextTime)
    setIsPlaying(false)
  }

  function stopPlayback() {
    playbackRunRef.current += 1
    clearPlaybackScheduler()
    releaseAllScrubAudition()
    sampleEngineRef.current?.releaseAll()
    soundFontEngineRef.current?.releaseAll()
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    const transport = Tone.getTransport()
    transport.stop()
    transport.cancel(0)
    transport.seconds = 0
    playStartedAtRef.current = 0
    setIsPlaying(false)
  }

  function clearPlaybackScheduler() {
    if (playbackSchedulerRef.current === null) return
    window.clearInterval(playbackSchedulerRef.current)
    playbackSchedulerRef.current = null
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
    const files = [...fileList].filter((file) => SUPPORTED_MUSIC_FILE_PATTERN.test(file.name))
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
      const parsed = await Promise.all(
        loadedFiles.map(async (file) =>
          withAnalyzedChordMarkers(await parseSupportedMusicFile(file.buffer.slice(0), file.name)),
        ),
      )
      setSongs(parsed)
      setSongIndex(0)
      setRecentMidiFiles(loadedFiles)
      setCurrentLibraryEntry(null)
      setUseAllTracks(false)
      setSelectedTrackIndexes(chooseDefaultTracks(parsed[0]))
      setCurrentTime(0)
      setTempoBpm(songTempoBpm(parsed[0]))
      setSettingsOpen(false)
      void saveRecentMidiState({ files: loadedFiles, songIndex: 0 })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load MIDI file.')
    }
  }

  async function readCatalogEntry(entry: MusicCatalogEntry) {
    if (entry.delivery === 'direct') {
      const urls = entry.urls?.length ? entry.urls : entry.url ? [entry.url] : []
      if (!urls.length) throw new Error(`${entry.sourceName} did not provide a download URL.`)
      return downloadArrayBuffer(urls, entry.title, (receivedBytes, totalBytes) => {
        const received = (receivedBytes / 1024 / 1024).toFixed(1)
        const total = totalBytes ? ` / ${(totalBytes / 1024 / 1024).toFixed(1)} MB` : ' MB'
        setCatalogActivity(`Downloading ${entry.title}: ${received}${total}`)
      })
    }

    const archiveUrls = entry.archiveUrls?.length
      ? entry.archiveUrls
      : entry.archiveUrl
        ? [entry.archiveUrl]
        : []
    if (!archiveUrls.length) throw new Error(`${entry.sourceName} did not provide an archive URL.`)
    const archiveKey = archiveUrls.join('|')
    let loadedArchive = archiveRef.current
    if (!loadedArchive || loadedArchive.key !== archiveKey) {
      setCatalogActivity('Downloading and indexing the game archive (about 12 MB)...')
      const archiveBuffer = await downloadArrayBuffer(archiveUrls, `${entry.sourceName} archive`, (receivedBytes, totalBytes) => {
        const received = (receivedBytes / 1024 / 1024).toFixed(1)
        const total = totalBytes ? ` / ${(totalBytes / 1024 / 1024).toFixed(1)} MB` : ' MB'
        setCatalogActivity(`Downloading game archive: ${received}${total}`)
      })
      const { default: Zip } = await import('jszip')
      setCatalogActivity('Indexing the downloaded game archive...')
      const zip = await Zip.loadAsync(archiveBuffer)
      loadedArchive = { key: archiveKey, zip }
      archiveRef.current = loadedArchive
    }

    const archivedFile = loadedArchive.zip.file(entry.path)
    if (!archivedFile) throw new Error(`${entry.fileName} was not found in the downloaded game archive.`)
    setCatalogActivity(`Opening ${entry.title}...`)
    return archivedFile.async('arraybuffer')
  }

  async function loadLibraryEntry(entry: MusicCatalogEntry) {
    stopPlayback()
    releaseAllScrubAudition()
    setError('')
    setLibraryLoadingId(entry.id)
    setCatalogActivity(`Loading ${entry.title}...`)

    try {
      const buffer = await readCatalogEntry(entry)
      const loadedSong = withAnalyzedChordMarkers(await parseSupportedMusicFile(buffer.slice(0), entry.fileName))
      const loadedTracks = playableTracks(loadedSong)
      if (!loadedTracks.length) throw new Error(`${entry.title} contains no playable note tracks.`)
      const loadedFile: RecentMidiFile = {
        name: entry.fileName,
        lastModified: Date.now(),
        buffer,
      }

      const viewMode: InstrumentViewMode = entry.category === 'guitar' ? 'guitar' : 'piano'
      updateInstrumentViewMode(viewMode)
      setSongs([loadedSong])
      setSongIndex(0)
      setRecentMidiFiles([loadedFile])
      setCurrentLibraryEntry(entry)
      setUseAllTracks(loadedTracks.length > 1)
      setSelectedTrackIndexes(chooseDefaultTracks(loadedSong))
      setCurrentTime(0)
      setTempoBpm(songTempoBpm(loadedSong))
      setSettingsOpen(false)
      setCatalogOpenCategory(null)
      setCatalogActivity(`Loaded all ${loadedTracks.length} playable track${loadedTracks.length === 1 ? '' : 's'} from ${entry.sourceName}.`)
      void saveRecentMidiState({ files: [loadedFile], songIndex: 0 })
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not load ${entry.title}.`)
      setCatalogActivity('')
    } finally {
      setLibraryLoadingId('')
    }
  }

  function openMusicCatalog(category: CatalogCategory) {
    setCatalogOpenCategory(category)
    setCatalogQuery('')
    setCatalogSourceId('all')
    setCatalogPage(0)
    setCatalogActivity('')
    setSettingsOpen(false)
  }

  function chooseRandomLibrarySong(category: MusicLibraryCategory) {
    if (libraryLoadingId) return
    const entries = catalogEntries.filter((entry) => entry.category === category)
    const currentId = librarySelection[category]
    const choices = entries.length > 1 ? entries.filter((entry) => entry.id !== currentId) : entries
    const entry = choices[Math.floor(Math.random() * choices.length)]
    if (!entry) return
    setLibrarySelection((current) => ({ ...current, [category]: entry.id }))
    void loadLibraryEntry(entry)
  }

  function chooseRandomCatalogResult() {
    if (libraryLoadingId || !filteredCatalogEntries.length) return
    const entry = filteredCatalogEntries[Math.floor(Math.random() * filteredCatalogEntries.length)]
    if (!entry) return
    setLibrarySelection((current) => ({ ...current, [entry.category]: entry.id }))
    void loadLibraryEntry(entry)
  }

  async function enterLandscapePerformanceView() {
    setShowNotation(false)
    setSettingsOpen(false)
    setLandscapeMessage('Rotate your iPhone sideways for the expanded performance view.')
    const orientation = window.screen.orientation as LockableScreenOrientation | undefined
    if (!orientation?.lock) return
    try {
      await orientation.lock('landscape')
      setLandscapeMessage('Landscape performance view enabled.')
    } catch {
      // iPhone Safari currently relies on the device rotation setting instead of orientation.lock().
    }
  }

  async function activateSoundFont(
    name: string,
    buffer: ArrayBuffer,
    metadata: { size: number; lastModified: number },
  ) {
    if (!buffer.byteLength) throw new Error(`${name} is empty.`)
    stopPlayback()
    releaseAllScrubAudition()
    setError('')
    setAudioStatus(`Preparing ${name}...`)
    await Tone.start()
    soundFontEngineRef.current?.dispose()
    soundFontEngineRef.current = null
    let engine: SoundFontPlaybackEngine | null = null
    try {
      engine = getSoundFontEngine()
      await engine.load(buffer, `${name}:${buffer.byteLength}`)
      soundFontBufferRef.current = buffer
      setSoundFontName(name)
      setPlaybackInstrumentId('soundfont:custom')
      setAudioStatus(`${name} ready for playback`)
    } catch (error) {
      engine?.dispose()
      soundFontEngineRef.current = null
      throw error
    }

    try {
      await saveStoredSoundFont({
        name,
        size: metadata.size,
        lastModified: metadata.lastModified,
        buffer: buffer.slice(0),
      })
    } catch {
      setAudioStatus(`${name} ready (browser storage was full, so it was not saved)`)
    }
  }

  async function loadSoundFontFile(file: File) {
    if (!/\.(sf2|sf3|dls)$/i.test(file.name)) {
      setError('Choose an SF2, SF3, or DLS SoundFont file.')
      return
    }

    try {
      setAudioStatus(`Reading ${file.name}...`)
      const buffer = await file.arrayBuffer()
      await activateSoundFont(file.name, buffer, {
        size: file.size,
        lastModified: file.lastModified,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load that SoundFont.')
      setAudioStatus('SoundFont could not be loaded; choose a different bank')
    }
  }

  async function loadOnlineSoundFont(soundFont: OnlineSoundFont) {
    if (soundFontLoadingId) return
    setSoundFontLoadingId(soundFont.id)
    setError('')
    try {
      await Tone.start()
      const buffer = await downloadArrayBuffer([soundFont.url, soundFont.fallbackUrl ?? ''], soundFont.name, (receivedBytes, totalBytes) => {
        const effectiveTotal = totalBytes || soundFont.sizeBytes
        const percent = effectiveTotal ? Math.min(100, Math.round(receivedBytes / effectiveTotal * 100)) : 0
        setAudioStatus(`Downloading ${soundFont.name}: ${percent}% (${formatSoundFontSize(receivedBytes)})`)
      })
      await activateSoundFont(soundFont.name, buffer, {
        size: buffer.byteLength,
        lastModified: Date.now(),
      })
      setSoundFontBrowserOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not load ${soundFont.name}.`)
      setAudioStatus('SoundFont could not be loaded; Synth remains available')
    } finally {
      setSoundFontLoadingId('')
    }
  }

  function loadMatchingSoundFont() {
    const match = rankedSoundFonts[0]
    if (match) void loadOnlineSoundFont(match)
  }

  function clearSoundFont() {
    stopPlayback()
    releaseAllScrubAudition()
    soundFontEngineRef.current?.dispose()
    soundFontEngineRef.current = null
    soundFontBufferRef.current = null
    setSoundFontName('')
    setAudioStatus('')
    if (playbackInstrumentId === 'soundfont:custom') setPlaybackInstrumentId('synth')
    void removeStoredSoundFont().catch(() => undefined)
  }

  function updateTrackSlot(slot: TrackSlot, value: string) {
    stopPlayback()
    releaseAllScrubAudition()
    setCurrentTime(0)
    setUseAllTracks(false)
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
    soundFontEngineRef.current?.releaseAll()
    setAudioStatus('')
    setError('')
    setPlaybackInstrumentId(value)
  }

  function updateInstrumentViewMode(value: InstrumentViewMode) {
    stopPlayback()
    releaseAllScrubAudition()
    sampleEngineRef.current?.releaseAll()
    soundFontEngineRef.current?.releaseAll()
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

  function renderOriginalTabControl() {
    if (!hasOriginalTabPositions) return null
    return (
      <label className="toggle-field">
        <span>Use Original Tab Positions</span>
        <input
          type="checkbox"
          checked={useOriginalTabPositions}
          onChange={(event) => {
            stopPlayback()
            releaseAllScrubAudition()
            setUseOriginalTabPositions(event.target.checked)
          }}
        />
      </label>
    )
  }

  function reanalyzeSelectedTracks() {
    const trackIndexes = new Set(selectedTracks.map((track) => track.index))
    const nextSong = regenerateChordMarkers(song, { trackIndexes: trackIndexes.size ? trackIndexes : undefined })
    setSongs((current) => current.map((item, index) => (index === songIndex ? nextSong : item)))
  }

  function renderAllTracksControl() {
    if (tracks.length < 2) return null
    return (
      <label className="toggle-field all-tracks-toggle">
        <span>
          Play / display all MIDI tracks
          <small>{tracks.length} playable tracks in this file</small>
        </span>
        <input
          type="checkbox"
          checked={useAllTracks}
          onChange={(event) => {
            stopPlayback()
            releaseAllScrubAudition()
            setCurrentTime(0)
            setUseAllTracks(event.target.checked)
          }}
        />
      </label>
    )
  }

  function renderChordAnalysisControls() {
    const generated = song.markers.filter((marker) => marker.type === 'marker' && marker.source === 'analysis')
    const fileMarkers = song.markers.filter((marker) => marker.type === 'marker' && marker.source !== 'analysis')

    return (
      <div className="analysis-controls">
        <div className="analysis-summary">
          <span>Chord Markers</span>
          <strong>
            {fileMarkers.length
              ? `${fileMarkers.length} from file`
              : generated.length
                ? `${generated.length} analyzed`
                : 'None detected'}
          </strong>
        </div>
        {!fileMarkers.length && (
          <button type="button" className="button secondary" onClick={reanalyzeSelectedTracks}>
            Analyze Selected Tracks
          </button>
        )}
      </div>
    )
  }

  function renderMusicLibrary() {
    const total = catalogEntries.length
    return (
      <div className="music-library-loaders">
        <button type="button" className="button secondary library-search-button" onClick={() => openMusicCatalog('all')}>
          <Search size={17} />
          Search all {total.toLocaleString()} songs
        </button>
        {MUSIC_LIBRARY_CATEGORIES.map((category) => {
          const loading = Boolean(libraryLoadingId)
          return (
            <section className="library-loader" key={category}>
              <span className="library-loader-heading">
                <b>{MUSIC_LIBRARY_LABELS[category]}</b>
                <small>{catalogCounts[category].toLocaleString()} songs</small>
                <span className="library-source-links">
                  {MUSIC_LIBRARY_SOURCES[category].map((source) => (
                    <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                      {source.label}
                    </a>
                  ))}
                </span>
              </span>
              <div className="library-actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={!catalogCounts[category]}
                  onClick={() => openMusicCatalog(category)}
                >
                  <LibraryBig size={16} />
                  Browse collection
                </button>
                <button
                  type="button"
                  className="icon-button inline-icon-button"
                  aria-label={`Load random ${MUSIC_LIBRARY_LABELS[category]} song`}
                  title={`Random ${MUSIC_LIBRARY_LABELS[category]}`}
                  disabled={loading || !catalogCounts[category]}
                  onClick={() => chooseRandomLibrarySong(category)}
                >
                  <Dices size={19} />
                </button>
              </div>
            </section>
          )
        })}
        {catalogActivity && !catalogOpenCategory && <small className="library-license">{catalogActivity}</small>}
      </div>
    )
  }

  function renderCatalogBrowser() {
    if (!catalogOpenCategory) return null
    const heading = catalogOpenCategory === 'all' ? 'Search Song Collections' : MUSIC_LIBRARY_LABELS[catalogOpenCategory]
    const firstResult = filteredCatalogEntries.length ? catalogPage * CATALOG_PAGE_SIZE + 1 : 0
    const lastResult = Math.min(filteredCatalogEntries.length, (catalogPage + 1) * CATALOG_PAGE_SIZE)

    return (
      <div className="catalog-layer">
        <button
          type="button"
          className="catalog-backdrop"
          aria-label="Close song catalog"
          onClick={() => setCatalogOpenCategory(null)}
        />
        <section className="catalog-panel" role="dialog" aria-modal="true" aria-label={heading}>
          <header className="catalog-header">
            <div>
              <strong>{heading}</strong>
              <span>{filteredCatalogEntries.length.toLocaleString()} matching songs</span>
            </div>
            <button type="button" className="icon-button" aria-label="Close song catalog" onClick={() => setCatalogOpenCategory(null)}>
              <X size={20} />
            </button>
          </header>

          <div className="catalog-toolbar">
            <label className="catalog-search">
              <Search size={18} />
              <input
                type="search"
                value={catalogQuery}
                placeholder="Search title, composer, game, or file..."
                autoFocus
                onChange={(event) => setCatalogQuery(event.target.value)}
              />
            </label>
            <select
              aria-label="Catalog source"
              value={catalogSourceId}
              onChange={(event) => setCatalogSourceId(event.target.value)}
            >
              <option value="all">All sources</option>
              {activeCatalogSources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.label} ({source.entries.length.toLocaleString()})
                </option>
              ))}
            </select>
            <button
              type="button"
              className="button primary catalog-random-button"
              disabled={Boolean(libraryLoadingId) || !filteredCatalogEntries.length}
              onClick={chooseRandomCatalogResult}
            >
              <Dices size={18} />
              Random from results
            </button>
          </div>

          {catalogActivity && <div className="catalog-activity">{catalogActivity}</div>}

          <div className="catalog-results" aria-live="polite">
            {visibleCatalogEntries.map((entry) => (
              <button
                type="button"
                className="catalog-result"
                key={entry.id}
                disabled={Boolean(libraryLoadingId)}
                onClick={() => {
                  setLibrarySelection((current) => ({ ...current, [entry.category]: entry.id }))
                  void loadLibraryEntry(entry)
                }}
              >
                <span>
                  <strong>{entry.title}</strong>
                  <small>{entry.subtitle}</small>
                </span>
                <em>{libraryLoadingId === entry.id ? 'Loading...' : entry.sourceName}</em>
              </button>
            ))}
            {!visibleCatalogEntries.length && <div className="catalog-empty">No songs match that search.</div>}
          </div>

          <footer className="catalog-footer">
            <span>
              {firstResult.toLocaleString()}–{lastResult.toLocaleString()} of {filteredCatalogEntries.length.toLocaleString()}
            </span>
            <div className="catalog-pagination">
              <button
                type="button"
                className="icon-button"
                aria-label="Previous catalog page"
                disabled={catalogPage <= 0}
                onClick={() => setCatalogPage((page) => Math.max(0, page - 1))}
              >
                <ChevronLeft size={19} />
              </button>
              <b>
                {catalogPage + 1} / {catalogPageCount}
              </b>
              <button
                type="button"
                className="icon-button"
                aria-label="Next catalog page"
                disabled={catalogPage >= catalogPageCount - 1}
                onClick={() => setCatalogPage((page) => Math.min(catalogPageCount - 1, page + 1))}
              >
                <ChevronRight size={19} />
              </button>
            </div>
          </footer>
        </section>
      </div>
    )
  }

  function renderSoundFontControls() {
    return (
      <div className="soundfont-controls">
        <input
          ref={soundFontInputRef}
          className="soundfont-input"
          type="file"
          accept=".sf2,.sf3,.dls"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void loadSoundFontFile(file)
            event.target.value = ''
          }}
        />
        <div className="soundfont-actions">
          <button type="button" className="button secondary" onClick={() => soundFontInputRef.current?.click()}>
            <FolderOpen size={16} />
            Load Local
          </button>
          {!OFFLINE_BUILD && (
            <button
              type="button"
              className="button secondary"
              disabled={Boolean(soundFontLoadingId)}
              onClick={loadMatchingSoundFont}
            >
              {soundFontLoadingId ? 'Loading...' : `Auto-match ${rankedSoundFonts[0]?.name ?? 'Bank'}`}
            </button>
          )}
          {!OFFLINE_BUILD && (
            <button
              type="button"
              className="button secondary soundfont-browse-button"
              onClick={() => setSoundFontBrowserOpen((open) => !open)}
            >
              <Search size={16} />
              {soundFontBrowserOpen ? 'Hide Online Banks' : 'Browse Online Banks'}
            </button>
          )}
        </div>
        {soundFontBrowserOpen && !OFFLINE_BUILD && (
          <div className="soundfont-browser">
            <label className="soundfont-search">
              <Search size={15} />
              <input
                type="search"
                value={soundFontQuery}
                placeholder="Match a game, console, piano, rock..."
                onChange={(event) => setSoundFontQuery(event.target.value)}
              />
            </label>
            <div className="soundfont-results">
              {rankedSoundFonts.map((soundFont, index) => (
                <article className="soundfont-result" key={soundFont.id}>
                  <div>
                    <strong>{soundFont.name}{index === 0 ? ' · best match' : ''}</strong>
                    <span>{soundFont.description}</span>
                    <small>{formatSoundFontSize(soundFont.sizeBytes)} · {soundFont.license}</small>
                  </div>
                  <div className="soundfont-result-actions">
                    <button
                      type="button"
                      className="button secondary"
                      disabled={Boolean(soundFontLoadingId)}
                      onClick={() => void loadOnlineSoundFont(soundFont)}
                    >
                      {soundFontLoadingId === soundFont.id ? 'Loading...' : 'Load & use'}
                    </button>
                    <a href={soundFont.sourceUrl} target="_blank" rel="noreferrer">Source</a>
                  </div>
                </article>
              ))}
            </div>
            <a
              className="soundfont-database-link"
              href={`https://musical-artifacts.com/artifacts?q=${encodeURIComponent(soundFontQuery || song.title || 'General MIDI')}&formats=sf2`}
              target="_blank"
              rel="noreferrer"
            >
              Search more banks on Musical Artifacts
            </a>
          </div>
        )}
        {soundFontName && (
          <div className="soundfont-loaded">
            <span title={soundFontName}>{soundFontName}</span>
            <button type="button" onClick={clearSoundFont} aria-label="Remove loaded SoundFont">
              Remove
            </button>
          </div>
        )}
      </div>
    )
  }

  function playbackInstrumentOptionLabel(instrument: (typeof PLAYBACK_INSTRUMENTS)[number]) {
    if (instrument.id === 'soundfont:custom' && soundFontName) return `SoundFont — ${soundFontName}`
    return instrument.label
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
              duration={song.duration}
              isPlaying={isPlaying}
              onScrub={scrubTo}
              density={flowDensity}
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
        connectedFlight={connectedFlightMode}
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
        setCurrentLibraryEntry(null)
        setUseAllTracks(false)
        setSelectedTrackIndexes(chooseDefaultTracks(DEMO_SONG))
        setCurrentTime(0)
        setTempoBpm(songTempoBpm(DEMO_SONG))
        setSettingsOpen(false)
        return
      }

      const entry = exampleSongs.find((item) => item.id === value)
      if (!entry) return
      const loaded = await loadExampleSong(entry)
      const analyzedSong = withAnalyzedChordMarkers(loaded.song)
      const loadedFile: RecentMidiFile = {
        name: `${entry.title}.mid`,
        lastModified: Date.now(),
        buffer: loaded.buffer,
      }
      setSongs([analyzedSong])
      setSongIndex(0)
      setRecentMidiFiles([loadedFile])
      setCurrentLibraryEntry(null)
      setUseAllTracks(false)
      setSelectedTrackIndexes(chooseDefaultTracks(analyzedSong))
      setCurrentTime(0)
      setTempoBpm(songTempoBpm(analyzedSong))
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
        {renderCatalogBrowser()}
        <header className="desktop-header">
          <div className="brand" aria-label={APP_NAME}>
            <div className="brand-mark">
              <Guitar size={23} strokeWidth={2.2} />
            </div>
            <h1>{APP_NAME}</h1>
          </div>

          <div className="desktop-song-summary">
            <strong>{song.title}</strong>
            {currentChord && <span>{currentChord}</span>}
          </div>

          <div className="desktop-header-actions">
            <input
              ref={fileInputRef}
              type="file"
              accept=".mid,.midi,.gp,.gp3,.gp4,.gp5,.gpx,.musicxml,.mxl,.xml,audio/midi"
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
              aria-label={showNotation ? 'Hide sheet music or tab' : 'Show sheet music or tab'}
              title={showNotation ? 'Hide sheet music or tab' : 'Show sheet music or tab'}
              onClick={() => setShowNotation((visible) => !visible)}
            >
              {showNotation ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
            <button type="button" className="button secondary desktop-action-button" onClick={() => fileInputRef.current?.click()}>
              <FolderOpen size={18} />
              Open Music File
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
              {renderMusicLibrary()}
              <label className="field">
                <span>
                  <FileMusic size={15} />
                  {OFFLINE_BUILD ? 'Local Example Song' : 'Load Example Song'}
                </span>
                <div className="select-action-row">
                  <select
                    value=""
                    disabled={exampleLoading}
                    onChange={(event) => void chooseExampleSong(event.target.value)}
                  >
                    <option value="">
                      {exampleLoading ? 'Loading...' : OFFLINE_BUILD ? 'Choose local example...' : 'Choose example...'}
                    </option>
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
              {renderAllTracksControl()}
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
                        disabled={useAllTracks}
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
              {renderChordAnalysisControls()}
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

              <label className="toggle-field">
                <span>Show Sheet / Tab</span>
                <input type="checkbox" checked={showNotation} onChange={(event) => setShowNotation(event.target.checked)} />
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
                      {playbackInstrumentOptionLabel(instrument)}
                    </option>
                  ))}
                </select>
              </label>

              {renderSoundFontControls()}

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

          <section className="desktop-stage" data-notation={showNotation ? 'shown' : 'hidden'} aria-label="Desktop MIDI views">
            {showNotation && renderNotationView()}
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
                data-flight-mode={connectedFlightMode ? 'connected' : undefined}
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
                  {renderOriginalTabControl()}

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
      {renderCatalogBrowser()}
      <header className="app-header">
        <div className="brand" aria-label={APP_NAME}>
          <div className="brand-mark">
            <Guitar size={23} strokeWidth={2.2} />
          </div>
          <h1>{APP_NAME}</h1>
        </div>

        <div className="song-heading">
          <strong>{song.title}</strong>
          {currentChord && <span>{currentChord}</span>}
        </div>

        <div className="header-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".mid,.midi,.gp,.gp3,.gp4,.gp5,.gpx,.musicxml,.mxl,.xml,audio/midi"
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
            aria-label={showNotation ? 'Hide sheet music or tab' : 'Show sheet music or tab'}
            onClick={() => setShowNotation((visible) => !visible)}
          >
            {showNotation ? <EyeOff size={20} /> : <Eye size={20} />}
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
              Open Music File
            </button>

            {renderMusicLibrary()}

            <label className="field">
              <span>
                <FileMusic size={15} />
                {OFFLINE_BUILD ? 'Local Example Song' : 'Load Example Song'}
              </span>
              <div className="select-action-row">
                <select
                  value=""
                  disabled={exampleLoading}
                  onChange={(event) => void chooseExampleSong(event.target.value)}
                >
                  <option value="">
                    {exampleLoading ? 'Loading...' : OFFLINE_BUILD ? 'Choose local example...' : 'Choose example...'}
                  </option>
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

            {renderAllTracksControl()}

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
                      disabled={useAllTracks}
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

            {renderChordAnalysisControls()}

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

            <label className="toggle-field">
              <span>Show Sheet / Tab</span>
              <input type="checkbox" checked={showNotation} onChange={(event) => setShowNotation(event.target.checked)} />
            </label>

            <button type="button" className="button secondary landscape-button" onClick={() => void enterLandscapePerformanceView()}>
              <RectangleHorizontal size={18} />
              Landscape Performance View
            </button>
            {landscapeMessage && <small className="landscape-message">{landscapeMessage}</small>}

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
                {renderOriginalTabControl()}

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
                    {playbackInstrumentOptionLabel(instrument)}
                  </option>
                ))}
              </select>
            </label>

            {renderSoundFontControls()}

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
        data-flight-mode={connectedFlightMode ? 'connected' : undefined}
        data-notation={showNotation ? 'shown' : 'hidden'}
        style={{ '--instrument-height': `${instrumentHeight}%` } as CSSProperties}
      >
        {showNotation && renderNotationView()}
        {renderMidiFlowView()}
        <section
          className="neck-panel"
          data-neck-theme={fretboardTheme}
          data-view-mode={instrumentViewMode}
          data-flight-mode={connectedFlightMode ? 'connected' : undefined}
          aria-label={liveInstrumentAriaLabel()}
        >
          {renderLiveInstrument(desktopSizing || connectedFlightMode)}
        </section>
      </main>
    </div>
  )
}

export default App
