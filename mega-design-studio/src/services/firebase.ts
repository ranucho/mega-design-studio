import { initializeApp, getApps } from 'firebase/app';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject, listAll } from 'firebase/storage';
import { getAuth, signInAnonymously } from 'firebase/auth';

// Firebase config — set these in a .env file as VITE_FIREBASE_*
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
};

const isConfigured = !!firebaseConfig.apiKey && !!firebaseConfig.projectId;

// Lazy-init Firebase
let app: ReturnType<typeof initializeApp> | null = null;
let storage: ReturnType<typeof getStorage> | null = null;
let authReady: Promise<void> | null = null;

function init() {
  if (!isConfigured) return;
  if (!app) {
    app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
    storage = getStorage(app);
    const auth = getAuth(app);
    authReady = signInAnonymously(auth).then(() => {}).catch(console.error);
  }
}

async function ensureReady() {
  init();
  if (authReady) await authReady;
  if (!storage) throw new Error('Firebase not configured');
  return storage;
}

// --- Public API ---

export function isFirebaseConfigured(): boolean {
  return isConfigured;
}

/** Convert a data URL to a WebP Blob for efficient storage */
export function dataUrlToWebpBlob(dataUrl: string, quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('toBlob failed')),
        'image/webp',
        quality,
      );
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/** Upload a data URL as WebP to Firebase Storage. Returns the public download URL. */
export async function uploadSkinAsset(path: string, dataUrl: string): Promise<string> {
  const st = await ensureReady();
  const blob = await dataUrlToWebpBlob(dataUrl);
  const storageRef = ref(st, path);
  await uploadBytes(storageRef, blob, { contentType: 'image/webp' });
  return getDownloadURL(storageRef);
}

/** Upload a JSON manifest to Firebase Storage. */
export async function uploadManifest(path: string, data: object): Promise<string> {
  const st = await ensureReady();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const storageRef = ref(st, path);
  await uploadBytes(storageRef, blob, { contentType: 'application/json' });
  return getDownloadURL(storageRef);
}

/** Download a JSON manifest from Firebase Storage. */
export async function downloadManifest<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url);
  return res.json();
}

/** Download an image from Firebase Storage and return as data URL. */
export async function downloadAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** Delete all assets for a skin from Firebase Storage. */
export async function deleteSkinFolder(folderPath: string): Promise<void> {
  const st = await ensureReady();
  const folderRef = ref(st, folderPath);
  try {
    const list = await listAll(folderRef);
    await Promise.all([
      ...list.items.map(item => deleteObject(item)),
      ...list.prefixes.map(prefix => deleteSkinFolder(prefix.fullPath)),
    ]);
  } catch {
    // Folder may not exist
  }
}

/** Upload a full slot skin to Firebase Storage. Returns map of asset keys to URLs. */
export async function uploadSlotSkin(skinId: string, skin: {
  thumbnailUrl: string;
  masterImage: string;
  reskinResult: string;
  reelsFrame: string | null;
  symbols: { id: string; isolatedUrl: string }[];
}): Promise<Record<string, string>> {
  const urls: Record<string, string> = {};
  const base = `skins/slots/${skinId}`;

  const uploads: Promise<void>[] = [];

  if (skin.thumbnailUrl) {
    uploads.push(uploadSkinAsset(`${base}/thumbnail.webp`, skin.thumbnailUrl).then(u => { urls.thumbnail = u; }));
  }
  if (skin.masterImage) {
    uploads.push(uploadSkinAsset(`${base}/master.webp`, skin.masterImage).then(u => { urls.master = u; }));
  }
  if (skin.reskinResult) {
    uploads.push(uploadSkinAsset(`${base}/reskin.webp`, skin.reskinResult).then(u => { urls.reskin = u; }));
  }
  if (skin.reelsFrame) {
    uploads.push(uploadSkinAsset(`${base}/frame.webp`, skin.reelsFrame).then(u => { urls.frame = u; }));
  }
  for (const sym of skin.symbols) {
    if (sym.isolatedUrl) {
      uploads.push(uploadSkinAsset(`${base}/symbols/${sym.id}.webp`, sym.isolatedUrl).then(u => { urls[`sym_${sym.id}`] = u; }));
    }
  }

  await Promise.all(uploads);
  return urls;
}

/** Upload a full banner skin to Firebase Storage. Returns map of asset keys to URLs. */
export async function uploadBannerSkin(skinId: string, skin: {
  thumbnailUrl: string;
  sourceImage: string;
  extractedElements: { id: string; dataUrl: string }[];
}): Promise<Record<string, string>> {
  const urls: Record<string, string> = {};
  const base = `skins/banners/${skinId}`;

  const uploads: Promise<void>[] = [];

  if (skin.thumbnailUrl) {
    uploads.push(uploadSkinAsset(`${base}/thumbnail.webp`, skin.thumbnailUrl).then(u => { urls.thumbnail = u; }));
  }
  if (skin.sourceImage) {
    uploads.push(uploadSkinAsset(`${base}/source.webp`, skin.sourceImage).then(u => { urls.source = u; }));
  }
  for (const el of skin.extractedElements) {
    if (el.dataUrl) {
      uploads.push(uploadSkinAsset(`${base}/elements/${el.id}.webp`, el.dataUrl).then(u => { urls[`el_${el.id}`] = u; }));
    }
  }

  await Promise.all(uploads);
  return urls;
}
