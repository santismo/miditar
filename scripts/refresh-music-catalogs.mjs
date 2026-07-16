import { mkdir, writeFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import JSZip from 'jszip'

const outputPath = new URL('../public/music-catalogs/catalog.json', import.meta.url)
const githubHeaders = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
}

function humanize(value) {
  return value
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: githubHeaders })
  if (!response.ok) throw new Error(`${url} returned ${response.status}`)
  return response.json()
}

function parseCsvLine(line) {
  const cells = []
  let value = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      cells.push(value)
      value = ''
    } else {
      value += character
    }
  }
  cells.push(value)
  return cells
}

async function asapMetadata() {
  const response = await fetch('https://raw.githubusercontent.com/fosfrancesco/asap-dataset/master/metadata.csv')
  if (!response.ok) throw new Error(`ASAP metadata returned ${response.status}`)
  const rows = (await response.text()).trim().split(/\r?\n/).slice(1).map(parseCsvLine)
  const metadata = new Map()
  for (const row of rows) {
    const [composer, title, , , midiScore, midiPerformance] = row
    const details = { composer: humanize(composer), title: humanize(title) }
    if (midiScore) metadata.set(midiScore, details)
    if (midiPerformance) metadata.set(midiPerformance, details)
  }
  return metadata
}

async function githubSource(config) {
  const tree = await fetchJson(
    `https://api.github.com/repos/${config.repository}/git/trees/${config.ref}?recursive=1`,
  )
  if (tree.truncated) throw new Error(`${config.repository} returned a truncated Git tree`)

  const entries = tree.tree
    .filter((entry) => entry.type === 'blob' && config.pattern.test(entry.path))
    .map((entry) => {
      const path = entry.path
      const fileName = basename(path)
      return {
        path,
        title: config.title ? config.title(path) : humanize(fileName),
        subtitle: config.subtitle(path),
      }
    })
    .sort((a, b) => a.title.localeCompare(b.title) || a.path.localeCompare(b.path))

  return {
    id: config.id,
    category: config.category,
    label: config.label,
    description: config.description,
    license: config.license,
    sourceUrl: `https://github.com/${config.repository}`,
    delivery: 'direct',
    rawBase: `https://raw.githubusercontent.com/${config.repository}/${config.ref}`,
    entries,
  }
}

async function gameArchiveSource() {
  const archiveUrl = 'https://raw.githubusercontent.com/ryanrudes/game-midis/main/Music.zip'
  const response = await fetch(archiveUrl)
  if (!response.ok) throw new Error(`Game MIDI archive returned ${response.status}`)
  const archive = await JSZip.loadAsync(await response.arrayBuffer())
  const entries = Object.values(archive.files)
    .filter((entry) => {
      if (entry.dir || entry.name.startsWith('__MACOSX/') || /\/\._[^/]+$/.test(entry.name)) return false
      return /\.(mid|midi)$/i.test(entry.name)
    })
    .map((entry) => {
      const path = entry.name
      const parts = path.split('/')
      const game = parts.length > 1 ? parts[0] : 'Video Game'
      return {
        path,
        title: humanize(basename(path)),
        subtitle: humanize(game),
      }
    })
    .sort((a, b) => a.subtitle.localeCompare(b.subtitle) || a.title.localeCompare(b.title))

  return {
    id: 'game-midis',
    category: 'video-game',
    label: 'Community Game MIDI Archive',
    description: 'Thousands of game MIDIs grouped by title; downloaded once when first used.',
    license: 'Community archive · rights vary · personal playback',
    sourceUrl: 'https://github.com/ryanrudes/game-midis',
    delivery: 'archive',
    archiveUrl,
    entries,
  }
}

const asap = await asapMetadata()

const sources = await Promise.all([
  githubSource({
    id: 'classtab',
    category: 'guitar',
    label: 'ClassTab',
    description: 'Large classical-guitar MIDI collection.',
    license: 'MIT collection · public-domain compositions vary',
    repository: 'baweaver/classtab',
    ref: 'master',
    pattern: /^app\/midis\/.*\.(mid|midi)$/i,
    subtitle: () => 'Classical guitar MIDI',
  }),
  githubSource({
    id: 'musetrainer',
    category: 'piano',
    label: 'MuseTrainer',
    description: 'Public-domain classical and ragtime MusicXML scores.',
    license: 'Public domain',
    repository: 'musetrainer/library',
    ref: 'master',
    pattern: /^scores\/.*\.(mxl|musicxml|xml)$/i,
    subtitle: (path) => `${humanize(extname(path).slice(1))} score`,
  }),
  githubSource({
    id: 'asap-scores',
    category: 'piano',
    label: 'ASAP Classical Scores',
    description: 'Quantized MIDI scores for Western classical piano works.',
    license: 'CC BY-NC-SA 4.0',
    repository: 'fosfrancesco/asap-dataset',
    ref: 'master',
    pattern: /\/midi_score\.mid$/i,
    title: (path) => asap.get(path)?.title ?? humanize(path.split('/').at(-2) ?? 'Classical piano score'),
    subtitle: (path) => `${asap.get(path)?.composer ?? humanize(path.split('/')[0] ?? 'Classical')} · MIDI score`,
  }),
  githubSource({
    id: 'asap-performances',
    category: 'piano',
    label: 'ASAP Piano Performances',
    description: 'Expressive MIDI performances aligned to classical piano scores.',
    license: 'CC BY-NC-SA 4.0',
    repository: 'fosfrancesco/asap-dataset',
    ref: 'master',
    pattern: /^(?!.*\/midi_score\.mid$).*\.(mid|midi)$/i,
    title: (path) => {
      const details = asap.get(path)
      return `${details?.title ?? humanize(path.split('/').at(-2) ?? 'Classical piano')} — ${humanize(path.split('/').at(-1) ?? 'Performance')}`
    },
    subtitle: (path) => `${asap.get(path)?.composer ?? humanize(path.split('/')[0] ?? 'Classical')} · expressive performance`,
  }),
  githubSource({
    id: 'e-midi',
    category: 'video-game',
    label: 'e_midi Cues',
    description: 'Small openly licensed game cues and utility jingles.',
    license: 'MIT',
    repository: 'davehorner/e_midi',
    ref: 'develop',
    pattern: /^e_midi\/midi\/.*\.(mid|midi)$/i,
    subtitle: () => 'Open game cue',
  }),
  gameArchiveSource(),
])

const catalog = {
  version: 1,
  generatedAt: new Date().toISOString(),
  sources,
}

await mkdir(new URL('../public/music-catalogs/', import.meta.url), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(catalog)}\n`)

for (const source of sources) {
  console.log(`${source.label}: ${source.entries.length}`)
}
