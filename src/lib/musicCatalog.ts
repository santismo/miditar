import { MUSIC_LIBRARY, type MusicLibraryCategory } from './musicLibrary'

export type MusicCatalogDelivery = 'direct' | 'archive'

export type MusicCatalogSource = {
  id: string
  category: MusicLibraryCategory
  label: string
  description: string
  license: string
  sourceUrl: string
  delivery: MusicCatalogDelivery
  rawBase?: string
  archiveUrl?: string
  entries: Array<{
    path: string
    title: string
    subtitle: string
  }>
}

export type MusicCatalogManifest = {
  version: number
  generatedAt: string
  sources: MusicCatalogSource[]
}

export type MusicCatalogEntry = {
  id: string
  category: MusicLibraryCategory
  title: string
  subtitle: string
  fileName: string
  path: string
  delivery: MusicCatalogDelivery
  url?: string
  archiveUrl?: string
  sourceId: string
  sourceName: string
  sourceUrl: string
  license: string
}

function encodedPath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/')
}

export function flattenMusicCatalog(manifest: MusicCatalogManifest): MusicCatalogEntry[] {
  return manifest.sources.flatMap((source) =>
    source.entries.map((entry) => ({
      id: `${source.id}:${entry.path}`,
      category: source.category,
      title: entry.title,
      subtitle: entry.subtitle,
      fileName: entry.path.split('/').at(-1) ?? `${source.id}.mid`,
      path: entry.path,
      delivery: source.delivery,
      url: source.rawBase ? `${source.rawBase}/${encodedPath(entry.path)}` : undefined,
      archiveUrl: source.archiveUrl,
      sourceId: source.id,
      sourceName: source.label,
      sourceUrl: source.sourceUrl,
      license: source.license,
    })),
  )
}

export async function loadMusicCatalog() {
  const response = await fetch(`${import.meta.env.BASE_URL}music-catalogs/catalog.json`)
  if (!response.ok) throw new Error(`Music catalog returned ${response.status}.`)
  const manifest = (await response.json()) as MusicCatalogManifest
  if (manifest.version !== 1 || !Array.isArray(manifest.sources)) {
    throw new Error('Music catalog format is not supported.')
  }
  return manifest
}

export function fallbackMusicCatalog(): MusicCatalogEntry[] {
  return MUSIC_LIBRARY.map((entry) => ({
    ...entry,
    path: entry.fileName,
    delivery: 'direct' as const,
    sourceId: entry.sourceName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  }))
}
