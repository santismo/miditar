import { OFFLINE_BUILD } from './buildMode'

export type PlaybackInstrumentId =
  | 'synth'
  | 'sample:guitar-acoustic'
  | 'sample:guitar-nylon'
  | 'sample:guitar-electric'
  | 'sample:bass-electric'
  | 'sample:piano'

export type PlaybackInstrument = {
  id: PlaybackInstrumentId
  label: string
}

type SampleMap = Record<string, string>

type LoadedSample = {
  buffer: AudioBuffer
  midi: number
}

type SampleVoice = {
  stop: (time?: number) => void
}

const TONE_SAMPLE_BASE_URL = 'https://nbrosowsky.github.io/tonejs-instruments/samples/'

const TONE_SAMPLE_MAPS: Record<Exclude<PlaybackInstrumentId, 'synth'>, { instrument: string; map: SampleMap }> = {
  'sample:guitar-acoustic': {
    instrument: 'guitar-acoustic',
    map: {
      D2: 'D2.mp3',
      F2: 'F2.mp3',
      A2: 'A2.mp3',
      'D#3': 'Ds3.mp3',
      G3: 'G3.mp3',
      C4: 'C4.mp3',
      F4: 'F4.mp3',
      'A#4': 'As4.mp3',
    },
  },
  'sample:guitar-nylon': {
    instrument: 'guitar-nylon',
    map: {
      'F#2': 'Fs2.mp3',
      G3: 'G3.mp3',
      B3: 'B3.mp3',
      'D#4': 'Ds4.mp3',
      'C#5': 'Cs5.mp3',
      E5: 'E5.mp3',
      'G#5': 'Gs5.mp3',
      A5: 'A5.mp3',
    },
  },
  'sample:guitar-electric': {
    instrument: 'guitar-electric',
    map: {
      E2: 'E2.mp3',
      C3: 'C3.mp3',
      'D#3': 'Ds3.mp3',
      A3: 'A3.mp3',
      'F#4': 'Fs4.mp3',
      C6: 'C6.mp3',
    },
  },
  'sample:bass-electric': {
    instrument: 'bass-electric',
    map: {
      'A#1': 'As1.mp3',
      'A#3': 'As3.mp3',
      'C#1': 'Cs1.mp3',
      'C#3': 'Cs3.mp3',
      E1: 'E1.mp3',
      E3: 'E3.mp3',
      G1: 'G1.mp3',
      G3: 'G3.mp3',
    },
  },
  'sample:piano': {
    instrument: 'piano',
    map: {
      C1: 'C1.mp3',
      'D#1': 'Ds1.mp3',
      'F#2': 'Fs2.mp3',
      'C#4': 'Cs4.mp3',
      'A#4': 'As4.mp3',
      E5: 'E5.mp3',
      G6: 'G6.mp3',
      A7: 'A7.mp3',
    },
  },
}

export const PLAYBACK_INSTRUMENTS: PlaybackInstrument[] = OFFLINE_BUILD
  ? [{ id: 'synth', label: 'Offline Synth' }]
  : [
      { id: 'sample:guitar-acoustic', label: 'Acoustic Guitar' },
      { id: 'sample:guitar-nylon', label: 'Nylon Guitar' },
      { id: 'sample:guitar-electric', label: 'Electric Guitar' },
      { id: 'sample:bass-electric', label: 'Electric Bass' },
      { id: 'sample:piano', label: 'Piano' },
      { id: 'synth', label: 'Synth' },
    ]

function toneNoteToMidi(note: string) {
  const match = note.match(/^([A-G])(#?)(-?\d+)$/)
  if (!match) return 60
  const pitchClasses: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
  return (Number(match[3]) + 1) * 12 + pitchClasses[match[1]] + (match[2] ? 1 : 0)
}

function sampleUrl(instrument: string, file: string) {
  return `${TONE_SAMPLE_BASE_URL}${encodeURIComponent(instrument)}/${encodeURIComponent(file)}`
}

function nearestSample(samples: Map<string, LoadedSample>, midi: number) {
  let best: LoadedSample | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const sample of samples.values()) {
    const distance = Math.abs(sample.midi - midi)
    if (distance < bestDistance) {
      best = sample
      bestDistance = distance
    }
  }
  return best
}

async function decodeAudio(context: AudioContext, data: ArrayBuffer) {
  const copy = data.slice(0)
  const decoded = context.decodeAudioData(copy)
  if (decoded instanceof Promise) return decoded
  return new Promise<AudioBuffer>((resolve, reject) => {
    context.decodeAudioData(copy, resolve, reject)
  })
}

class ToneSampleInstrument {
  private readonly context: AudioContext
  private readonly output: GainNode
  private readonly samples = new Map<string, LoadedSample>()
  private readonly readyPromise: Promise<void>

  constructor(
    context: AudioContext,
    id: Exclude<PlaybackInstrumentId, 'synth'>,
    onProgress?: (loaded: number, total: number) => void,
  ) {
    this.context = context
    const definition = TONE_SAMPLE_MAPS[id]
    this.output = context.createGain()
    this.output.gain.value = 0.84
    this.output.connect(context.destination)

    const entries = Object.entries(definition.map)
    let loaded = 0
    this.readyPromise = Promise.all(
      entries.map(async ([note, file]) => {
        const response = await fetch(sampleUrl(definition.instrument, file))
        if (!response.ok) throw new Error(`Sample ${response.status}`)
        const buffer = await decodeAudio(context, await response.arrayBuffer())
        this.samples.set(note, { buffer, midi: toneNoteToMidi(note) })
        loaded += 1
        onProgress?.(loaded, entries.length)
      }),
    ).then(() => undefined)
  }

  ready() {
    return this.readyPromise
  }

  start(voiceId: string, midi: number, time: number, duration: number, velocity: number, onEnded: () => void) {
    const sample = nearestSample(this.samples, midi)
    if (!sample) return null

    const startTime = Math.max(this.context.currentTime + 0.006, time)
    const safeDuration = Math.max(0.06, duration)
    const release = Math.min(0.18, Math.max(0.045, safeDuration * 0.18))
    const gainLevel = Math.max(0.04, Math.min(1, velocity))
    const source = this.context.createBufferSource()
    const envelope = this.context.createGain()

    source.buffer = sample.buffer
    source.playbackRate.setValueAtTime(2 ** ((midi - sample.midi) / 12), startTime)
    envelope.gain.setValueAtTime(0.0001, startTime)
    envelope.gain.linearRampToValueAtTime(gainLevel, startTime + 0.008)
    envelope.gain.setValueAtTime(gainLevel, Math.max(startTime + 0.01, startTime + safeDuration - release))
    envelope.gain.linearRampToValueAtTime(0.0001, startTime + safeDuration)
    source.connect(envelope)
    envelope.connect(this.output)
    source.onended = onEnded
    source.start(startTime)
    source.stop(startTime + safeDuration + 0.04)

    let stopped = false
    const voice: SampleVoice = {
      stop: (time = this.context.currentTime) => {
        if (stopped) return
        stopped = true
        const stopAt = Math.max(this.context.currentTime + 0.006, startTime + 0.006, time)
        envelope.gain.cancelScheduledValues(stopAt)
        envelope.gain.setTargetAtTime(0.0001, stopAt, 0.025)
        try {
          source.stop(stopAt + 0.12)
        } catch {
          onEnded()
        }
      },
    }

    return { id: voiceId, voice }
  }

  dispose() {
    this.output.disconnect()
  }
}

export class SamplePlaybackEngine {
  readonly context: AudioContext
  private readonly instruments = new Map<Exclude<PlaybackInstrumentId, 'synth'>, Promise<ToneSampleInstrument>>()
  private readonly activeVoices = new Map<string, SampleVoice>()

  constructor(context: AudioContext) {
    this.context = context
  }

  async load(id: Exclude<PlaybackInstrumentId, 'synth'>, onProgress?: (loaded: number, total: number) => void) {
    let promise = this.instruments.get(id)
    if (!promise) {
      promise = Promise.resolve(new ToneSampleInstrument(this.context, id, onProgress)).then(async (instrument) => {
        await instrument.ready()
        return instrument
      })
      this.instruments.set(id, promise)
    }
    return promise
  }

  async triggerAttackRelease(
    instrumentId: Exclude<PlaybackInstrumentId, 'synth'>,
    voiceId: string,
    midi: number,
    time: number,
    duration: number,
    velocity: number,
  ) {
    const instrument = await this.load(instrumentId)
    this.triggerLoadedVoice(instrument, voiceId, midi, time, duration, velocity)
  }

  async triggerAttack(
    instrumentId: Exclude<PlaybackInstrumentId, 'synth'>,
    voiceId: string,
    midi: number,
    time: number,
    velocity: number,
  ) {
    const instrument = await this.load(instrumentId)
    this.triggerLoadedVoice(instrument, voiceId, midi, time, 8, velocity)
  }

  triggerRelease(voiceId: string, time = this.context.currentTime) {
    this.activeVoices.get(voiceId)?.stop(time)
    this.activeVoices.delete(voiceId)
  }

  releaseAll(time = this.context.currentTime) {
    for (const voiceId of this.activeVoices.keys()) {
      this.triggerRelease(voiceId, time)
    }
  }

  dispose() {
    this.releaseAll()
    for (const instrument of this.instruments.values()) {
      void instrument.then((item) => item.dispose())
    }
    this.instruments.clear()
  }

  private triggerLoadedVoice(
    instrument: ToneSampleInstrument,
    voiceId: string,
    midi: number,
    time: number,
    duration: number,
    velocity: number,
  ) {
    this.triggerRelease(voiceId, time)
    const started = instrument.start(voiceId, midi, time, duration, velocity, () => {
      this.activeVoices.delete(voiceId)
    })
    if (started) this.activeVoices.set(started.id, started.voice)
  }
}

export function isSampleInstrument(id: PlaybackInstrumentId): id is Exclude<PlaybackInstrumentId, 'synth'> {
  return !OFFLINE_BUILD && id !== 'synth'
}

export function playbackInstrumentLabel(id: PlaybackInstrumentId) {
  return PLAYBACK_INSTRUMENTS.find((instrument) => instrument.id === id)?.label ?? 'Synth'
}
