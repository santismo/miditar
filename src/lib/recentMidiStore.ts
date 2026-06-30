export type RecentMidiFile = {
  name: string
  lastModified: number
  buffer: ArrayBuffer
}

export type RecentMidiState = {
  files: RecentMidiFile[]
  songIndex: number
}

const DB_NAME = 'miditar-recent-midi'
const DB_VERSION = 1
const STORE_NAME = 'recent'
const STATE_KEY = 'state'

function canUseIndexedDb() {
  return typeof window !== 'undefined' && Boolean(window.indexedDB)
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'))
  })
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!canUseIndexedDb()) {
      reject(new Error('IndexedDB is not available.'))
      return
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open recent MIDI storage.'))
  })
}

function isRecentMidiFile(value: unknown): value is RecentMidiFile {
  if (!value || typeof value !== 'object') return false
  const candidate = value as RecentMidiFile
  return typeof candidate.name === 'string' && candidate.buffer instanceof ArrayBuffer
}

function normalizeState(value: unknown): RecentMidiState | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as RecentMidiState
  if (!Array.isArray(candidate.files)) return null
  const files = candidate.files.filter(isRecentMidiFile)
  if (!files.length) return null
  return {
    files,
    songIndex: Number.isFinite(candidate.songIndex) ? candidate.songIndex : 0,
  }
}

export async function loadRecentMidiState() {
  if (!canUseIndexedDb()) return null
  const db = await openDatabase()
  try {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const state = await requestToPromise<unknown>(transaction.objectStore(STORE_NAME).get(STATE_KEY))
    return normalizeState(state)
  } finally {
    db.close()
  }
}

export async function saveRecentMidiState(state: RecentMidiState) {
  if (!canUseIndexedDb() || !state.files.length) return
  const db = await openDatabase()
  try {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    await requestToPromise(transaction.objectStore(STORE_NAME).put(state, STATE_KEY))
  } finally {
    db.close()
  }
}
