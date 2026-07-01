export type StringChannelMap = [number, number, number, number, number, number]

export type StringChannelPresetId = 'miditar-11' | 'low-e-1' | 'high-e-1' | 'custom'

export type StringChannelPreset = {
  id: StringChannelPresetId
  label: string
  channels: StringChannelMap
}

export const STRING_CHANNEL_STRINGS = [
  { index: 5, label: 'Low E' },
  { index: 4, label: 'A' },
  { index: 3, label: 'D' },
  { index: 2, label: 'G' },
  { index: 1, label: 'B' },
  { index: 0, label: 'High E' },
]

export const DEFAULT_STRING_CHANNEL_MAP: StringChannelMap = [11, 12, 13, 14, 15, 16]

export const STRING_CHANNEL_PRESETS: StringChannelPreset[] = [
  {
    id: 'miditar-11',
    label: 'High E 11-16',
    channels: DEFAULT_STRING_CHANNEL_MAP,
  },
  {
    id: 'low-e-1',
    label: 'Low E 1-6',
    channels: [6, 5, 4, 3, 2, 1],
  },
  {
    id: 'high-e-1',
    label: 'High E 1-6 / Low E 6',
    channels: [1, 2, 3, 4, 5, 6],
  },
]

export function clampMidiChannel(channel: number) {
  if (!Number.isFinite(channel)) return 1
  return Math.min(16, Math.max(1, Math.round(channel)))
}

export function normalizeStringChannelMap(channels: readonly number[]): StringChannelMap {
  return [
    clampMidiChannel(channels[0] ?? DEFAULT_STRING_CHANNEL_MAP[0]),
    clampMidiChannel(channels[1] ?? DEFAULT_STRING_CHANNEL_MAP[1]),
    clampMidiChannel(channels[2] ?? DEFAULT_STRING_CHANNEL_MAP[2]),
    clampMidiChannel(channels[3] ?? DEFAULT_STRING_CHANNEL_MAP[3]),
    clampMidiChannel(channels[4] ?? DEFAULT_STRING_CHANNEL_MAP[4]),
    clampMidiChannel(channels[5] ?? DEFAULT_STRING_CHANNEL_MAP[5]),
  ]
}

export function stringIndexForChannel(channels: StringChannelMap, channel: number) {
  return channels.findIndex((mappedChannel) => mappedChannel === channel)
}

export function presetById(id: StringChannelPresetId) {
  return STRING_CHANNEL_PRESETS.find((preset) => preset.id === id) ?? STRING_CHANNEL_PRESETS[0]
}
