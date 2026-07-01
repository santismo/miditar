import { copyFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const sourceDir = process.argv[2]
const projectRoot = process.cwd()
const examplesRoot = path.join(projectRoot, 'public', 'examples')
const midiRoot = path.join(examplesRoot, 'midi')

if (!sourceDir) {
  console.error('Usage: npm run examples:import -- "/path/to/midi folder"')
  process.exit(1)
}

function safeFileName(value) {
  return value
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(fullPath)))
    else if (/\.(mid|midi)$/i.test(entry.name)) files.push(fullPath)
  }
  return files
}

await mkdir(midiRoot, { recursive: true })

const sourceFiles = await walk(path.resolve(sourceDir))
const usedNames = new Set()
const manifest = []

for (const file of sourceFiles.sort((a, b) => path.basename(a).localeCompare(path.basename(b)))) {
  const extension = path.extname(file).toLowerCase() || '.mid'
  const title = path.basename(file, path.extname(file))
  let targetName = `${safeFileName(title) || 'song'}${extension}`
  let suffix = 2
  while (usedNames.has(targetName)) {
    targetName = `${safeFileName(title) || 'song'}-${suffix}${extension}`
    suffix += 1
  }
  usedNames.add(targetName)

  const target = path.join(midiRoot, targetName)
  await copyFile(file, target)
  const fileStat = await stat(target)
  manifest.push({
    title,
    file: `examples/midi/${targetName}`,
    size: fileStat.size,
  })
}

await writeFile(path.join(examplesRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Imported ${manifest.length} MIDI files into public/examples.`)
