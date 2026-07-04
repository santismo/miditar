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

type FlightPoint = {
  x: number
  y: number
  z: number
}

type SceneState = {
  notes: HighwayNote[]
  currentTime: number
  isPlaying: boolean
}

const MAX_FRET = 22
const NECK_LEFT = -2.35
const NECK_RIGHT = 2.65
const NECK_CENTER_X = (NECK_LEFT + NECK_RIGHT) / 2
const SPAWN_X = NECK_CENTER_X
const SPAWN_Y = 0.38
const LOOKAHEAD_SECONDS = 4.7
const MAX_VISIBLE_NOTES = 64
const NEAR_TRAIL_SECONDS = 0
const STRING_HEIGHT_STEP = 0.035
const LANDING_CENTER_Y = -1.2
const VIEW_LEFT = fretScaleX(0)
const VIEW_RIGHT = fretScaleX(FRETBOARD_VIEW_WIDTH)
const VIEW_TOP = SPAWN_Y + 0.18
const VIEW_BOTTOM = LANDING_CENTER_Y - 0.08
const NOTE_WIDTH = 0.24
const NOTE_THICKNESS = 0.08
const MIN_NOTE_LENGTH = 0.16
const SPAWN_Z = -0.55
const PLAYHEAD_Z = 0.06

function stringLaneY(stringIndex: number) {
  return LANDING_CENTER_Y + (5 - stringIndex - 2.5) * STRING_HEIGHT_STEP
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

function targetPoint(note: HighwayNote): FlightPoint {
  return {
    x: fretTargetX(note.fret),
    y: stringLaneY(note.stringIndex),
    z: PLAYHEAD_Z,
  }
}

function spawnPoint(targetX: number): FlightPoint {
  return {
    x: SPAWN_X + (targetX - NECK_CENTER_X) * 0.1,
    y: SPAWN_Y,
    z: SPAWN_Z,
  }
}

function interpolatePoint(from: FlightPoint, to: FlightPoint, progress: number): FlightPoint {
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
    z: from.z + (to.z - from.z) * progress,
  }
}

function copyPointToVector(point: FlightPoint, vector: THREE.Vector3) {
  vector.set(point.x, point.y, point.z)
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
  return notes
    .filter(
      (note) =>
        note.time + note.duration >= currentTime - NEAR_TRAIL_SECONDS &&
        note.time <= currentTime + LOOKAHEAD_SECONDS,
    )
    .sort((a, b) => a.time - b.time || a.stringIndex - b.stringIndex || a.fret - b.fret)
    .slice(0, MAX_VISIBLE_NOTES)
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
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
    const canvas = canvasRef.current
    if (!container || !canvas) return
    const host = container

    const scene = new THREE.Scene()
    scene.fog = new THREE.Fog(0x070907, 7, 22)

    const camera = new THREE.OrthographicCamera(VIEW_LEFT, VIEW_RIGHT, VIEW_TOP, VIEW_BOTTOM, 0.1, 90)
    camera.position.set(NECK_CENTER_X, -0.28, 7.4)
    camera.lookAt(NECK_CENTER_X, -0.28, 0)

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    })
    renderer.setClearColor(0x070907, 0)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))

    const neckGroup = new THREE.Group()
    scene.add(neckGroup)

    const deckWidth = VIEW_RIGHT - VIEW_LEFT
    const deckCenterX = (VIEW_LEFT + VIEW_RIGHT) / 2
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(deckWidth, 0.96, 0.08),
      new THREE.MeshStandardMaterial({
        color: theme.neckStart,
        transparent: true,
        opacity: 0.1,
        roughness: 0.84,
        metalness: 0.02,
      }),
    )
    deck.position.set(deckCenterX, LANDING_CENTER_Y, -0.08)
    neckGroup.add(deck)

    for (const string of [...GUITAR_STRINGS].reverse()) {
      const y = stringLaneY(string.index)
      const stringMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012 + (5 - string.index) * 0.002, 0.012 + (5 - string.index) * 0.002, deckWidth, 12),
        new THREE.MeshStandardMaterial({
          color: string.color,
          emissive: string.color,
          emissiveIntensity: 0.24,
          roughness: 0.44,
          transparent: true,
          opacity: 0.76,
        }),
      )
      stringMesh.rotation.z = Math.PI / 2
      stringMesh.position.set(deckCenterX, y, 0.05)
      neckGroup.add(stringMesh)

      const guide = createLine(
        [
          [VIEW_LEFT, y, 0.12],
          [VIEW_RIGHT, y, 0.12],
        ],
        string.color,
        0.24,
      )
      neckGroup.add(guide)
    }

    for (let fret = 0; fret <= MAX_FRET; fret += 1) {
      const x = fretGuideX(fret)
      const line = createLine(
        [
          [x, LANDING_CENTER_Y - 0.48, 0.11],
          [x, LANDING_CENTER_Y + 0.48, 0.11],
        ],
        '#f4f1e8',
        fret === 0 ? 0.34 : 0.1,
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
      renderer.setSize(width, height, false)
      camera.left = VIEW_LEFT
      camera.right = VIEW_RIGHT
      camera.top = VIEW_TOP
      camera.bottom = VIEW_BOTTOM
      camera.position.set(NECK_CENTER_X, -0.28, 7.4)
      camera.lookAt(NECK_CENTER_X, -0.28, 0)
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

        const landing = targetPoint(note)
        const origin = spawnPoint(landing.x)
        const noteStartProgress = flightProgress(note.time, now)
        const noteEndProgress = flightProgress(note.time + note.duration, now)
        const head = interpolatePoint(origin, landing, noteStartProgress)
        let tail = interpolatePoint(origin, landing, noteEndProgress)
        const active = note.time <= now && note.time + note.duration >= now
        const headVector = new THREE.Vector3()
        const tailVector = new THREE.Vector3()
        const midpoint = new THREE.Vector3()
        const direction = new THREE.Vector3()
        const pathDirection = new THREE.Vector3(landing.x - origin.x, landing.y - origin.y, landing.z - origin.z).normalize()
        copyPointToVector(head, headVector)
        copyPointToVector(tail, tailVector)
        direction.subVectors(headVector, tailVector)

        if (direction.length() < MIN_NOTE_LENGTH) {
          tail = {
            x: head.x - pathDirection.x * MIN_NOTE_LENGTH,
            y: head.y - pathDirection.y * MIN_NOTE_LENGTH,
            z: head.z - pathDirection.z * MIN_NOTE_LENGTH,
          }
          copyPointToVector(tail, tailVector)
          direction.subVectors(headVector, tailVector)
        }

        const length = direction.length()
        midpoint.addVectors(headVector, tailVector).multiplyScalar(0.5)
        item.block.position.copy(midpoint)
        item.block.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
        item.block.scale.set(active ? NOTE_WIDTH * 1.22 : NOTE_WIDTH, length, NOTE_THICKNESS)
        item.block.material.emissiveIntensity = active ? 0.74 : playing ? 0.36 : 0.28
        item.label.position.set(head.x, head.y, head.z + (active ? 0.24 : 0.18))

        const guidePoints = item.guide.geometry.attributes.position
        guidePoints.setXYZ(0, tail.x, tail.y, tail.z - 0.03)
        guidePoints.setXYZ(1, landing.x, landing.y, landing.z)
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
    }
  }, [theme.id, theme.neckStart])

  return (
    <div className="rocksmith-neck-view" ref={containerRef} role="img" aria-label="Experimental 3D guitar note highway">
      <canvas ref={canvasRef} aria-hidden="true" />
      {currentChord && <strong className="rocksmith-chord-label">{currentChord}</strong>}
    </div>
  )
}
