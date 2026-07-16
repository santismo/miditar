import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { parseSupportedMusicFile } from '../src/lib/tabImport.ts'
import type { MusicCatalogManifest } from '../src/lib/musicCatalog.ts'

const catalog = JSON.parse(await readFile('public/music-catalogs/catalog.json', 'utf8')) as MusicCatalogManifest

for (const sourceId of ['classtab', 'musetrainer', 'asap-scores']) {
  const source = catalog.sources.find((candidate) => candidate.id === sourceId)
  if (!source?.rawBase) throw new Error(`${sourceId} source is missing`)
  const entry = source.entries[Math.min(2, source.entries.length - 1)]
  const path = entry.path.split('/').map(encodeURIComponent).join('/')
  const response = await fetch(`${source.rawBase}/${path}`)
  if (!response.ok) throw new Error(`${sourceId} returned ${response.status}`)
  const parsed = await parseSupportedMusicFile(await response.arrayBuffer(), entry.path.split('/').at(-1))
  const noteCount = parsed.tracks.reduce((sum, track) => sum + track.notes.length, 0)
  if (!noteCount) throw new Error(`${sourceId} fixture contained no notes`)
  console.log(`${sourceId}: ${entry.title} · ${noteCount} notes`)
}

const archiveSource = catalog.sources.find((candidate) => candidate.id === 'game-midis')
if (!archiveSource?.archiveUrl) throw new Error('Game archive source is missing')
const archiveResponse = await fetch(archiveSource.archiveUrl)
if (!archiveResponse.ok) throw new Error(`Game archive returned ${archiveResponse.status}`)
const archive = await JSZip.loadAsync(await archiveResponse.arrayBuffer())
const gameEntry = archiveSource.entries.find((entry) => entry.path.startsWith('Actraiser/'))
if (!gameEntry) throw new Error('Game archive fixture is missing')
const zippedMidi = archive.file(gameEntry.path)
if (!zippedMidi) throw new Error(`${gameEntry.path} is missing from the game archive`)
const parsedGame = await parseSupportedMusicFile(await zippedMidi.async('arraybuffer'), gameEntry.path.split('/').at(-1))
const gameNoteCount = parsedGame.tracks.reduce((sum, track) => sum + track.notes.length, 0)
if (!gameNoteCount) throw new Error('Game archive fixture contained no notes')
console.log(`game-midis: ${gameEntry.subtitle} / ${gameEntry.title} · ${gameNoteCount} notes`)

for (const query of ['mozart', 'joplin', 'sonic', 'bach']) {
  const count = catalog.sources
    .flatMap((source) => source.entries.map((entry) => `${source.label} ${entry.title} ${entry.subtitle} ${entry.path}`))
    .filter((text) => text.toLowerCase().includes(query)).length
  if (!count) throw new Error(`Search fixture ${query} returned no results`)
  console.log(`search ${query}: ${count} results`)
}
