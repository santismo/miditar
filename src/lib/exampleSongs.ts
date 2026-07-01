import { parseMidiFile, type ParsedMidi } from './midi'

export type ExampleSongEntry = {
  id: string
  title: string
  url: string
  size?: number
}

const GITHUB_REPO = 'santismo/miditar'
const EXAMPLE_FOLDER_NAME = 'example midi songs'
const ENCODED_EXAMPLE_FOLDER = encodeURIComponent(EXAMPLE_FOLDER_NAME)
const JSDELIVR_FLAT_LIST_URL = `https://data.jsdelivr.com/v1/package/gh/${GITHUB_REPO}@main/flat?structure=flat`
const JSDELIVR_RAW_BASE_URL = `https://cdn.jsdelivr.net/gh/${GITHUB_REPO}@main`
const EXAMPLE_SONG_DIRECTORIES = [
  `https://api.github.com/repos/${GITHUB_REPO}/contents/public/${ENCODED_EXAMPLE_FOLDER}?ref=main`,
  `https://api.github.com/repos/${GITHUB_REPO}/contents/${ENCODED_EXAMPLE_FOLDER}?ref=gh-pages`,
  `https://api.github.com/repos/${GITHUB_REPO}/contents/${ENCODED_EXAMPLE_FOLDER}?ref=main`,
]

type GitHubContentItem = {
  name?: unknown
  path?: unknown
  type?: unknown
  download_url?: unknown
  size?: unknown
}

type JsDelivrFileItem = {
  name?: unknown
  size?: unknown
}

type JsDelivrFlatList = {
  files?: unknown
}

function titleFromFileName(name: string) {
  return (
    name
      .replace(/\.(mid|midi)$/i, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || name
  )
}

function isMidiFileName(name: string) {
  return /\.(mid|midi)$/i.test(name)
}

function fileNameFromPath(path: string) {
  return path.split('/').filter(Boolean).at(-1) || path
}

function encodePath(path: string) {
  return path
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
}

async function loadGitHubDirectory(url: string): Promise<ExampleSongEntry[]> {
  const response = await fetch(url, {
    cache: 'no-cache',
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!response.ok) return []

  const value = (await response.json()) as unknown
  if (!Array.isArray(value)) return []

  return value.flatMap((item): ExampleSongEntry[] => {
    if (!item || typeof item !== 'object') return []
    const candidate = item as GitHubContentItem
    if (candidate.type !== 'file') return []
    if (typeof candidate.name !== 'string' || !isMidiFileName(candidate.name)) return []
    if (typeof candidate.download_url !== 'string') return []

    return [
      {
        id: typeof candidate.path === 'string' ? candidate.path : candidate.download_url,
        title: titleFromFileName(candidate.name),
        url: candidate.download_url,
        size: typeof candidate.size === 'number' ? candidate.size : undefined,
      },
    ]
  })
}

async function loadJsDelivrDirectory(): Promise<ExampleSongEntry[]> {
  const response = await fetch(JSDELIVR_FLAT_LIST_URL, { cache: 'no-cache' })
  if (!response.ok) return []

  const value = (await response.json()) as JsDelivrFlatList
  if (!Array.isArray(value.files)) return []

  const publicFolderPath = `/public/${EXAMPLE_FOLDER_NAME}/`
  return value.files.flatMap((item): ExampleSongEntry[] => {
    if (!item || typeof item !== 'object') return []
    const candidate = item as JsDelivrFileItem
    if (typeof candidate.name !== 'string') return []
    if (!candidate.name.startsWith(publicFolderPath) || !isMidiFileName(candidate.name)) return []

    const fileName = fileNameFromPath(candidate.name)
    return [
      {
        id: candidate.name,
        title: titleFromFileName(fileName),
        url: `${JSDELIVR_RAW_BASE_URL}${encodePath(candidate.name)}`,
        size: typeof candidate.size === 'number' ? candidate.size : undefined,
      },
    ]
  })
}

export async function loadExampleSongs() {
  const directories = await Promise.all([
    ...EXAMPLE_SONG_DIRECTORIES.map((url) => loadGitHubDirectory(url)),
    loadJsDelivrDirectory(),
  ])
  const entriesByName = new Map<string, ExampleSongEntry>()

  for (const entry of directories.flat()) {
    const key = entry.title.toLocaleLowerCase()
    if (!entriesByName.has(key)) entriesByName.set(key, entry)
  }

  return [...entriesByName.values()].sort((a, b) => a.title.localeCompare(b.title))
}

export async function loadExampleSong(entry: ExampleSongEntry): Promise<{ song: ParsedMidi; buffer: ArrayBuffer }> {
  const response = await fetch(entry.url)
  if (!response.ok) throw new Error(`Could not load ${entry.title}.`)
  const buffer = await response.arrayBuffer()
  return {
    song: parseMidiFile(buffer.slice(0), entry.title),
    buffer,
  }
}
