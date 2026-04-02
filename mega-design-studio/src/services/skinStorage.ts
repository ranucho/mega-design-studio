import type {
  SlotSkin, BannerSkin, SkinSymbolSnapshot, SkinIndexEntry,
  SymbolGeneratorState, BannerProject, BannerComposition,
} from '@/types/shared';
import {
  putSlotSkin, putBannerSkin, removeSlotSkin, removeBannerSkin,
  addToSlotIndex, addToBannerIndex, removeFromSlotIndex, removeFromBannerIndex,
  updateSlotIndex, updateBannerIndex,
} from './skinDb';
import {
  isFirebaseConfigured, uploadSlotSkin as fbUploadSlot, uploadBannerSkin as fbUploadBanner,
  deleteSkinFolder, uploadManifest,
} from './firebase';

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
): Promise<SlotSkin> {
  const sourceImage = state.reskinResult || state.masterImage;
  const thumbnailUrl = sourceImage ? await generateThumbnail(sourceImage) : '';

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
) {
  setSymbolGenState(prev => {
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
    // Also update the active sourceFrame so the sync effect doesn't later
    // overwrite the skin with stale pre-load frame data
    const frames = prev.sourceFrames ?? [];
    const frameId = prev.activeSourceFrameId ?? frames[0]?.id;
    const updatedFrames = frames.map(f =>
      f.id === frameId ? { ...f, ...frameData, isProcessingMaster: false } : f
    );
    return {
      ...prev,
      ...frameData,
      sourceFrames: updatedFrames,
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
  });
}

// --- Slot Skin Update (overwrite existing skin with current state) ---

export async function updateSlotSkin(
  existingSkin: SlotSkin,
  state: SymbolGeneratorState,
): Promise<SlotSkin> {
  const sourceImage = state.reskinResult || state.masterImage;
  const thumbnailUrl = sourceImage ? await generateThumbnail(sourceImage) : existingSkin.thumbnailUrl;

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
