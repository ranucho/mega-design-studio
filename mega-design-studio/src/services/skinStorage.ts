import type {
  SlotSkin, BannerSkin, SkinSymbolSnapshot, SkinIndexEntry,
  SymbolGeneratorState, BannerProject, BannerComposition, CompositorState,
  BackgroundState,
} from '@/types/shared';
import type { CharacterState } from '@/types/editor';
import {
  putSlotSkin, putBannerSkin, removeSlotSkin, removeBannerSkin,
  addToSlotIndex, addToBannerIndex, removeFromSlotIndex, removeFromBannerIndex,
  updateSlotIndex, updateBannerIndex,
} from './skinDb';
import {
  isFirebaseConfigured, uploadSlotSkin as fbUploadSlot, uploadBannerSkin as fbUploadBanner,
  deleteSkinFolder, uploadManifest,
} from './firebase';

// --- Video persistence helpers ---
//
// Veo returns generated videos as in-memory blob: URLs (see gemini/video.ts).
// These disappear on reload. To make them survive a saved skin we convert
// each blob: URL to a data: URL (base64) so it can be serialized into
// IndexedDB / JSON-synced via Dropbox.

async function blobUrlToDataUrl(url: string): Promise<string> {
  if (!url || !url.startsWith('blob:')) return url;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.warn('[skinStorage] Failed to convert blob URL, dropping video:', err);
    return url; // keep original; likely invalid but saves the metadata
  }
}

async function persistVideoList<T extends { url: string }>(videos: T[] | undefined): Promise<T[]> {
  if (!videos || videos.length === 0) return [];
  return Promise.all(videos.map(async v => ({ ...v, url: await blobUrlToDataUrl(v.url) })));
}

async function persistCompositorLayers(cs?: CompositorState): Promise<CompositorState | undefined> {
  if (!cs) return cs;
  const layers = await Promise.all(cs.layers.map(async l => ({ ...l, src: await blobUrlToDataUrl(l.src) })));
  return { ...cs, layers };
}

async function persistCharacterState(st?: CharacterState): Promise<CharacterState | undefined> {
  if (!st) return st;
  return { ...st, generatedVideos: await persistVideoList(st.generatedVideos) };
}

async function persistBackgroundState(st?: BackgroundState): Promise<BackgroundState | undefined> {
  if (!st) return st;
  return { ...st, generatedVideos: await persistVideoList(st.generatedVideos) };
}

// --- Thumbnail generation ---

const THUMB_WIDTH = 200;

export function generateThumbnail(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = THUMB_WIDTH / img.width;
      const w = THUMB_WIDTH;
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/webp', 0.7));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// --- Slot Skin Save ---

export async function saveSlotSkin(
  name: string,
  state: SymbolGeneratorState,
  compositorState?: CompositorState,
  characterState?: CharacterState,
  backgroundState?: BackgroundState,
): Promise<SlotSkin> {
  const sourceImage = state.reskinResult || state.masterImage;
  const thumbnailUrl = sourceImage ? await generateThumbnail(sourceImage) : '';

  // Convert all blob: video URLs to data: URLs so they survive serialization
  const persistedGeneratedVideos = await persistVideoList(state.generatedVideos);
  const persistedCompositor = await persistCompositorLayers(compositorState);
  const persistedCharacter = await persistCharacterState(characterState);
  const persistedBackground = await persistBackgroundState(backgroundState);

  const skin: SlotSkin = {
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    thumbnailUrl,
    masterPrompt: state.masterPrompt,
    masterImage: state.masterImage || '',
    reskinResult: state.reskinResult || '',
    reelsFrame: state.reelsFrame,
    reelsFrameCropCoordinates: state.reelsFrameCropCoordinates || null,
    symbols: state.symbols.map(s => ({
      id: s.id,
      name: s.name,
      isolatedUrl: s.isolatedUrl || '',
      rawCropDataUrl: s.rawCropDataUrl || null,
      cropCoordinates: s.cropCoordinates || null,
      spanRows: s.spanRows,
      withFrame: s.withFrame,
      symbolRole: s.symbolRole,
      scaleX: s.scaleX,
      scaleY: s.scaleY,
    })),
    gridState: state.gridState,
    gridRows: state.gridRows,
    gridCols: state.gridCols,
    layoutOffsetX: state.layoutOffsetX,
    layoutOffsetY: state.layoutOffsetY,
    layoutWidth: state.layoutWidth,
    layoutHeight: state.layoutHeight,
    layoutGutterHorizontal: state.layoutGutterHorizontal,
    layoutGutterVertical: state.layoutGutterVertical,
    symbolScale: state.symbolScale,
    sourceFrames: state.sourceFrames,
    activeSourceFrameId: state.activeSourceFrameId,
    layouts: state.layouts,
    activeLayoutId: state.activeLayoutId,
    generatedVideos: persistedGeneratedVideos,
    compositorState: persistedCompositor,
    characterState: persistedCharacter,
    backgroundState: persistedBackground,
    isUploaded: false,
    isUploading: false,
  };

  // Persist to IndexedDB
  await putSlotSkin(skin);

  // Update localStorage index
  const entry: SkinIndexEntry = { id: skin.id, name: skin.name, thumbnailUrl: skin.thumbnailUrl, createdAt: skin.createdAt };
  addToSlotIndex(entry);

  // Background upload to Firebase (non-blocking)
  if (isFirebaseConfigured()) {
    backgroundUploadSlotSkin(skin).catch(console.error);
  }

  return skin;
}

/** Background upload slot skin to Firebase. Updates IndexedDB when done. */
async function backgroundUploadSlotSkin(skin: SlotSkin): Promise<void> {
  skin.isUploading = true;
  await putSlotSkin(skin);

  try {
    const urls = await fbUploadSlot(skin.id, skin);
    await uploadManifest(`skins/slots/${skin.id}/manifest.json`, {
      id: skin.id, name: skin.name, createdAt: skin.createdAt,
      masterPrompt: skin.masterPrompt, symbolCount: skin.symbols.length,
    });
    skin.firebaseUrls = urls;
    skin.isUploaded = true;
    skin.isUploading = false;
    await putSlotSkin(skin);
    console.log(`[SkinStorage] Uploaded slot skin "${skin.name}" to Firebase`);
  } catch (err) {
    skin.isUploading = false;
    await putSlotSkin(skin);
    throw err;
  }
}

// --- Slot Skin Load ---

export function loadSlotSkinIntoState(
  skin: SlotSkin,
  setSymbolGenState: React.Dispatch<React.SetStateAction<SymbolGeneratorState>>,
  setCompositorState?: React.Dispatch<React.SetStateAction<CompositorState>>,
  setCharacterState?: React.Dispatch<React.SetStateAction<CharacterState>>,
  setBackgroundState?: React.Dispatch<React.SetStateAction<BackgroundState>>,
) {
  // Restore the compositor snapshot (layers, colors, chroma, trims, canvas,
  // timeline zoom). Transient fields (playback, export) are reset.
  if (setCompositorState && skin.compositorState) {
    const cs = skin.compositorState;
    setCompositorState(prev => ({
      ...prev,
      ...cs,
      isPlaying: false,
      isExporting: false,
      playheadTime: 0,
    }));
  }
  // Restore Character Studio state (reskin, sheet, isolated image, chroma/luma
  // key color, generated videos). Transient processing flags are reset.
  if (setCharacterState && skin.characterState) {
    const cs = skin.characterState;
    setCharacterState(() => ({
      ...cs,
      isProcessingReskin: false,
      isProcessingSheet: false,
      isProcessingIsolation: false,
      isProcessingVideo: false,
    }));
  }
  // Restore Background Studio state (source, generated, crop, generated videos)
  if (setBackgroundState && skin.backgroundState) {
    const bs = skin.backgroundState;
    setBackgroundState(() => ({
      ...bs,
      isProcessing: false,
      isProcessingVideo: false,
    }));
  }
  setSymbolGenState(prev => {
    const restoredVideos = skin.generatedVideos && skin.generatedVideos.length > 0
      ? skin.generatedVideos
      : prev.generatedVideos;
    const skinMasterView = skin.reskinResult ? 'reskinned' as const : 'source' as const;
    // The frame-level fields that mirror to top-level
    const frameData = {
      masterImage: skin.masterImage,
      reskinResult: skin.reskinResult,
      masterPrompt: skin.masterPrompt,
      activeMasterView: skinMasterView,
      reelsFrame: skin.reelsFrame,
      reelsFrameCropCoordinates: skin.reelsFrameCropCoordinates || null,
    };
    // If the skin has a multi-frame snapshot, restore it wholesale. Otherwise
    // fall back to patching the active frame (legacy single-frame skins).
    const hasFrameSnapshot = Array.isArray(skin.sourceFrames) && skin.sourceFrames.length > 0;
    const restoredFrames = hasFrameSnapshot
      ? skin.sourceFrames!.map(f => ({ ...f, isProcessingMaster: false }))
      : (() => {
          const frames = prev.sourceFrames ?? [];
          const frameId = prev.activeSourceFrameId ?? frames[0]?.id;
          return frames.map(f =>
            f.id === frameId ? { ...f, ...frameData, isProcessingMaster: false } : f
          );
        })();
    const restoredActiveFrameId = hasFrameSnapshot
      ? (skin.activeSourceFrameId ?? skin.sourceFrames![0]?.id ?? null)
      : prev.activeSourceFrameId;
    // Mirror active frame's fields to top-level so the UI reads them immediately
    const activeFrame = restoredFrames.find(f => f.id === restoredActiveFrameId) ?? restoredFrames[0];
    const topLevelFrameData = activeFrame ? {
      masterImage: activeFrame.masterImage,
      reskinResult: activeFrame.reskinResult,
      masterPrompt: activeFrame.masterPrompt,
      activeMasterView: activeFrame.activeMasterView,
      reelsFrame: activeFrame.reelsFrame,
      reelsFrameCropCoordinates: activeFrame.reelsFrameCropCoordinates || null,
    } : frameData;
    return {
      ...prev,
      ...topLevelFrameData,
      generatedVideos: restoredVideos,
      sourceFrames: restoredFrames,
      activeSourceFrameId: restoredActiveFrameId,
      symbols: skin.symbols.map(s => ({
        id: s.id,
        name: s.name,
        sourceUrl: s.isolatedUrl,
        rawCropDataUrl: s.rawCropDataUrl,
        isolatedUrl: s.isolatedUrl,
        isProcessing: false,
        cropCoordinates: s.cropCoordinates,
        cropSourceView: 'reskinned' as const,
        spanRows: s.spanRows,
        withFrame: s.withFrame,
        symbolRole: s.symbolRole,
        scaleX: s.scaleX,
        scaleY: s.scaleY,
        lockScale: true,
      })),
      ...(() => {
        // If the skin has a multi-layout snapshot, restore it wholesale and
        // mirror the active layout to the top-level fields. Otherwise keep
        // the legacy top-level layout fields from the skin.
        const hasLayoutSnapshot = Array.isArray(skin.layouts) && skin.layouts.length > 0;
        if (!hasLayoutSnapshot) {
          return {
            gridState: skin.gridState,
            gridRows: skin.gridRows,
            gridCols: skin.gridCols,
            layoutOffsetX: skin.layoutOffsetX,
            layoutOffsetY: skin.layoutOffsetY,
            layoutWidth: skin.layoutWidth,
            layoutHeight: skin.layoutHeight,
            layoutGutterHorizontal: skin.layoutGutterHorizontal,
            layoutGutterVertical: skin.layoutGutterVertical,
            symbolScale: skin.symbolScale,
          };
        }
        const layouts = skin.layouts!;
        const activeLayoutId = skin.activeLayoutId ?? layouts[0]?.id ?? null;
        const active = layouts.find(l => l.id === activeLayoutId) ?? layouts[0];
        return {
          layouts,
          activeLayoutId,
          gridState: active.gridState,
          gridRows: active.gridRows,
          gridCols: active.gridCols,
          layoutOffsetX: active.layoutOffsetX,
          layoutOffsetY: active.layoutOffsetY,
          layoutWidth: active.layoutWidth,
          layoutHeight: active.layoutHeight,
          layoutGutterHorizontal: active.layoutGutterHorizontal,
          layoutGutterVertical: active.layoutGutterVertical,
          symbolScale: active.symbolScale,
          hideReelsBg: active.hideReelsBg,
          useLongTiles: active.useLongTiles ?? false,
        };
      })(),
    };
  });
}

// --- Slot Skin Update (overwrite existing skin with current state) ---

export async function updateSlotSkin(
  existingSkin: SlotSkin,
  state: SymbolGeneratorState,
  compositorState?: CompositorState,
  characterState?: CharacterState,
  backgroundState?: BackgroundState,
): Promise<SlotSkin> {
  const sourceImage = state.reskinResult || state.masterImage;
  const thumbnailUrl = sourceImage ? await generateThumbnail(sourceImage) : existingSkin.thumbnailUrl;

  const persistedGeneratedVideos = await persistVideoList(state.generatedVideos);
  const persistedCompositor = compositorState
    ? await persistCompositorLayers(compositorState)
    : existingSkin.compositorState;
  const persistedCharacter = characterState
    ? await persistCharacterState(characterState)
    : existingSkin.characterState;
  const persistedBackground = backgroundState
    ? await persistBackgroundState(backgroundState)
    : existingSkin.backgroundState;

  const updated: SlotSkin = {
    ...existingSkin,
    thumbnailUrl,
    masterPrompt: state.masterPrompt,
    masterImage: state.masterImage || '',
    reskinResult: state.reskinResult || '',
    reelsFrame: state.reelsFrame,
    reelsFrameCropCoordinates: state.reelsFrameCropCoordinates || null,
    symbols: state.symbols.map(s => ({
      id: s.id,
      name: s.name,
      isolatedUrl: s.isolatedUrl || '',
      rawCropDataUrl: s.rawCropDataUrl || null,
      cropCoordinates: s.cropCoordinates || null,
      spanRows: s.spanRows,
      withFrame: s.withFrame,
      symbolRole: s.symbolRole,
      scaleX: s.scaleX,
      scaleY: s.scaleY,
    })),
    gridState: state.gridState,
    gridRows: state.gridRows,
    gridCols: state.gridCols,
    layoutOffsetX: state.layoutOffsetX,
    layoutOffsetY: state.layoutOffsetY,
    layoutWidth: state.layoutWidth,
    layoutHeight: state.layoutHeight,
    layoutGutterHorizontal: state.layoutGutterHorizontal,
    layoutGutterVertical: state.layoutGutterVertical,
    symbolScale: state.symbolScale,
    sourceFrames: state.sourceFrames,
    activeSourceFrameId: state.activeSourceFrameId,
    layouts: state.layouts,
    activeLayoutId: state.activeLayoutId,
    generatedVideos: persistedGeneratedVideos,
    compositorState: persistedCompositor,
    characterState: persistedCharacter,
    backgroundState: persistedBackground,
    isUploaded: false,
    isUploading: false,
  };

  await putSlotSkin(updated);
  updateSlotIndex(updated.id, { thumbnailUrl: updated.thumbnailUrl });

  if (isFirebaseConfigured()) {
    backgroundUploadSlotSkin(updated).catch(console.error);
  }

  return updated;
}

// --- Slot Skin Delete ---

export async function deleteSlotSkin(id: string): Promise<void> {
  await removeSlotSkin(id);
  removeFromSlotIndex(id);
  if (isFirebaseConfigured()) {
    deleteSkinFolder(`skins/slots/${id}`).catch(console.error);
  }
}

// --- Banner Skin Save ---

export async function saveBannerSkin(
  name: string,
  theme: string,
  project: BannerProject,
): Promise<BannerSkin> {
  const thumbnailUrl = await generateThumbnail(project.sourceImage);

  const skin: BannerSkin = {
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    thumbnailUrl,
    reskinTheme: theme,
    sourceImage: project.sourceImage,
    sourceWidth: project.sourceWidth,
    sourceHeight: project.sourceHeight,
    detectedElements: [...project.detectedElements],
    extractedElements: project.extractedElements.map(e => ({ ...e })),
    compositions: project.compositions.map(c => ({
      ...c,
      layers: c.layers.map(l => ({ ...l })),
    })),
    isUploaded: false,
    isUploading: false,
  };

  await putBannerSkin(skin);

  const entry: SkinIndexEntry = { id: skin.id, name: skin.name, thumbnailUrl: skin.thumbnailUrl, createdAt: skin.createdAt };
  addToBannerIndex(entry);

  // Background upload to Firebase (non-blocking)
  if (isFirebaseConfigured()) {
    backgroundUploadBannerSkin(skin).catch(console.error);
  }

  return skin;
}

/** Background upload banner skin to Firebase. Updates IndexedDB when done. */
async function backgroundUploadBannerSkin(skin: BannerSkin): Promise<void> {
  skin.isUploading = true;
  await putBannerSkin(skin);

  try {
    const urls = await fbUploadBanner(skin.id, skin);
    await uploadManifest(`skins/banners/${skin.id}/manifest.json`, {
      id: skin.id, name: skin.name, createdAt: skin.createdAt,
      reskinTheme: skin.reskinTheme, elementCount: skin.extractedElements.length,
      sourceWidth: skin.sourceWidth, sourceHeight: skin.sourceHeight,
    });
    skin.firebaseUrls = urls;
    skin.isUploaded = true;
    skin.isUploading = false;
    await putBannerSkin(skin);
    console.log(`[SkinStorage] Uploaded banner skin "${skin.name}" to Firebase`);
  } catch (err) {
    skin.isUploading = false;
    await putBannerSkin(skin);
    throw err;
  }
}

// --- Banner Skin Update (overwrite existing skin with current project state) ---

export async function updateBannerSkin(
  existingSkin: BannerSkin,
  project: BannerProject,
): Promise<BannerSkin> {
  const thumbnailUrl = await generateThumbnail(project.sourceImage);

  const updated: BannerSkin = {
    ...existingSkin,
    thumbnailUrl,
    sourceImage: project.sourceImage,
    sourceWidth: project.sourceWidth,
    sourceHeight: project.sourceHeight,
    detectedElements: [...project.detectedElements],
    extractedElements: project.extractedElements.map(e => ({ ...e })),
    compositions: project.compositions.map(c => ({
      ...c,
      layers: c.layers.map(l => ({ ...l })),
    })),
    isUploaded: false,
    isUploading: false,
  };

  await putBannerSkin(updated);
  updateBannerIndex(updated.id, { thumbnailUrl: updated.thumbnailUrl });

  if (isFirebaseConfigured()) {
    backgroundUploadBannerSkin(updated).catch(console.error);
  }

  return updated;
}

// --- Banner Skin Load ---

export function loadBannerSkinIntoProject(
  skin: BannerSkin,
  setProject: React.Dispatch<React.SetStateAction<BannerProject | null>>,
) {
  setProject(prev => {
    // Re-map composition layers to point to new extracted element data URLs
    // Use skin's compositions if available, otherwise try to update prev's compositions
    const baseComps = skin.compositions.length > 0
      ? skin.compositions
      : (prev?.compositions || []);

    const updatedComps: BannerComposition[] = baseComps.map(comp => ({
      ...comp,
      layers: comp.layers.map(layer => {
        const layerName = layer.name.trim().toLowerCase();
        const newEl = skin.extractedElements.find(e => e.label.trim().toLowerCase() === layerName);
        if (!newEl || newEl.dataUrl === layer.src) return layer;
        const scaleAdj = layer.nativeWidth > 0 && newEl.nativeWidth > 0
          ? (layer.nativeWidth * layer.scaleX) / newEl.nativeWidth
          : layer.scaleX;
        return {
          ...layer,
          src: newEl.dataUrl,
          nativeWidth: newEl.nativeWidth,
          nativeHeight: newEl.nativeHeight,
          scaleX: scaleAdj,
          scaleY: scaleAdj,
        };
      }),
      sparkleDataUrl: undefined,
      status: 'edited' as const,
    }));

    // Build project from skin data — ensure ALL required BannerProject fields are present
    return {
      id: prev?.id || crypto.randomUUID(),
      name: prev?.name || skin.name || `banner-${new Date().toISOString().slice(0, 10)}`,
      sourceImage: skin.sourceImage,
      originalImage: prev?.originalImage || undefined,
      sourceWidth: skin.sourceWidth,
      sourceHeight: skin.sourceHeight,
      detectedElements: skin.detectedElements,
      extractedElements: skin.extractedElements,
      compositions: updatedComps,
      selectedPresets: [
        ...new Set([
          ...(prev?.selectedPresets || []),
          ...updatedComps.map(c => c.presetKey).filter(Boolean),
        ]),
      ],
      mode: prev?.mode || 'resize',
      stage: (prev?.stage || 'extract') as any,
      isExtracting: false,
      isGenerating: prev?.isGenerating || false,
      extractionProcessedCount: 0,
    };
  });
}

// --- Banner Skin Delete ---

export async function deleteBannerSkin(id: string): Promise<void> {
  await removeBannerSkin(id);
  removeFromBannerIndex(id);
  if (isFirebaseConfigured()) {
    deleteSkinFolder(`skins/banners/${id}`).catch(console.error);
  }
}
