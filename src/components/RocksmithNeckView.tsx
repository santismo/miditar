import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { MidiNote, MidiPlacement } from '../lib/midi'
import { GUITAR_STRINGS } from '../lib/fretboard'
import { getFretboardTheme, type FretboardThemeId } from './fretboardThemes'

type RocksmithNeckViewProps = {
  notes: MidiNote[]
  placements: Map<string, MidiPlacement>
  currentTime: number
  isPlaying: boolean
  currentChord?: string
  themeId?: FretboardThemeId
}

type HighwayNote = {
  id: string
  time: number
  duration: number
  stringIndex: number
  fret: number
  color: string
}

type NoteObject = {
  group: THREE.Group
  block: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>
  label: THREE.Sprite
}

type SceneState = {
  notes: HighwayNote[]
  currentTime: number
  isPlaying: boolean
}

const PLAY_X = -2.35
const FAR_X = 4.9
const X_PER_SECOND = 0.92
const NEAR_TRAIL_SECONDS = 0.42
const STRING_HEIGHT_STEP = 0.38
const NOTE_HEIGHT = 0.22
const NOTE_THICKNESS = 0.12
const MIN_NOTE_LENGTH = 0.34

function stringLaneY(stringIndex: number) {
  return (5 - stringIndex - 2.5) * STRING_HEIGHT_STEP
}

function xForTime(time: number, currentTime: number) {
  return PLAY_X + (time - currentTime) * X_PER_SECOND
}

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  const materials = Array.isArray(material) ? material : [material]
  materials.forEach((item) => {
    const mappedMaterial = item as THREE.Material & { map?: THREE.Texture | null }
    mappedMaterial.map?.dispose()
    item.dispose()
  })
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    if (mesh.material) disposeMaterial(mesh.material)
  })
}

function noteWindow(notes: HighwayNote[], currentTime: number) {
  return notes.filter(
    (note) =>
      note.time + note.duration >= currentTime - NEAR_TRAIL_SECONDS &&
      xForTime(note.time, currentTime) <= FAR_X &&
      xForTime(note.time + note.duration, currentTime) >= PLAY_X - 0.6,
  )
}

function createLabelSprite(text: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 64
  const context = canvas.getContext('2d')
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = 'rgba(7, 9, 7, 0.82)'
    context.beginPath()
    if (typeof context.roundRect === 'function') context.roundRect(10, 10, 108, 44, 12)
    else context.rect(10, 10, 108, 44)
    context.fill()
    context.strokeStyle = 'rgba(255, 255, 255, 0.5)'
    context.lineWidth = 4
    context.stroke()
    context.fillStyle = '#fffaf0'
    context.font = '800 34px system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(text, canvas.width / 2, canvas.height / 2 + 1)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(0.42, 0.24, 1)
  return sprite
}

function createNoteObject(note: HighwayNote) {
  const material = new THREE.MeshStandardMaterial({
    color: note.color,
    emissive: new THREE.Color(note.color),
    emissiveIntensity: 0.32,
    roughness: 0.36,
    metalness: 0.04,
  })
  const block = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)
  block.castShadow = false
  block.receiveShadow = false

  const label = createLabelSprite(String(note.fret))
  const group = new THREE.Group()
  group.add(block)
  group.add(label)
  return { group, block, label }
}

function createLine(
  points: [number, number, number][],
  color: string,
  opacity = 1,
) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)))
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
  })
  return new THREE.Line(geometry, material)
}

export function RocksmithNeckView({
  notes,
  placements,
  currentTime,
  isPlaying,
  currentChord = '',
  themeId = 'dark',
}: RocksmithNeckViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const stateRef = useRef<SceneState>({ notes: [], currentTime, isPlaying })
  const theme = getFretboardTheme(themeId)
  const highwayNotes = useMemo(() => {
    return notes
      .map((note) => {
        const placement = placements.get(note.id)
        if (!placement) return null
        const string = GUITAR_STRINGS[placement.stringIndex]
        return {
          id: note.id,
          time: note.time,
          duration: note.duration,
          stringIndex: placement.stringIndex,
          fret: placement.fret,
          color: string.color,
        }
      })
      .filter((note): note is HighwayNote => note !== null)
  }, [notes, placements])

  stateRef.current = { notes: highwayNotes, currentTime, isPlaying }

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const host = container

    const scene = new THREE.Scene()
    scene.fog = new THREE.Fog(0x070907, 13, 42)

    const camera = new THREE.PerspectiveCamera(39, 1, 0.1, 90)
    camera.position.set(0.95, 0.08, 7.4)
    camera.lookAt(0.95, 0, 0)

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    })
    renderer.setClearColor(0x070907, 1)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    host.appendChild(renderer.domElement)

    const neckGroup = new THREE.Group()
    scene.add(neckGroup)

    const deckWidth = FAR_X - PLAY_X + 0.9
    const deckCenterX = (FAR_X + PLAY_X) / 2
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(deckWidth, 2.7, 0.08),
      new THREE.MeshStandardMaterial({
        color: theme.neckStart,
        roughness: 0.84,
        metalness: 0.02,
      }),
    )
    deck.position.set(deckCenterX, 0, -0.08)
    neckGroup.add(deck)

    for (const string of [...GUITAR_STRINGS].reverse()) {
      const y = stringLaneY(string.index)
      const stringMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012 + (5 - string.index) * 0.002, 0.012 + (5 - string.index) * 0.002, deckWidth, 12),
        new THREE.MeshStandardMaterial({
          color: string.color,
          emissive: string.color,
          emissiveIntensity: 0.18,
          roughness: 0.44,
        }),
      )
      stringMesh.rotation.z = Math.PI / 2
      stringMesh.position.set(deckCenterX, y, 0.05)
      neckGroup.add(stringMesh)

      const guide = createLine(
        [
          [PLAY_X - 0.35, y, 0.12],
          [FAR_X, y, 0.12],
        ],
        string.color,
        0.32,
      )
      neckGroup.add(guide)
    }

    for (let index = 0; index < 13; index += 1) {
      const x = PLAY_X + index * 0.62
      const line = createLine(
        [
          [x, -1.18, 0.11],
          [x, 1.18, 0.11],
        ],
        index === 0 ? '#ff6659' : '#f4f1e8',
        index === 0 ? 0.95 : 0.2,
      )
      neckGroup.add(line)
    }

    const playLine = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 2.55, 0.12),
      new THREE.MeshBasicMaterial({ color: '#ff6659' }),
    )
    playLine.position.set(PLAY_X, 0, 0.19)
    neckGroup.add(playLine)

    const playGlow = createLine(
      [
        [PLAY_X, -1.24, 0.28],
        [PLAY_X, 1.24, 0.28],
      ],
      '#ffd36b',
      0.75,
    )
    neckGroup.add(playGlow)

    scene.add(new THREE.HemisphereLight(0xfff2ce, 0x101410, 1.35))
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.25)
    keyLight.position.set(-2.8, 5.2, 6.8)
    scene.add(keyLight)

    const noteObjects = new Map<string, NoteObject>()

    function resize() {
      const rect = host.getBoundingClientRect()
      const width = Math.max(1, Math.floor(rect.width))
      const height = Math.max(1, Math.floor(rect.height))
      const aspect = width / height
      const isWide = aspect > 4.4
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.fov = width < 520 ? 43 : isWide ? 29 : 36
      camera.position.set(isWide ? 0.95 : 1.05, 0.08, isWide ? 6.2 : 7.4)
      camera.lookAt(0.95, 0, 0)
      camera.updateProjectionMatrix()
    }

    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()

    let animationFrame = 0
    function render() {
      const { notes: currentNotes, currentTime: now, isPlaying: playing } = stateRef.current
      const visible = noteWindow(currentNotes, now)
      const visibleIds = new Set(visible.map((note) => note.id))

      for (const [id, item] of noteObjects) {
        if (visibleIds.has(id)) continue
        scene.remove(item.group)
        disposeObject(item.group)
        noteObjects.delete(id)
      }

      for (const note of visible) {
        let item = noteObjects.get(note.id)
        if (!item) {
          item = createNoteObject(note)
          noteObjects.set(note.id, item)
          scene.add(item.group)
        }

        const startX = Math.max(PLAY_X - 0.35, xForTime(note.time, now))
        const endX = xForTime(note.time + note.duration, now)
        const length = Math.max(MIN_NOTE_LENGTH, Math.abs(endX - startX))
        const centerX = (startX + endX) / 2
        const active = note.time <= now && note.time + note.duration >= now
        const laneY = stringLaneY(note.stringIndex)

        item.group.position.set(centerX, laneY, active ? 0.28 : 0.2)
        item.block.scale.set(length, active ? NOTE_HEIGHT * 1.25 : NOTE_HEIGHT, NOTE_THICKNESS)
        item.block.material.emissiveIntensity = active ? 0.74 : playing ? 0.36 : 0.28
        item.label.position.set(Math.max(-length / 2 + 0.24, -0.08), 0, active ? 0.24 : 0.19)
      }

      playLine.scale.x = playing ? 1.8 : 1
      renderer.render(scene, camera)
      animationFrame = requestAnimationFrame(render)
    }

    animationFrame = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(animationFrame)
      observer.disconnect()
      for (const item of noteObjects.values()) {
        scene.remove(item.group)
        disposeObject(item.group)
      }
      scene.traverse((child) => {
        const mesh = child as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        if (mesh.material) disposeMaterial(mesh.material)
      })
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [theme.id, theme.neckStart])

  return (
    <div className="rocksmith-neck-view" ref={containerRef} role="img" aria-label="Experimental 3D guitar note highway">
      {currentChord && <strong className="rocksmith-chord-label">{currentChord}</strong>}
    </div>
  )
}
