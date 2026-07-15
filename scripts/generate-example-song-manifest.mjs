import { readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const songDirectory = join(projectRoot, 'public', 'example midi songs')
const outputPath = join(projectRoot, 'public', 'example-songs.json')

const names = (await readdir(songDirectory))
  .filter((name) => /\.(mid|midi)$/i.test(name))
  .sort((a, b) => a.localeCompare(b))

const songs = await Promise.all(
  names.map(async (name) => ({
    name,
    size: (await stat(join(songDirectory, name))).size,
  })),
)

await writeFile(outputPath, `${JSON.stringify({ songs }, null, 2)}\n`)
console.log(`Wrote ${songs.length} songs to ${outputPath}`)
