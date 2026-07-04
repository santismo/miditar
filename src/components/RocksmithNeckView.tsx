import { type PointerEvent, type WheelEvent, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { MidiNote, MidiPlacement } from '../lib/midi'
import { GUITAR_STRINGS } from '../lib/fretboard'
import {
  FRETBOARD_LEFT,
  FRETBOARD_RIGHT,
  FRETBOARD_VIEW_HEIGHT,
  FRETBOARD_VIEW_WIDTH,
  fretLineX,
  fretboardNoteX,
  stringY,
} from '../lib/fretboardLayout'
import { getFretboardTheme, type FretboardThemeId } from './fretboardThemes'

type RocksmithNeckViewProps = {
  notes: MidiNote[]
  placements: Map<string, MidiPlacement>
  currentTime: number
  duration: number
  isPlaying: boolean
  onScrub: (time: number) => void
  density?: number
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

type LandingMetrics = {
  canvasLeft: number
  canvasTop: number
  canvasWidth: number
  canvasHeight: number
  fretboardLeft: number
  fretboardTop: number
  fretboardWidth: number
  fretboardHeight: number
}

type ScrubState = {
  active: boolean
  pointerId: number
  startY: number
  startTime: number
  pendingTime: number | null
  frame: number | null
}

const MAX_FRET = 22
const NECK_LEFT = -2.35
const NECK_RIGHT = 2.65
const NECK_CENTER_X = (NECK_LEFT + NECK_RIGHT) / 2
const DEFAULT_3D_DENSITY = 168
const MIN_3D_DENSITY = 88
const MAX_3D_DENSITY = 320
const MIN_LOOKAHEAD_SECONDS = 2.1
const MAX_LOOKAHEAD_SECONDS = 4.8
const MIN_VISIBLE_NOTE_COUNT = 26
const MAX_VISIBLE_NOTE_COUNT = 62
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
const FRETBOARD_VIEW_TOP = 10
const FRETBOARD_VISIBLE_HEIGHT = FRETBOARD_VIEW_HEIGHT - FRETBOARD_VIEW_TOP

function fallbackStringLaneY(stringIndex: number) {
  return HIT_CENTER_Y + (5 - stringIndex - 2.5) * STRING_HEIGHT_STEP
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function fretScaleX(rawX: number) {
  const normalized = (rawX - FRETBOARD_LEFT) / (FRETBOARD_VIEW_WIDTH - FRETBOARD_LEFT - FRETBOARD_RIGHT)
  return NECK_LEFT + normalized * (NECK_RIGHT - NECK_LEFT)
}

function rawXToWorld(rawX: number, metrics: LandingMetrics | null) {
  if (!metrics) return fretScaleX(rawX)
  const screenX = metrics.fretboardLeft + (rawX / FRETBOARD_VIEW_WIDTH) * metrics.fretboardWidth
  const normalized = clamp((screenX - metrics.canvasLeft) / metrics.canvasWidth, 0, 1)
  return VIEW_LEFT + normalized * (VIEW_RIGHT - VIEW_LEFT)
}

function rawYToWorld(rawY: number, metrics: LandingMetrics | null) {
  if (!metrics) {
    const stringIndex = Math.round((rawY - 34) / 34)
    return fallbackStringLaneY(clamp(stringIndex, 0, 5))
  }
  const screenY =
    metrics.fretboardTop + ((rawY - FRETBOARD_VIEW_TOP) / FRETBOARD_VISIBLE_HEIGHT) * metrics.fretboardHeight
  const normalized = clamp((screenY - metrics.canvasTop) / metrics.canvasHeight, 0, 1)
  return VIEW_TOP - normalized * (VIEW_TOP - VIEW_BOTTOM)
}

function stringLaneY(stringIndex: number, metrics: LandingMetrics | null) {
  return rawYToWorld(stringY(stringIndex), metrics)
}

function fretTargetX(fret: number, metrics: LandingMetrics | null) {
  return rawXToWorld(fretboardNoteX(clamp(fret, 0, MAX_FRET), MAX_FRET), metrics)
}

function fretGuideX(fret: number, metrics: LandingMetrics | null) {
  return rawXToWorld(fretLineX(Math.min(fret, MAX_FRET), MAX_FRET), metrics)
}

function landingCenterX(metrics: LandingMetrics | null) {
  if (!metrics) return NECK_CENTER_X
  return (rawXToWorld(0, metrics) + rawXToWorld(FRETBOARD_VIEW_WIDTH, metrics)) / 2
}

function targetPoint(note: HighwayNote, metrics: LandingMetrics | null): FlightPoint {
  return {
    x: fretTargetX(note.fret, metrics),
    y: stringLaneY(note.stringIndex, metrics),
    z: PLAYHEAD_Z,
  }
}

function densityProgress(density: number) {
  const safeDensity = Number.isFinite(density) ? density : DEFAULT_3D_DENSITY
  return clamp((safeDensity - MIN_3D_DENSITY) / (MAX_3D_DENSITY - MIN_3D_DENSITY), 0, 1)
}

function lookaheadForDensity(density: number) {
  const progress = densityProgress(density)
  return MAX_LOOKAHEAD_SECONDS - progress * (MAX_LOOKAHEAD_SECONDS - MIN_LOOKAHEAD_SECONDS)
}

function visibleNoteLimitForDensity(density: number) {
  const progress = densityProgress(density)
  return Math.round(MAX_VISIBLE_NOTE_COUNT - progress * (MAX_VISIBLE_NOTE_COUNT - MIN_VISIBLE_NOTE_COUNT))
}

function timeDepthProgress(time: number, currentTime: number, lookaheadSeconds: number) {
  return clamp((time - currentTime) / lookaheadSeconds, 0, 1)
}

function depthScale(progress: number) {
  return 1 - progress * (1 - FAR_SCALE)
}

function highwayPoint(targetX: number, targetY: number, progress: number, centerX = NECK_CENTER_X): FlightPoint {
  const scale = depthScale(progress)
  return {
    x: centerX + (targetX - centerX) * scale,
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

function noteWindow(
  notes: HighwayNote[],
  currentTime: number,
  lookaheadSeconds: number,
  visibleNoteLimit: number,
) {
  return notes
    .filter(
      (note) =>
        note.time + note.duration >= currentTime - NEAR_TRAIL_SECONDS &&
        note.time <= currentTime + lookaheadSeconds,
    )
    .sort((a, b) => a.time - b.time || a.stringIndex - b.stringIndex || a.fret - b.fret)
    .slice(0, visibleNoteLimit)
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
  duration,
  isPlaying,
  onScrub,
  density = DEFAULT_3D_DENSITY,
  currentChord = '',
  themeId = 'dark',
}: RocksmithNeckViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stateRef = useRef<SceneState>({ notes: [], currentTime, isPlaying })
  const interactionRef = useRef({ currentTime, duration, onScrub, density })
  const [webglUnavailable, setWebglUnavailable] = useState(false)
  const scrubRef = useRef<ScrubState>({
    active: false,
    pointerId: -1,
    startY: 0,
    startTime: 0,
    pendingTime: null,
    frame: null,
  })
  const theme = getFretboardTheme(themeId)
  const lookaheadSeconds = lookaheadForDensity(density)
  const visibleNoteLimit = visibleNoteLimitForDensity(density)
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
  interactionRef.current = { currentTime, duration, onScrub, density }

  function scrubSecondsPerPixel() {
    const height = containerRef.current?.getBoundingClientRect().height ?? 420
    const lookaheadSeconds = lookaheadForDensity(interactionRef.current.density)
    return clamp(lookaheadSeconds / Math.max(260, height * 0.82), 0.0045, 0.014)
  }

  function scheduleScrub(nextTime: number) {
    const scrubState = scrubRef.current
    const { duration: songDuration, onScrub: scrubToTime } = interactionRef.current
    scrubState.pendingTime = clamp(nextTime, 0, songDuration)
    if (scrubState.frame !== null) return

    scrubState.frame = requestAnimationFrame(() => {
      const pendingTime = scrubState.pendingTime
      scrubState.frame = null
      scrubState.pendingTime = null
      if (pendingTime === null) return
      scrubToTime(pendingTime)
    })
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    const scrub = scrubRef.current
    scrub.active = true
    scrub.pointerId = event.pointerId
    scrub.startY = event.clientY
    scrub.startTime = interactionRef.current.currentTime
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const scrub = scrubRef.current
    if (!scrub.active || scrub.pointerId !== event.pointerId) return
    const deltaY = event.clientY - scrub.startY
    scheduleScrub(scrub.startTime + deltaY * scrubSecondsPerPixel())
    event.preventDefault()
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    const scrub = scrubRef.current
    if (scrub.pointerId !== event.pointerId) return
    scrub.active = false
    scrub.pointerId = -1
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    event.preventDefault()
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    scheduleScrub(interactionRef.current.currentTime + event.deltaY * scrubSecondsPerPixel())
    event.preventDefault()
  }

  useEffect(() => {
    const scrubState = scrubRef.current
    return () => {
      if (scrubState.frame !== null) {
        cancelAnimationFrame(scrubState.frame)
        scrubState.frame = null
      }
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return
    const host = container
    const scrubState = scrubRef.current

    const scene = new THREE.Scene()
    scene.fog = new THREE.Fog(0x070907, 5.4, 18)

    const camera = new THREE.OrthographicCamera(VIEW_LEFT, VIEW_RIGHT, VIEW_TOP, VIEW_BOTTOM, 0.1, 90)
    camera.position.set(NECK_CENTER_X, -0.28, 7.4)
    camera.lookAt(NECK_CENTER_X, -0.28, 0)

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true,
      })
      setWebglUnavailable(false)
    } catch {
      setWebglUnavailable(true)
      return
    }
    renderer.setClearColor(0x070907, 0)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace

    const neckGroup = new THREE.Group()
    const landingMetricsRef = { current: null as LandingMetrics | null }
    scene.add(neckGroup)

    function readLandingMetrics(): LandingMetrics | null {
      const canvasRect = host.getBoundingClientRect()
      const fretboard = document.querySelector('.neck-panel[data-flight-mode="connected"] .fretboard')
      const fretboardRect = fretboard?.getBoundingClientRect()
      if (!fretboardRect || !canvasRect.width || !canvasRect.height) return null
      return {
        canvasLeft: canvasRect.left,
        canvasTop: canvasRect.top,
        canvasWidth: canvasRect.width,
        canvasHeight: canvasRect.height,
        fretboardLeft: fretboardRect.left,
        fretboardTop: fretboardRect.top,
        fretboardWidth: fretboardRect.width,
        fretboardHeight: fretboardRect.height,
      }
    }

    function clearNeckGeometry() {
      for (const child of [...neckGroup.children]) {
        neckGroup.remove(child)
        disposeObject(child)
      }
    }

    function rebuildNeckGeometry(metrics: LandingMetrics | null) {
      clearNeckGeometry()
      const centerX = landingCenterX(metrics)
      const laneTopY = stringLaneY(0, metrics) + LANE_PADDING_Y
      const laneBottomY = stringLaneY(5, metrics) - LANE_PADDING_Y
      const viewLeft = rawXToWorld(0, metrics)
      const viewRight = rawXToWorld(FRETBOARD_VIEW_WIDTH, metrics)
      const deckCorners = [
        highwayPoint(viewLeft, laneBottomY, 0, centerX),
        highwayPoint(viewRight, laneBottomY, 0, centerX),
        highwayPoint(viewRight, laneTopY, 0, centerX),
        highwayPoint(viewLeft, laneTopY, 0, centerX),
        highwayPoint(viewLeft, laneBottomY, 1, centerX),
        highwayPoint(viewRight, laneBottomY, 1, centerX),
        highwayPoint(viewRight, laneTopY, 1, centerX),
        highwayPoint(viewLeft, laneTopY, 1, centerX),
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
      deckGeometry.setAttribute('position', new THREE.Float32BufferAttribute(deckVertices, 3))
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

      for (const guitarString of [...GUITAR_STRINGS].reverse()) {
        const y = stringLaneY(guitarString.index, metrics)
        const nearLeft = highwayPoint(viewLeft, y, 0, centerX)
        const nearRight = highwayPoint(viewRight, y, 0, centerX)
        const farLeft = highwayPoint(viewLeft, y, 1, centerX)
        const farRight = highwayPoint(viewRight, y, 1, centerX)

        neckGroup.add(createLine([pointTuple(nearLeft), pointTuple(farLeft)], guitarString.color, 0.22))
        neckGroup.add(createLine([pointTuple(nearRight), pointTuple(farRight)], guitarString.color, 0.22))
        neckGroup.add(createLine([pointTuple(nearLeft), pointTuple(nearRight)], guitarString.color, 0.68))
        neckGroup.add(createLine([pointTuple(farLeft), pointTuple(farRight)], guitarString.color, 0.18))
      }

      for (let fret = 0; fret <= MAX_FRET; fret += 1) {
        const x = fretGuideX(fret, metrics)
        const nearBottom = highwayPoint(x, laneBottomY, 0, centerX)
        const nearTop = highwayPoint(x, laneTopY, 0, centerX)
        const farBottom = highwayPoint(x, laneBottomY, 1, centerX)
        const farTop = highwayPoint(x, laneTopY, 1, centerX)
        neckGroup.add(createLine([pointTuple(nearBottom), pointTuple(farBottom)], '#f4f1e8', fret === 0 ? 0.24 : 0.07))
        neckGroup.add(createLine([pointTuple(nearTop), pointTuple(farTop)], '#f4f1e8', fret === 0 ? 0.2 : 0.05))
        neckGroup.add(createLine([pointTuple(nearBottom), pointTuple(nearTop)], '#f4f1e8', fret === 0 ? 0.36 : 0.1))
      }
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
      landingMetricsRef.current = readLandingMetrics()
      rebuildNeckGeometry(landingMetricsRef.current)
    }

    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()

    let animationFrame = 0
    function render() {
      const { notes: currentNotes, currentTime: now, isPlaying: playing } = stateRef.current
      const lookaheadSeconds = lookaheadForDensity(interactionRef.current.density)
      const visibleNoteLimit = visibleNoteLimitForDensity(interactionRef.current.density)
      const landingMetrics = landingMetricsRef.current
      const centerX = landingCenterX(landingMetrics)
      const visible = noteWindow(currentNotes, now, lookaheadSeconds, visibleNoteLimit)
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

        const landing = targetPoint(note, landingMetrics)
        const noteStartProgress = timeDepthProgress(note.time, now, lookaheadSeconds)
        const noteEndProgress = timeDepthProgress(note.time + note.duration, now, lookaheadSeconds)
        const head = highwayPoint(landing.x, landing.y, noteStartProgress, centerX)
        let tail = highwayPoint(landing.x, landing.y, noteEndProgress, centerX)
        const active = note.time <= now && note.time + note.duration >= now
        const headVector = new THREE.Vector3()
        const tailVector = new THREE.Vector3()
        const midpoint = new THREE.Vector3()
        const direction = new THREE.Vector3()
        const futurePoint = highwayPoint(landing.x, landing.y, 1, centerX)
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
      if (scrubState.frame !== null) {
        cancelAnimationFrame(scrubState.frame)
        scrubState.frame = null
      }
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
    <div
      className="rocksmith-neck-view"
      ref={containerRef}
      role="img"
      aria-label="Experimental 3D guitar note highway"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
      data-density={Math.round(density)}
      data-lookahead={lookaheadSeconds.toFixed(2)}
      data-visible-limit={visibleNoteLimit}
    >
      <canvas ref={canvasRef} aria-hidden="true" />
      {webglUnavailable && <span className="rocksmith-webgl-fallback">3D view needs WebGL.</span>}
      {currentChord && <strong className="rocksmith-chord-label">{currentChord}</strong>}
    </div>
  )
}
