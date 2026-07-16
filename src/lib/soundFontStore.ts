export type StoredSoundFont = {
  name: string
  size: number
  lastModified: number
  buffer: ArrayBuffer
}

const DATABASE_NAME = 'miditar-soundfonts'
const STORE_NAME = 'banks'
const ACTIVE_KEY = 'active'

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openDatabase()
  return new Promise<T>((resolve, reject) => {
    const request = action(database.transaction(STORE_NAME, mode).objectStore(STORE_NAME))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }).finally(() => database.close())
}

export function loadStoredSoundFont() {
  return transaction<StoredSoundFont | undefined>('readonly', (store) => store.get(ACTIVE_KEY))
}

export function saveStoredSoundFont(soundFont: StoredSoundFont) {
  return transaction<IDBValidKey>('readwrite', (store) => store.put(soundFont, ACTIVE_KEY))
}

export function removeStoredSoundFont() {
  return transaction<undefined>('readwrite', (store) => store.delete(ACTIVE_KEY))
}
