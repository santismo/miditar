import { parseMidiFile, type ParsedMidi } from './midi'

export type ExampleSongEntry = {
  title: string
  file: string
  size?: number
}

const EXAMPLE_MANIFEST_URL = `${import.meta.env.BASE_URL}examples/manifest.json`

function exampleUrl(file: string) {
  return `${import.meta.env.BASE_URL}${file.replace(/^\/+/, '')}`
}

export async function loadExampleSongManifest() {
  const response = await fetch(EXAMPLE_MANIFEST_URL, { cache: 'no-cache' })
  if (!response.ok) return []
  const value = (await response.json()) as unknown
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is ExampleSongEntry => {
      if (!item || typeof item !== 'object') return false
      const candidate = item as Partial<ExampleSongEntry>
      return typeof candidate.title === 'string' && typeof candidate.file === 'string'
    })
    .sort((a, b) => a.title.localeCompare(b.title))
}

export async function loadExampleSong(entry: ExampleSongEntry): Promise<{ song: ParsedMidi; buffer: ArrayBuffer }> {
  const response = await fetch(exampleUrl(entry.file))
  if (!response.ok) throw new Error(`Could not load ${entry.title}.`)
  const buffer = await response.arrayBuffer()
  return {
    song: parseMidiFile(buffer.slice(0), entry.title),
    buffer,
  }
}
