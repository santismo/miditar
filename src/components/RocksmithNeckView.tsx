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
  head: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>
  sustain: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>
  label: THREE.Sprite
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
const LOOKAHEAD_SECONDS = 3.8
const MAX_VISIBLE_NOTES = 46
const NEAR_TRAIL_SECONDS = 0.04
const STRING_HEIGHT_STEP = 0.062
const HIT_CENTER_Y = -1.2
const FAR_Y = 0.42
const FAR_SCALE = 0.26
const VIEW_LEFT = fretScaleX(0)
const VIEW_RIGHT = fretScaleX(FRETBOARD_VIEW_WIDTH)
const VIEW_TOP = FAR_Y + 0.24
const VIEW_BOTTOM = HIT_CENTER_Y - 0.34
const NOTE_HEAD_SIZE = 0.13
const NOTE_HEAD_THICKNESS = 0.065
const SUSTAIN_WIDTH = 0.035
const SUSTAIN_THICKNESS = 0.032
const MIN_SUSTAIN_LENGTH = 0.035
const PLAYHEAD_Z = 0.06
const FAR_Z = -0.7
const LANE_PADDING_Y = 0.2

function stringLaneY(stringIndex: number) {
  return HIT_CENTER_Y + (5 - stringIndex - 2.5) * STRING_HEIGHT_STEP
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function fretScaleX(rawX: number) {
  const normalized = (rawX - FRETBOARD_LEFT) / (FRETBOARD_VIEW_WIDTH - FRETBOARD_LEFT - FRETBOARD_RIGHT)
  return NECK_LEFT + normalized * (NECK_RIGHT - NECK_LEFT)
}

function fretTargetX(fret: number) {
  return fretScaleX(fretboardNoteX(clamp(fret, 0, MAX_FRET), MAX_FRET))
}

function fretGuideX(fret: number) {
  return fretScaleX(fretLineX(Math.min(fret, MAX_FRET), MAX_FRET))
}

function targetPoint(note: HighwayNote): FlightPoint {
  return {
    x: fretTargetX(note.fret),
    y: stringLaneY(note.stringIndex),
    z: PLAYHEAD_Z,
  }
}

function timeDepthProgress(time: number, currentTime: number) {
  return clamp((time - currentTime) / LOOKAHEAD_SECONDS, 0, 1)
}

function depthScale(progress: number) {
  return 1 - progress * (1 - FAR_SCALE)
}

function highwayPoint(targetX: number, targetY: number, progress: number): FlightPoint {
  const scale = depthScale(progress)
  return {
    x: NECK_CENTER_X + (targetX - NECK_CENTER_X) * scale,
    y: targetY + (FAR_Y - targetY) * progress,
    z: PLAYHEAD_Z + (FAR_Z - PLAYHEAD_Z) * progress,
  }
}

function copyPointToVector(point: FlightPoint, vector: THREE.Vector3) {
  vector.set(point.x, point.y, point.z)
}

function pointTuple(point: FlightPoint): [number, number, number] {
  return [point.x, point.y, point.z]
}

function pushPoint(values: number[], point: FlightPoint) {
  values.push(point.x, point.y, point.z)
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
  canvas.width = 96
  canvas.height = 64
  const context = canvas.getContext('2d')
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.shadowColor = 'rgba(0, 0, 0, 0.92)'
    context.shadowBlur = 10
    context.lineWidth = 7
    context.strokeStyle = 'rgba(5, 7, 5, 0.96)'
    context.fillStyle = '#fffaf0'
    context.font = '900 34px system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.strokeText(text, canvas.width / 2, canvas.height / 2 + 1)
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
  sprite.scale.set(0.28, 0.18, 1)
  return sprite
}

function createNoteObject(note: HighwayNote) {
  const headMaterial = new THREE.MeshStandardMaterial({
    color: note.color,
    emissive: new THREE.Color(note.color),
    emissiveIntensity: 0.32,
    roughness: 0.36,
    metalness: 0.04,
  })
  const sustainMaterial = new THREE.MeshStandardMaterial({
    color: note.color,
    emissive: new THREE.Color(note.color),
    emissiveIntensity: 0.22,
    roughness: 0.42,
    metalness: 0.02,
    transparent: true,
    opacity: 0.7,
  })
  const head = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), headMaterial)
  head.castShadow = false
  head.receiveShadow = false
  const sustain = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), sustainMaterial)
  sustain.castShadow = false
  sustain.receiveShadow = false

  const label = createLabelSprite(String(note.fret))
  const group = new THREE.Group()
  group.add(sustain)
  group.add(head)
  group.add(label)
  return { group, head, sustain, label }
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
    scene.fog = new THREE.Fog(0x070907, 5.4, 18)

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
    renderer.outputColorSpace = THREE.SRGBColorSpace

    const neckGroup = new THREE.Group()
    scene.add(neckGroup)

    const laneTopY = stringLaneY(0) + LANE_PADDING_Y
    const laneBottomY = stringLaneY(5) - LANE_PADDING_Y
    const deckCorners = [
      highwayPoint(VIEW_LEFT, laneBottomY, 0),
      highwayPoint(VIEW_RIGHT, laneBottomY, 0),
      highwayPoint(VIEW_RIGHT, laneTopY, 0),
      highwayPoint(VIEW_LEFT, laneTopY, 0),
      highwayPoint(VIEW_LEFT, laneBottomY, 1),
      highwayPoint(VIEW_RIGHT, laneBottomY, 1),
      highwayPoint(VIEW_RIGHT, laneTopY, 1),
      highwayPoint(VIEW_LEFT, laneTopY, 1),
    ]
    const deckFaces = [
      0, 1, 5, 0, 5, 4,
      3, 7, 6, 3, 6, 2,
      0, 4, 7, 0, 7, 3,
      1, 2, 6, 1, 6, 5,
    ]
    const deckVertices: number[] = []
    for (const cornerIndex of deckFaces) {
      pushPoint(deckVertices, deckCorners[cornerIndex])
    }
    const deckGeometry = new THREE.BufferGeometry()
    deckGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(deckVertices, 3),
    )
    deckGeometry.computeVertexNormals()
    const deck = new THREE.Mesh(
      deckGeometry,
      new THREE.MeshStandardMaterial({
        color: theme.neckStart,
        transparent: true,
        opacity: 0.16,
        roughness: 0.84,
        metalness: 0.02,
        side: THREE.DoubleSide,
      }),
    )
    neckGroup.add(deck)

    for (const string of [...GUITAR_STRINGS].reverse()) {
      const y = stringLaneY(string.index)
      const nearLeft = highwayPoint(VIEW_LEFT, y, 0)
      const nearRight = highwayPoint(VIEW_RIGHT, y, 0)
      const farLeft = highwayPoint(VIEW_LEFT, y, 1)
      const farRight = highwayPoint(VIEW_RIGHT, y, 1)

      neckGroup.add(createLine([pointTuple(nearLeft), pointTuple(farLeft)], string.color, 0.22))
      neckGroup.add(createLine([pointTuple(nearRight), pointTuple(farRight)], string.color, 0.22))
      neckGroup.add(createLine([pointTuple(nearLeft), pointTuple(nearRight)], string.color, 0.68))
      neckGroup.add(createLine([pointTuple(farLeft), pointTuple(farRight)], string.color, 0.18))
    }

    for (let fret = 0; fret <= MAX_FRET; fret += 1) {
      const x = fretGuideX(fret)
      const nearBottom = highwayPoint(x, laneBottomY, 0)
      const nearTop = highwayPoint(x, laneTopY, 0)
      const farBottom = highwayPoint(x, laneBottomY, 1)
      const farTop = highwayPoint(x, laneTopY, 1)
      neckGroup.add(createLine([pointTuple(nearBottom), pointTuple(farBottom)], '#f4f1e8', fret === 0 ? 0.24 : 0.07))
      neckGroup.add(createLine([pointTuple(nearTop), pointTuple(farTop)], '#f4f1e8', fret === 0 ? 0.2 : 0.05))
      neckGroup.add(createLine([pointTuple(nearBottom), pointTuple(nearTop)], '#f4f1e8', fret === 0 ? 0.36 : 0.1))
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
        const noteStartProgress = timeDepthProgress(note.time, now)
        const noteEndProgress = timeDepthProgress(note.time + note.duration, now)
        const head = highwayPoint(landing.x, landing.y, noteStartProgress)
        let tail = highwayPoint(landing.x, landing.y, noteEndProgress)
        const active = note.time <= now && note.time + note.duration >= now
        const headVector = new THREE.Vector3()
        const tailVector = new THREE.Vector3()
        const midpoint = new THREE.Vector3()
        const direction = new THREE.Vector3()
        const futurePoint = highwayPoint(landing.x, landing.y, 1)
        const pathDirection = new THREE.Vector3(
          futurePoint.x - landing.x,
          futurePoint.y - landing.y,
          futurePoint.z - landing.z,
        ).normalize()
        copyPointToVector(head, headVector)
        copyPointToVector(tail, tailVector)
        direction.subVectors(tailVector, headVector)

        if (direction.length() < MIN_SUSTAIN_LENGTH) {
          tail = {
            x: head.x + pathDirection.x * MIN_SUSTAIN_LENGTH,
            y: head.y + pathDirection.y * MIN_SUSTAIN_LENGTH,
            z: head.z + pathDirection.z * MIN_SUSTAIN_LENGTH,
          }
          copyPointToVector(tail, tailVector)
          direction.subVectors(tailVector, headVector)
        }

        const length = direction.length()
        const visualScale = depthScale(noteStartProgress)
        const normalizedDirection = direction.normalize()
        midpoint.addVectors(headVector, tailVector).multiplyScalar(0.5)
        item.sustain.position.copy(midpoint)
        item.sustain.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normalizedDirection)
        item.sustain.scale.set(
          Math.max(0.018, SUSTAIN_WIDTH * visualScale),
          length,
          SUSTAIN_THICKNESS * (0.72 + visualScale * 0.28),
        )
        item.sustain.material.emissiveIntensity = active ? 0.38 : playing ? 0.24 : 0.18
        item.sustain.material.opacity = active ? 0.78 : 0.62

        item.head.position.copy(headVector)
        item.head.quaternion.copy(item.sustain.quaternion)
        item.head.scale.set(
          Math.max(0.065, (active ? NOTE_HEAD_SIZE * 1.18 : NOTE_HEAD_SIZE) * visualScale),
          Math.max(0.065, NOTE_HEAD_SIZE * visualScale),
          NOTE_HEAD_THICKNESS * (0.78 + visualScale * 0.32),
        )
        item.head.material.emissiveIntensity = active ? 0.8 : playing ? 0.4 : 0.3
        item.label.position.set(head.x, head.y, head.z + (active ? 0.2 : 0.14))
        item.label.scale.set(0.18 + visualScale * 0.06, 0.12 + visualScale * 0.04, 1)
        const labelMaterial = item.label.material as THREE.SpriteMaterial
        labelMaterial.opacity = clamp(0.3 + (1 - noteStartProgress) * 0.7, 0.3, 1)
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
