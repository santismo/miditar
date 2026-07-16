type SpessaModule = typeof import('spessasynth_lib')
type WorkletSynth = InstanceType<SpessaModule['WorkletSynthesizer']>

const PROCESSOR_URL = `${import.meta.env.BASE_URL}spessasynth_processor.min.js`
const PROCESSOR_CONTEXTS = new WeakSet<BaseAudioContext>()

async function ensureProcessor(context: AudioContext) {
  if (PROCESSOR_CONTEXTS.has(context)) return
  await context.audioWorklet.addModule(PROCESSOR_URL)
  PROCESSOR_CONTEXTS.add(context)
}

export class SoundFontPlaybackEngine {
  readonly context: AudioContext
  private synth: WorkletSynth | null = null
  private bankId = ''
  private readonly programs = new Map<number, number>()

  constructor(context: AudioContext) {
    this.context = context
  }

  async load(buffer: ArrayBuffer, bankId: string) {
    if (this.synth && this.bankId === bankId) return
    this.dispose()
    await ensureProcessor(this.context)
    const { WorkletSynthesizer } = await import('spessasynth_lib')
    const synth = new WorkletSynthesizer(this.context)
    synth.connect(this.context.destination)
    await synth.soundBankManager.addSoundBank(buffer.slice(0), bankId)
    await synth.isReady
    synth.midiChannels[9]?.setDrums(true)
    this.synth = synth
    this.bankId = bankId
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
    this.programs.clear()
    this.synth?.stopAll(true)
    this.synth?.destroy()
    this.synth = null
    this.bankId = ''
  }
}
