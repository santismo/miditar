import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { MidiNote, MidiPlacement } from '../lib/midi'
import { GUITAR_STRINGS } from '../lib/fretboard'
import {
  FRETBOARD_LEFT,
  FRETBOARD_RIGHT,
  FRETBOARD_VIEW_WIDTH,
  fretLineX,
  fretboardNoteX,
} from '../lib/fretboardLayout'
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
  guide: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
}

type SceneState = {
  notes: HighwayNote[]
  currentTime: number
  isPlaying: boolean
}

const MAX_FRET = 22
const NECK_LEFT = -2.35
const NECK_RIGHT = 2.65
const SPAWN_X = 0.15
const SPAWN_Y = 1.38
const LOOKAHEAD_SECONDS = 7.8
const NEAR_TRAIL_SECONDS = 0.42
const STRING_HEIGHT_STEP = 0.38
const NOTE_WIDTH = 0.34
const NOTE_HEIGHT = 0.2
const NOTE_THICKNESS = 0.12

function stringLaneY(stringIndex: number) {
  return (5 - stringIndex - 2.5) * STRING_HEIGHT_STEP
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function fretScaleX(rawX: number) {
  const normalized = (rawX - FRETBOARD_LEFT) / (FRETBOARD_VIEW_WIDTH - FRETBOARD_LEFT - FRETBOARD_RIGHT)
  return NECK_LEFT + normalized * (NECK_RIGHT - NECK_LEFT)
}

function fretTargetX(fret: number) {
  if (fret <= 0) return NECK_LEFT - 0.26
  return fretScaleX(fretboardNoteX(Math.min(fret, MAX_FRET), MAX_FRET))
}

function fretGuideX(fret: number) {
  return fretScaleX(fretLineX(Math.min(fret, MAX_FRET), MAX_FRET))
}

function flightProgress(time: number, currentTime: number) {
  return clamp(1 - (time - currentTime) / LOOKAHEAD_SECONDS, 0, 1)
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
      note.time <= currentTime + LOOKAHEAD_SECONDS,
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
  const guide = createLine(
    [
      [0, 0, -0.04],
      [0, 0, -0.04],
    ],
    note.color,
    0.56,
  ) as THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  const group = new THREE.Group()
  group.add(guide)
  group.add(block)
  group.add(label)
  return { group, block, label, guide }
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

    const deckWidth = NECK_RIGHT - NECK_LEFT + 0.7
    const deckCenterX = (NECK_RIGHT + NECK_LEFT) / 2
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(deckWidth, 2.7, 0.08),
      new THREE.MeshStandardMaterial({
        color: theme.neckStart,
        transparent: true,
        opacity: 0.18,
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
          [NECK_LEFT - 0.34, y, 0.12],
          [NECK_RIGHT + 0.34, y, 0.12],
        ],
        string.color,
        0.18,
      )
      neckGroup.add(guide)
    }

    for (let fret = 0; fret <= MAX_FRET; fret += 1) {
      const x = fretGuideX(fret)
      const line = createLine(
        [
          [x, -1.18, 0.11],
          [x, 1.18, 0.11],
        ],
        '#f4f1e8',
        fret === 0 ? 0.32 : 0.08,
      )
      neckGroup.add(line)
    }

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
      const isWide = aspect > 2.4
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.fov = width < 520 ? 43 : isWide ? 35 : 36
      camera.position.set(isWide ? 0.95 : 1.05, 0.08, isWide ? 4.2 : 7.4)
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

        const progress = flightProgress(note.time, now)
        const targetX = fretTargetX(note.fret)
        const spawnX = SPAWN_X + (targetX - (NECK_LEFT + NECK_RIGHT) / 2) * 0.16
        const x = spawnX + (targetX - spawnX) * progress
        const active = note.time <= now && note.time + note.duration >= now
        const targetY = stringLaneY(note.stringIndex)
        const y = SPAWN_Y + (targetY - SPAWN_Y) * progress
        const z = active ? 0.32 : 0.2 + (1 - progress) * 0.2

        item.group.position.set(x, y, z)
        item.block.scale.set(active ? NOTE_WIDTH * 1.22 : NOTE_WIDTH, active ? NOTE_HEIGHT * 1.18 : NOTE_HEIGHT, NOTE_THICKNESS)
        item.block.material.emissiveIntensity = active ? 0.74 : playing ? 0.36 : 0.28
        item.label.position.set(0, 0, active ? 0.24 : 0.18)

        const guidePoints = item.guide.geometry.attributes.position
        guidePoints.setXYZ(0, 0, 0, -0.05)
        guidePoints.setXYZ(1, targetX - x, targetY - y, 0.12 - z)
        guidePoints.needsUpdate = true
      }

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
