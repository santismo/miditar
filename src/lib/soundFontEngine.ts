type SpessaModule = typeof import('spessasynth_lib')
type WorkletSynth = InstanceType<SpessaModule['WorkletSynthesizer']>

const PROCESSOR_URL = `${import.meta.env.BASE_URL}spessasynth_processor.min.js`
const PROCESSOR_LOADS = new WeakMap<BaseAudioContext, Promise<void>>()
const COMPACT_OUTPUT_CHANNELS = 32
const SOUND_FONT_VOICE_CAP = 128
const COMPACT_SOUND_FONT_VOICE_CAP = 64

async function ensureProcessor(context: AudioContext) {
  if (context.state === 'closed') throw new Error('The audio session was closed. Tap Play to start a new one.')
  if (context.state === 'suspended') await context.resume()

  const existingLoad = PROCESSOR_LOADS.get(context)
  if (existingLoad) return existingLoad

  const load = context.audioWorklet.addModule(PROCESSOR_URL)
  PROCESSOR_LOADS.set(context, load)
  try {
    await load
  } catch (error) {
    PROCESSOR_LOADS.delete(context)
    throw error
  }
}

function needsCompactAudioGraph() {
  const userAgent = navigator.userAgent
  return (
    /iPad|iPhone|iPod/.test(userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

function workletError(error: unknown) {
  const outer = error instanceof Error ? error : null
  const cause = outer?.cause instanceof Error ? outer.cause : outer
  const detail = cause ? `${cause.name}: ${cause.message}` : 'AudioWorklet could not start.'
  return new Error(
    `SoundFont audio could not start (${detail}). Close other audio apps, return to Miditar, and tap Play again.`,
    { cause: error },
  )
}

function interruptedError() {
  return new DOMException('The audio session was interrupted. Tap Play to resume.', 'AbortError')
}

export class SoundFontPlaybackEngine {
  readonly context: AudioContext
  private synth: WorkletSynth | null = null
  private bankId = ''
  private readonly programs = new Map<number, number>()
  private outputNodes: AudioNode[] = []
  private loadPromise: Promise<void> | null = null
  private generation = 0

  constructor(context: AudioContext) {
    this.context = context
  }

  async load(buffer: ArrayBuffer, bankId: string) {
    if (this.synth && this.bankId === bankId) return
    if (this.loadPromise) {
      await this.loadPromise
      if (this.synth && this.bankId === bankId) return
    }

    const load = this.loadInternal(buffer, bankId)
    this.loadPromise = load
    try {
      await load
    } finally {
      if (this.loadPromise === load) {
        this.loadPromise = null
      }
    }
  }

  private async loadInternal(buffer: ArrayBuffer, bankId: string) {
    this.dispose()
    const generation = this.generation
    await ensureProcessor(this.context)
    if (generation !== this.generation) throw interruptedError()
    const { WorkletSynthesizer } = await import('spessasynth_lib')
    const compact = needsCompactAudioGraph()
    let compactWorklet: AudioWorkletNode | null = null
    let synth: WorkletSynth | null = null

    try {
      synth = new WorkletSynthesizer(
        this.context,
        compact
          ? {
              oneOutput: true,
              audioNodeCreators: {
                worklet: (context, name, options) => {
                  compactWorklet = new AudioWorkletNode(context, name, {
                    ...options,
                    numberOfOutputs: 1,
                    outputChannelCount: [COMPACT_OUTPUT_CHANNELS],
                  })
                  return compactWorklet
                },
              },
            }
          : undefined,
      )

      if (compact && compactWorklet) this.connectCompactOutput(compactWorklet)
      else synth.connect(this.context.destination)
    } catch (error) {
      synth?.destroy()
      this.disconnectOutputNodes()
      if (generation !== this.generation) throw interruptedError()
      throw workletError(error)
    }

    try {
      await synth.soundBankManager.addSoundBank(buffer.slice(0), bankId)
      await synth.isReady
      if (generation !== this.generation) throw interruptedError()
      synth.setSystemParameter(
        'voiceCap',
        compact ? COMPACT_SOUND_FONT_VOICE_CAP : SOUND_FONT_VOICE_CAP,
      )
      synth.setSystemParameter('autoAllocateVoices', false)
      synth.midiChannels[9]?.setDrums(true)
      this.synth = synth
      this.bankId = bankId
    } catch (error) {
      synth.destroy()
      this.disconnectOutputNodes()
      throw error
    }
  }

  private connectCompactOutput(worklet: AudioWorkletNode) {
    const splitter = this.context.createChannelSplitter(COMPACT_OUTPUT_CHANNELS)
    const merger = this.context.createChannelMerger(2)
    const output = this.context.createGain()
    output.gain.value = 0.25
    worklet.connect(splitter)
    for (let channel = 0; channel < COMPACT_OUTPUT_CHANNELS; channel += 2) {
      splitter.connect(merger, channel, 0)
      splitter.connect(merger, channel + 1, 1)
    }
    merger.connect(output)
    output.connect(this.context.destination)
    this.outputNodes = [splitter, merger, output]
  }

  triggerAttack(channel: number, midi: number, velocity: number, program = 0, time?: number) {
    const synth = this.synth
    if (!synth) return
    const safeChannel = Math.min(15, Math.max(0, channel))
    const safeProgram = Math.min(127, Math.max(0, program))
    const eventOptions = time === undefined ? undefined : { time }
    if (safeChannel !== 9 && this.programs.get(safeChannel) !== safeProgram) {
      synth.programChange(safeChannel, safeProgram, eventOptions)
      this.programs.set(safeChannel, safeProgram)
    }
    synth.noteOn(
      safeChannel,
      Math.min(127, Math.max(0, midi)),
      Math.min(127, Math.max(1, Math.round(velocity * 127))),
      eventOptions,
    )
  }

  triggerRelease(channel: number, midi: number, time?: number) {
    this.synth?.noteOff(
      Math.min(15, Math.max(0, channel)),
      Math.min(127, Math.max(0, midi)),
      time === undefined ? undefined : { time },
    )
  }

  triggerAttackRelease(
    channel: number,
    midi: number,
    duration: number,
    velocity: number,
    program = 0,
    time = this.context.currentTime,
  ) {
    this.triggerAttack(channel, midi, velocity, program, time)
    this.triggerRelease(channel, midi, time + duration)
  }

  releaseAll() {
    this.synth?.stopAll(true)
  }

  dispose() {
    this.generation += 1
    this.programs.clear()
    this.synth?.stopAll(true)
    this.synth?.destroy()
    this.synth = null
    this.bankId = ''
    this.disconnectOutputNodes()
  }

  handleContextInterruption() {
    this.dispose()
    PROCESSOR_LOADS.delete(this.context)
  }

  private disconnectOutputNodes() {
    for (const node of this.outputNodes) node.disconnect()
    this.outputNodes = []
  }
}
