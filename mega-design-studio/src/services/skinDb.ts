import type { SlotSkin, BannerSkin, SkinIndexEntry } from '@/types/shared';
import { saveSlotSkinToFile, saveBannerSkinToFile, deleteSlotSkinFromFile, deleteBannerSkinFromFile } from '@/services/skinFileSync';

const DB_NAME = 'megastudio-skins';
const DB_VERSION = 1;
const SLOT_STORE = 'slotSkins';
const BANNER_STORE = 'bannerSkins';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SLOT_STORE)) db.createObjectStore(SLOT_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(BANNER_STORE)) db.createObjectStore(BANNER_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function put<T>(store: string, value: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function get<T>(store: string, id: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(id);
    req.onsuccess = () => { db.close(); resolve(req.result as T | undefined); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

async function getAll<T>(store: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => { db.close(); resolve(req.result as T[]); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

async function remove(store: string, id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

// --- Slot Skins ---
export const putSlotSkin = (skin: SlotSkin) => {
  const result = put<SlotSkin>(SLOT_STORE, skin);
  saveSlotSkinToFile(skin).catch(console.error);
  return result;
};
export const getSlotSkin = (id: string) => get<SlotSkin>(SLOT_STORE, id);
export const getAllSlotSkins = () => getAll<SlotSkin>(SLOT_STORE);
export const removeSlotSkin = (id: string) => {
  const result = remove(SLOT_STORE, id);
  deleteSlotSkinFromFile(id).catch(console.error);
  return result;
};

// --- Banner Skins ---
export const putBannerSkin = (skin: BannerSkin) => {
  const result = put<BannerSkin>(BANNER_STORE, skin);
  saveBannerSkinToFile(skin).catch(console.error);
  return result;
};
export const getBannerSkin = (id: string) => get<BannerSkin>(BANNER_STORE, id);
export const getAllBannerSkins = () => getAll<BannerSkin>(BANNER_STORE);
export const removeBannerSkin = (id: string) => {
  const result = remove(BANNER_STORE, id);
  deleteBannerSkinFromFile(id).catch(console.error);
  return result;
};

// --- Index helpers (localStorage for fast dropdown population) ---
const SLOT_INDEX_KEY = 'megastudio_slot_skin_index';
const BANNER_INDEX_KEY = 'megastudio_banner_skin_index';

function readIndex(key: string): SkinIndexEntry[] {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
}

function writeIndex(key: string, entries: SkinIndexEntry[]) {
  localStorage.setItem(key, JSON.stringify(entries));
}

export function getSlotSkinIndex(): SkinIndexEntry[] { return readIndex(SLOT_INDEX_KEY); }
export function getBannerSkinIndex(): SkinIndexEntry[] { return readIndex(BANNER_INDEX_KEY); }

export function addToSlotIndex(entry: SkinIndexEntry) {
  const idx = readIndex(SLOT_INDEX_KEY).filter(e => e.id !== entry.id);
  idx.unshift(entry);
  writeIndex(SLOT_INDEX_KEY, idx);
}

export function addToBannerIndex(entry: SkinIndexEntry) {
  const idx = readIndex(BANNER_INDEX_KEY).filter(e => e.id !== entry.id);
  idx.unshift(entry);
  writeIndex(BANNER_INDEX_KEY, idx);
}

export function removeFromSlotIndex(id: string) {
  writeIndex(SLOT_INDEX_KEY, readIndex(SLOT_INDEX_KEY).filter(e => e.id !== id));
}

export function removeFromBannerIndex(id: string) {
  writeIndex(BANNER_INDEX_KEY, readIndex(BANNER_INDEX_KEY).filter(e => e.id !== id));
}

export function updateSlotIndex(id: string, updates: Partial<SkinIndexEntry>) {
  writeIndex(SLOT_INDEX_KEY, readIndex(SLOT_INDEX_KEY).map(e => e.id === id ? { ...e, ...updates } : e));
}

export function updateBannerIndex(id: string, updates: Partial<SkinIndexEntry>) {
  writeIndex(BANNER_INDEX_KEY, readIndex(BANNER_INDEX_KEY).map(e => e.id === id ? { ...e, ...updates } : e));
}
