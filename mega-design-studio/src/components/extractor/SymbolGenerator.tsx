import React, { useRef, useState, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { useExtractor } from '@/contexts/ExtractorContext';
import { useApp } from '@/contexts/AppContext';
import { SkinSelector } from '@/components/shared/SkinSelector';
import {
  isolateSymbol,
  isolateSymbolWithFrame,
  cleanLongTile,
  extractReelsFrame,
  cleanReelsFrameWithReference,
  detectSymbolPositions,
  generateBackgroundImage,
  generateAnimation,
  modifyImage,
  upscaleSymbol,
  SYMBOL_WIDTH,
  SYMBOL_HEIGHT,
  LONG_TILE_WIDTH,
  LONG_TILE_HEIGHT,
} from '@/services/gemini';
import { SymbolItem, MergedFrame, ReferenceAsset, SourceFrame, SlotLayout } from '@/types';
import { VideoFullscreen } from '@/components/shared/VideoFullscreen';
import { parallelBatch } from '@/services/parallelBatch';
import { AspectRatioSelector } from '@/components/shared/AspectRatioSelector';
import { useToast } from '@/components/shared/Toast';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getClosestAspectRatioStatic(w: number, h: number): string {
  const ratio = w / h;
  const supported = [
    { str: '1:1', val: 1 },
    { str: '4:3', val: 4 / 3 },
    { str: '3:4', val: 3 / 4 },
    { str: '16:9', val: 16 / 9 },
    { str: '9:16', val: 9 / 16 },
  ];
  return supported.reduce((prev, curr) =>
    Math.abs(curr.val - ratio) < Math.abs(prev.val - ratio) ? curr : prev
  ).str;
}

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

type DragHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move' | 'create';

interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface DragItem {
  type: 'LIBRARY_SYMBOL' | 'GRID_SYMBOL';
  symbolId: string;
  gridR?: number;
  gridC?: number;
}

const DEFAULT_SYMBOL_NAMES = [
  '9', '10', 'J', 'Q', 'K', 'A',
  'High 1', 'High 2', 'Wild', 'Bonus', 'Scatter', 'Jackpot',
];

// ---------------------------------------------------------------------------
// SymbolVersionCard — shows one version of a symbol with its pixel dimensions
// ---------------------------------------------------------------------------

const SymbolVersionCard: React.FC<{ label: string; url: string | null | undefined; filename?: string }> = ({ label, url, filename }) => {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (!url) return;
    setDims(null);
    const img = new Image();
    img.onload = () => setDims({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = url;
  }, [url]);
  if (!url) return null;
  return (
    <div className="flex flex-col gap-2">
      {/* Label + download */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">{label}</span>
        <a
          href={url}
          download={filename || `${label}.png`}
          onClick={e => e.stopPropagation()}
          className="text-zinc-400 hover:text-white transition-colors"
          title={`Download ${label}`}
        >
          <i className="fas fa-download text-xs" />
        </a>
      </div>
      {/* Image at actual pixel size, scrollable */}
      <div className="bg-zinc-950 rounded-xl border border-zinc-700 overflow-auto" style={{ maxWidth: 500, maxHeight: '65vh' }}>
        {dims ? (
          <img src={url} style={{ width: dims.w, height: dims.h, display: 'block' }} />
        ) : (
          <div className="w-40 h-40 flex items-center justify-center">
            <i className="fas fa-spinner animate-spin text-zinc-500" />
          </div>
        )}
      </div>
      {/* Dimensions */}
      <div className="text-[10px] font-mono text-center text-zinc-500">
        {dims ? `${dims.w} × ${dims.h} px` : <span className="animate-pulse text-zinc-600">loading…</span>}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SymbolGenerator: React.FC<{ isVisible?: boolean }> = ({ isVisible = true }) => {
  const { symbolGenState, setSymbolGenState, setReferenceAssets, referenceAssets } = useExtractor();
  const { assetLibrary, addAsset, activeTab } = useApp();
  const { toast } = useToast();

  // Merged lab assets for asset picker (Feature 1)
  const labAssets = useMemo(() => {
    const seen = new Set(referenceAssets.map(a => a.id));
    const globalOnly = assetLibrary.filter(a => !seen.has(a.id));
    return [...referenceAssets, ...globalOnly];
  }, [referenceAssets, assetLibrary]);

  const {
    masterImage,
    reskinResult,
    masterPrompt,
    isProcessingMaster,
    activeMasterView,
    reelsFrame,
    reelsFrameCropCoordinates,
    hideReelsBg,
    useLongTiles,
    symbols,
    mergedFrames,
    gridRows,
    gridCols,
    gridState,
    layoutOffsetX,
    layoutOffsetY,
    layoutWidth,
    layoutHeight,
    layoutGutterHorizontal,
    layoutGutterVertical,
    symbolScale,
    savedFrames,
    selectedStartFrameId,
    selectedEndFrameId,
    animationPrompt,
    animationPrompts,
    animationVideoCount,
    generatedVideos,
    prompt,
    isProcessing,
    activeSubTab,
  } = symbolGenState;

  const updateState = (updates: Partial<typeof symbolGenState>) => {
    setSymbolGenState(prev => ({ ...prev, ...updates }));
  };

  // ---- Multi-frame helpers ----
  const activeFrame: SourceFrame | null = useMemo(() => {
    const frames = symbolGenState.sourceFrames ?? [];
    if (frames.length === 0) return null;
    return frames.find(f => f.id === symbolGenState.activeSourceFrameId) ?? frames[0];
  }, [symbolGenState.sourceFrames, symbolGenState.activeSourceFrameId]);

  // Active layout helpers
  const activeLayout: SlotLayout | null = useMemo(() => {
    const layouts = symbolGenState.layouts ?? [];
    if (layouts.length === 0) return null;
    return layouts.find(l => l.id === symbolGenState.activeLayoutId) ?? layouts[0];
  }, [symbolGenState.layouts, symbolGenState.activeLayoutId]);

  const updateActiveFrame = useCallback((updates: Partial<SourceFrame>) => {
    setSymbolGenState(prev => {
      const frames = prev.sourceFrames ?? [];
      if (frames.length === 0) return prev;
      const frameId = prev.activeSourceFrameId ?? frames[0]?.id;
      // Mirror frame fields to top-level so UI reads them immediately
      // (the sync effect only fires on id change, not on data change)
      const topLevel: Record<string, unknown> = {};
      if ('masterImage' in updates)               topLevel.masterImage = updates.masterImage ?? null;
      if ('reskinResult' in updates)              topLevel.reskinResult = updates.reskinResult ?? null;
      if ('reelsFrame' in updates)                topLevel.reelsFrame = updates.reelsFrame ?? null;
      if ('reelsFrameCropCoordinates' in updates) topLevel.reelsFrameCropCoordinates = updates.reelsFrameCropCoordinates ?? null;
      if ('masterPrompt' in updates)              topLevel.masterPrompt = updates.masterPrompt ?? '';
      if ('isProcessingMaster' in updates)        topLevel.isProcessingMaster = updates.isProcessingMaster ?? false;
      if ('activeMasterView' in updates)          topLevel.activeMasterView = updates.activeMasterView ?? 'source';
      return {
        ...prev,
        ...topLevel,
        sourceFrames: frames.map(f => f.id === frameId ? { ...f, ...updates } : f),
      };
    });
  }, [setSymbolGenState]);

  /** Update a specific frame by ID (safe across async operations — won't drift if active frame changes) */
  const updateFrameById = useCallback((frameId: string, updates: Partial<SourceFrame>) => {
    setSymbolGenState(prev => {
      const frames = prev.sourceFrames ?? [];
      const isActive = (prev.activeSourceFrameId ?? frames[0]?.id) === frameId;
      // Mirror to top-level only if this is the active frame
      const topLevel: Record<string, unknown> = {};
      if (isActive) {
        if ('masterImage' in updates)               topLevel.masterImage = updates.masterImage ?? null;
        if ('reskinResult' in updates)              topLevel.reskinResult = updates.reskinResult ?? null;
        if ('reelsFrame' in updates)                topLevel.reelsFrame = updates.reelsFrame ?? null;
        if ('reelsFrameCropCoordinates' in updates) topLevel.reelsFrameCropCoordinates = updates.reelsFrameCropCoordinates ?? null;
        if ('masterPrompt' in updates)              topLevel.masterPrompt = updates.masterPrompt ?? '';
        if ('isProcessingMaster' in updates)        topLevel.isProcessingMaster = updates.isProcessingMaster ?? false;
        if ('activeMasterView' in updates)          topLevel.activeMasterView = updates.activeMasterView ?? 'source';
      }
      return {
        ...prev,
        ...topLevel,
        sourceFrames: frames.map(f => f.id === frameId ? { ...f, ...updates } : f),
      };
    });
  }, [setSymbolGenState]);

  const updateActiveLayout = useCallback((updates: Partial<SlotLayout>) => {
    setSymbolGenState(prev => {
      const layouts = prev.layouts ?? [];
      if (layouts.length === 0) return prev;
      const layoutId = prev.activeLayoutId ?? layouts[0]?.id;
      // Mirror only layout fields that exist on top-level state (exclude sourceFrameId, id, name)
      const topLevel: Record<string, unknown> = {};
      const mirrorKeys = ['gridRows', 'gridCols', 'gridState', 'layoutOffsetX', 'layoutOffsetY',
        'layoutWidth', 'layoutHeight', 'layoutGutterHorizontal', 'layoutGutterVertical',
        'symbolScale', 'hideReelsBg', 'useLongTiles'] as const;
      for (const k of mirrorKeys) {
        if (k in updates) topLevel[k] = updates[k as keyof typeof updates];
      }
      return {
        ...prev,
        ...topLevel,
        layouts: layouts.map(l => l.id === layoutId ? { ...l, ...updates } : l),
      };
    });
  }, [setSymbolGenState]);

  // ---- Ephemeral UI state (not persisted to context) ----
  const masterWrapperRef = useRef<HTMLDivElement>(null);
  const masterImgRef = useRef<HTMLImageElement>(null);
  const [crop, setCrop] = useState<Crop>({ x: 10, y: 10, w: 20, h: 20 });
  const [dragState, setDragState] = useState<{
    handle: DragHandle;
    startX: number;
    startY: number;
    startCrop: Crop;
  } | null>(null);

  const [croppingSymbolId, setCroppingSymbolId] = useState<string | null>(null);
  const [cropMode, setCropMode] = useState<'symbol' | 'frame'>('symbol');
  // Custom crop source image (null = use master image)
  const [cropSourceOverride, setCropSourceOverride] = useState<string | null>(null);

  // Layout canvas
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number }>({ w: 1080, h: 1920 });

  // Drag & drop
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [selectedLayoutSymbolId, setSelectedLayoutSymbolId] = useState<string | null>(null);
  const [hoveredLayoutSymbolId, setHoveredLayoutSymbolId] = useState<string | null>(null);

  // Detected ratio for master reskin
  const [detectedRatio, setDetectedRatio] = useState<string>('16:9');

  // Fullscreen preview
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  // Symbol multi-version viewer
  const [viewingSymbol, setViewingSymbol] = useState<SymbolItem | null>(null);

  // Feature 1: Asset picker for loading from Lab
  const [showAssetPicker, setShowAssetPicker] = useState(false);

  // Feature 6: Per-symbol inpaint modal
  const [editingSymbol, setEditingSymbol] = useState<SymbolItem | null>(null);
  const [editPrompt, setEditPrompt] = useState('');
  const [editReference, setEditReference] = useState<string | null>(null);
  const [fullscreenVideo, setFullscreenVideo] = useState<string | null>(null);

  // =========================================================================
  // Initialisation
  // =========================================================================

  // Migrate legacy single-frame/layout state to multi-frame/layout on first load
  useEffect(() => {
    setSymbolGenState(prev => {
      let updated = { ...prev };

      // Migrate masterImage → sourceFrames[0] if sourceFrames is empty
      if ((prev.sourceFrames ?? []).length === 0) {
        const frame0: SourceFrame = {
          id: crypto.randomUUID(),
          name: 'Frame 1',
          masterImage: prev.masterImage,
          reskinResult: prev.reskinResult,
          reelsFrame: prev.reelsFrame,
          reelsFrameCropCoordinates: prev.reelsFrameCropCoordinates ?? null,
          masterPrompt: prev.masterPrompt,
          isProcessingMaster: false,
          activeMasterView: prev.activeMasterView,
        };
        updated = { ...updated, sourceFrames: [frame0], activeSourceFrameId: frame0.id };
      }

      // Migrate layout state → layouts[0]
      if ((prev.layouts ?? []).length === 0) {
        const layout0: SlotLayout = {
          id: crypto.randomUUID(),
          name: 'Layout 1',
          sourceFrameId: updated.sourceFrames[0]?.id ?? null,
          gridRows: prev.gridRows,
          gridCols: prev.gridCols,
          gridState: prev.gridState,
          layoutOffsetX: prev.layoutOffsetX,
          layoutOffsetY: prev.layoutOffsetY,
          layoutWidth: prev.layoutWidth,
          layoutHeight: prev.layoutHeight,
          layoutGutterHorizontal: prev.layoutGutterHorizontal,
          layoutGutterVertical: prev.layoutGutterVertical,
          symbolScale: prev.symbolScale,
          hideReelsBg: prev.hideReelsBg ?? false,
          useLongTiles: false,
        };
        updated = { ...updated, layouts: [layout0], activeLayoutId: layout0.id };
      }

      return updated;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync active layout → top-level state fields (for backward compat)
  useEffect(() => {
    if (!activeLayout) return;
    setSymbolGenState(prev => ({
      ...prev,
      gridRows: activeLayout.gridRows,
      gridCols: activeLayout.gridCols,
      gridState: activeLayout.gridState,
      layoutOffsetX: activeLayout.layoutOffsetX,
      layoutOffsetY: activeLayout.layoutOffsetY,
      layoutWidth: activeLayout.layoutWidth,
      layoutHeight: activeLayout.layoutHeight,
      layoutGutterHorizontal: activeLayout.layoutGutterHorizontal,
      layoutGutterVertical: activeLayout.layoutGutterVertical,
      symbolScale: activeLayout.symbolScale,
      hideReelsBg: activeLayout.hideReelsBg,
      useLongTiles: activeLayout.useLongTiles ?? false,
    }));
  }, [activeLayout?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync active frame → top-level state fields
  useEffect(() => {
    if (!activeFrame) return;
    setSymbolGenState(prev => ({
      ...prev,
      masterImage: activeFrame.masterImage,
      reskinResult: activeFrame.reskinResult,
      reelsFrame: activeFrame.reelsFrame,
      reelsFrameCropCoordinates: activeFrame.reelsFrameCropCoordinates,
      masterPrompt: activeFrame.masterPrompt,
      isProcessingMaster: activeFrame.isProcessingMaster,
      activeMasterView: activeFrame.activeMasterView,
    }));
  }, [activeFrame?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (symbols.length === 0) {
      const initial: SymbolItem[] = DEFAULT_SYMBOL_NAMES.map(name => ({
        id: crypto.randomUUID(),
        name,
        sourceUrl: '',
        rawCropDataUrl: null,
        isolatedUrl: null,
        isProcessing: false,
      }));
      updateState({ symbols: initial });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Rebuild grid when rows/cols change
  useEffect(() => {
    updateActiveLayout({
      gridState: (() => {
        const next: string[][] = Array(gridRows)
          .fill(null)
          .map(() => Array(gridCols).fill(''));
        const prev = gridState || [];
        for (let r = 0; r < Math.min(gridRows, prev.length); r++) {
          for (let c = 0; c < Math.min(gridCols, (prev[0]?.length ?? 0)); c++) {
            next[r][c] = prev[r][c];
          }
        }
        return next;
      })(),
    });
  }, [gridRows, gridCols]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-detect aspect ratio when masterImage changes (e.g. on project load)
  useEffect(() => {
    if (!masterImage) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setDetectedRatio(getClosestAspectRatioStatic(img.width, img.height));
    };
    img.src = masterImage;
    return () => { cancelled = true; };
  }, [masterImage]);

  // =========================================================================
  // MASTER REEL TAB
  // =========================================================================

  const handleMasterUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (!ev.target?.result) return;
      const img = new Image();
      img.onload = () => {
        setDetectedRatio(getClosestAspectRatioStatic(img.width, img.height));
        updateActiveFrame({
          masterImage: ev.target!.result as string,
          reskinResult: null,
          activeMasterView: 'source',
        });
      };
      img.src = ev.target.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleGenerateMaster = async () => {
    if (!masterImage || !masterPrompt) return;
    updateActiveFrame({ isProcessingMaster: true });
    try {
      // Build a smart reskin prompt — user only types the theme
      const symbolNames = symbols.map(s => s.name).join(', ');
      const fullPrompt = `Reskin this entire slot machine reel screen with the theme: "${masterPrompt}".

CRITICAL RULES:
- Do NOT change the grid layout, symbol positions, symbol order, or symbol sizes.
- Do NOT change the number of rows or columns.
- This is ONLY a visual reskin — same structure, new theme.
- Each symbol must remain recognizable as what it is:
  - Letters (A, K, Q, J) must stay as letters — just restyle them for the "${masterPrompt}" theme.
  - Numbers (10, 9) must stay as numbers — just restyle them.
  - High-value/thematic symbols should be redesigned as ${masterPrompt}-themed versions but keep similar shape and position.
- Current symbols on the grid: ${symbolNames}.
- Replace A with a ${masterPrompt}-themed A, Q with a ${masterPrompt}-themed Q, and so on for every symbol.
- Replace EVERY visual from the source image with the new theme — no original artwork should remain, EXCEPT brand logos (see below).
- Keep the same perspective, camera angle, and overall composition.
- CHARACTER PRESERVATION: If the original image has a character/mascot figure (e.g. in the header area above the reels), the reskin MUST include a NEW character that fits the "${masterPrompt}" theme in the SAME position, at the SAME scale and pose. Do NOT replace characters with landscapes or empty scenery — always replace a character WITH a character.
- BRAND LOGO PROTECTION: If there is a logo in the top corner of the image (e.g. "Club Vegas", a company/brand logo), it is a BRAND LOGO and must be kept EXACTLY as-is — same design, same text, same colors, same position. Do NOT rename it, retheme it, or replace it. Brand logos are sacred and untouchable.

COLOUR & CONTRAST REQUIREMENTS — THIS IS CRITICAL FOR VISUAL QUALITY:
- Use a RICH, DIVERSE colour palette — at minimum 5-6 distinct hues across all symbols.
- LOW PAY symbols (letters A/K/Q/J, numbers 10/9) must use DIFFERENT colours from each other (e.g. blue A, green K, purple Q, red J, orange 10, teal 9). They should look distinct at a glance.
- HIGH PAY thematic symbols must be VISUALLY DISTINCT from low pays — use brighter, more saturated, richer colours with glow/shine effects.
- SPECIAL symbols (Wild, Scatter, Bonus) must POP with the most vibrant, eye-catching colours and effects (gold, glowing, particle effects).
- CONTRAST: Every symbol must stand out clearly against the background. If the background is dark, symbols need bright colours, glow, or light outlines. If the background is light, symbols need dark outlines and rich saturated fills.
- NO monochrome palettes. Avoid making everything the same colour family. The result must look like a premium, commercially appealing slot machine with rich visual variety.`;

      const result = await generateBackgroundImage(fullPrompt, detectedRatio, masterImage);
      if (result) {
        updateActiveFrame({
          reskinResult: result,
          activeMasterView: 'reskinned',
          isProcessingMaster: false,
        });
        // Bridge reskinned master to Lab
        addAsset({
          id: `symgen-reskin-${Date.now()}`,
          url: result,
          type: 'style',
          name: `Reskin: ${masterPrompt}`,
        });
        toast('Master reel reskinned', { type: 'success' });
        // Auto re-extract symbols + background after reskin
        autoReExtractSymbols(result);
        autoReExtractBackground(result);
      } else {
        throw new Error('Generation returned null');
      }
    } catch (e) {
      console.error(e);
      toast('Master generation failed', { type: 'error' });
      updateActiveFrame({ isProcessingMaster: false });
    }
  };

  // Feature 1: Load master image from Lab assets
  const handleLoadFromLab = (asset: ReferenceAsset) => {
    const img = new Image();
    img.onload = () => {
      setDetectedRatio(getClosestAspectRatioStatic(img.width, img.height));
      updateActiveFrame({
        masterImage: asset.url,
        reskinResult: null,
        activeMasterView: 'source',
      });
    };
    img.src = asset.url;
    setShowAssetPicker(false);
  };

  const currentMasterImage = activeMasterView === 'reskinned' && reskinResult ? reskinResult : masterImage;
  // The image used in the crop modal — can be overridden to crop from a different source
  const cropImage = cropSourceOverride || currentMasterImage;

  // =========================================================================
  // CROP OVERLAY
  // =========================================================================

  const handleMouseDown = (e: React.MouseEvent, handle: DragHandle) => {
    e.preventDefault();
    e.stopPropagation();
    if (!masterWrapperRef.current) return;
    const rect = masterWrapperRef.current.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    let startCrop = crop;
    if (handle === 'create') {
      startCrop = { x: xPct, y: yPct, w: 0, h: 0 };
      setCrop(startCrop);
    }
    setDragState({ handle, startX: e.clientX, startY: e.clientY, startCrop });
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragState || !masterWrapperRef.current) return;
      const rect = masterWrapperRef.current.getBoundingClientRect();
      const deltaX = ((e.clientX - dragState.startX) / rect.width) * 100;
      const deltaY = ((e.clientY - dragState.startY) / rect.height) * 100;
      const s = dragState.startCrop;
      let newCrop = { ...s };

      if (dragState.handle === 'move') {
        newCrop = {
          x: Math.max(0, Math.min(100 - s.w, s.x + deltaX)),
          y: Math.max(0, Math.min(100 - s.h, s.y + deltaY)),
          w: s.w,
          h: s.h,
        };
      } else if (dragState.handle === 'create') {
        const currX = Math.max(0, Math.min(100, s.x + deltaX));
        const currY = Math.max(0, Math.min(100, s.y + deltaY));
        newCrop.x = Math.min(s.x, currX);
        newCrop.y = Math.min(s.y, currY);
        newCrop.w = Math.abs(currX - s.x);
        newCrop.h = Math.abs(currY - s.y);
      } else {
        let L = s.x, R = s.x + s.w, T = s.y, B = s.y + s.h;
        if (dragState.handle.includes('w')) L = Math.min(R - 1, Math.max(0, L + deltaX));
        if (dragState.handle.includes('e')) R = Math.max(L + 1, Math.min(100, R + deltaX));
        if (dragState.handle.includes('n')) T = Math.min(B - 1, Math.max(0, T + deltaY));
        if (dragState.handle.includes('s')) B = Math.max(T + 1, Math.min(100, B + deltaY));
        newCrop = { x: L, y: T, w: R - L, h: B - T };
      }
      setCrop(newCrop);
    };
    const onMouseUp = () => setDragState(null);
    if (dragState) {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragState]);

  // =========================================================================
  // EXTRACT TAB
  // =========================================================================

  const handleStartCrop = (symbolId: string) => {
    setCropMode('symbol');
    setCroppingSymbolId(symbolId);
    setCropSourceOverride(null); // default to master image
    // Use taller initial crop for long tiles (spanRows >= 3)
    const sym = symbols.find(s => s.id === symbolId);
    const isLongTile = (sym?.spanRows || 1) >= 3;
    if (isLongTile) {
      setCrop({ x: 35, y: 15, w: 12, h: 55 });
    } else {
      setCrop({ x: 42.5, y: 42.5, w: 15, h: 15 });
    }
  };

  const handleStartFrameCrop = () => {
    setCropSourceOverride(null);
    setCropMode('frame');
    setCroppingSymbolId('FRAME');
    setCrop({ x: 10, y: 10, w: 80, h: 80 });
  };

  const getCropDataUrl = (): string | null => {
    const img = masterImgRef.current;
    if (!img) return null;
    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    const px = Math.round((crop.x / 100) * natW);
    const py = Math.round((crop.y / 100) * natH);
    const pw = Math.round((crop.w / 100) * natW);
    const ph = Math.round((crop.h / 100) * natH);
    if (pw <= 0 || ph <= 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = pw;
    canvas.height = ph;
    const ctx = canvas.getContext('2d');
    ctx?.drawImage(img, px, py, pw, ph, 0, 0, pw, ph);
    return canvas.toDataURL('image/png');
  };

  const handleConfirmCrop = async () => {
    if (!croppingSymbolId) return;
    const isFrame = cropMode === 'frame';
    const currentCropId = croppingSymbolId;

    if (!isFrame) {
      setSymbolGenState(prev => ({
        ...prev,
        symbols: prev.symbols.map(s =>
          s.id === currentCropId ? { ...s, isProcessing: true } : s
        ),
      }));
    }
    setCroppingSymbolId(null);

    try {
      const cropDataUrl = getCropDataUrl();
      if (!cropDataUrl) throw new Error('Invalid crop');

      if (isFrame) {
        const storedFrameCrop = { ...crop };
        // Capture the frame ID now so async completion targets the correct frame
        const targetFrameId = symbolGenState.activeSourceFrameId ?? (symbolGenState.sourceFrames ?? [])[0]?.id;
        if (!targetFrameId) return;
        // Show processing state
        updateFrameById(targetFrameId, {
          reelsFrameCropCoordinates: storedFrameCrop,
          isProcessingMaster: true,
        });
        // AI cleans the frame (removes symbols, keeps everything else)
        try {
          const cleaned = await extractReelsFrame(cropDataUrl);
          const result = cleaned || cropDataUrl;
          updateFrameById(targetFrameId, {
            reelsFrame: result,
            isProcessingMaster: false,
          });
          const frameName = (symbolGenState.sourceFrames ?? []).find(f => f.id === targetFrameId)?.name ?? 'Reels Frame';
          addAsset({
            id: `symgen-reelsframe-${Date.now()}`,
            url: result,
            type: 'background',
            name: `${frameName} BG`,
          });
          toast('Reels frame extracted', { type: 'success' });
        } catch (frameErr) {
          console.error('Frame extraction failed', frameErr);
          toast('Frame extraction failed', { type: 'error' });
          // Fallback to raw crop
          updateFrameById(targetFrameId, {
            reelsFrame: cropDataUrl,
            isProcessingMaster: false,
          });
        }
      } else {
        const sym = symbols.find(s => s.id === currentCropId);
        const isLongTile = (sym?.spanRows || 1) >= 3;
        const useFrame = sym?.withFrame || false;

        // Long tile: AI cleans + frames (keeps background).
        // withFrame: AI isolates but keeps decorative frame/border.
        // Regular: AI isolates on white.
        const processed = isLongTile
          ? await cleanLongTile(cropDataUrl)
          : useFrame
            ? await isolateSymbolWithFrame(cropDataUrl)
            : await isolateSymbol(cropDataUrl);
        // Feature 4: Store crop coordinates for auto-re-extraction
        const storedCrop = { ...crop };
        const symbolName = sym?.name || 'Symbol';
        setSymbolGenState(prev => ({
          ...prev,
          symbols: prev.symbols.map(s =>
            s.id === currentCropId
              ? {
                  ...s,
                  sourceUrl: cropDataUrl,
                  rawCropDataUrl: cropDataUrl,
                  isolatedUrl: processed || cropDataUrl,
                  isProcessing: false,
                  cropCoordinates: storedCrop,
                  cropSourceView: activeMasterView,
                }
              : s
          ),
        }));
        // Bridge symbol to Lab
        addAsset({
          id: `symgen-symbol-${currentCropId}`,
          url: processed || cropDataUrl,
          type: isLongTile ? 'long_game_tile' : 'game_symbol',
          name: symbolName,
        });
        // Auto-enable long tiles in active layout when a long tile is extracted
        if (isLongTile) {
          updateActiveLayout({ useLongTiles: true });
        }
      }
    } catch (err) {
      console.error(err);
      toast('Extraction failed', { type: 'error' });
      if (!isFrame) {
        setSymbolGenState(prev => ({
          ...prev,
          symbols: prev.symbols.map(s =>
            s.id === currentCropId ? { ...s, isProcessing: false } : s
          ),
        }));
      }
    }
  };

  // ── Auto Extract Assets ──────────────────────────────────────────
  const [isAutoExtracting, setIsAutoExtracting] = useState(false);

  const handleAutoExtract = async () => {
    // Use whichever view is active (source or reskinned)
    const sourceImg = activeMasterView === 'reskinned' && reskinResult ? reskinResult : masterImage;
    if (!sourceImg) return;

    setIsAutoExtracting(true);
    try {
      // Step 1: AI detects all unique symbols and their bounding boxes
      const detected = await detectSymbolPositions(sourceImg);
      if (!detected.length) {
        toast('No symbols detected in the image', { type: 'error' });
        setIsAutoExtracting(false);
        return;
      }

      // Step 2: Load image for canvas cropping
      const img = new Image();
      img.src = sourceImg;
      await new Promise<void>(r => { img.onload = () => r(); img.onerror = () => r(); });
      if (!img.width || !img.height) { setIsAutoExtracting(false); return; }

      // Step 3: Create symbol entries from detected symbols
      const newDetected: typeof symbols = detected.map((det, i) => ({
        id: `auto-${Date.now()}-${i}`,
        name: det.name,
        sourceUrl: sourceImg,
        rawCropDataUrl: null,
        isolatedUrl: null,
        isProcessing: true,
        cropCoordinates: det.bbox,
        cropSourceView: activeMasterView as 'source' | 'reskinned',
        spanRows: det.isLongTile ? 3 : 1,
        withFrame: det.role !== 'low',
        symbolRole: det.role,
      }));

      // Merge into existing symbol slots: match by name (case-insensitive),
      // keep unmatched defaults as empty placeholders, append any extras
      const mergedSymbols = symbols.map(existing => {
        const match = newDetected.find(d => d.name.toLowerCase() === existing.name.toLowerCase());
        if (match) return match;
        // Keep existing placeholder but clear any stale data
        return { ...existing, isProcessing: false };
      });
      // Add detected symbols that didn't match any existing slot
      const existingSlotNames = new Set(symbols.map(s => s.name.toLowerCase()));
      const extras = newDetected.filter(d => !existingSlotNames.has(d.name.toLowerCase()));
      const allSymbols = [...mergedSymbols, ...extras];

      updateState({ symbols: allSymbols, activeSubTab: 'extract' });
      const newSymbols = newDetected; // reference for crop loop below

      // Step 4: Pre-crop all symbols (canvas ops are instant), show raw crops immediately,
      // then AI-isolate in parallel batches of 4
      const cropData: { det: typeof detected[0]; sym: typeof newSymbols[0]; cropDataUrl: string }[] = [];
      for (let i = 0; i < detected.length; i++) {
        const det = detected[i];
        const sym = newSymbols[i];
        const canvas = document.createElement('canvas');
        // Add padding for framed symbols so the frame isn't cut
        const hasFrame = det.role !== 'low';
        const padPct = hasFrame ? 2 : 0; // 2% padding for framed symbols
        const bx = Math.max(0, det.bbox.x - padPct);
        const by = Math.max(0, det.bbox.y - padPct);
        const bw = Math.min(100 - bx, det.bbox.w + padPct * 2);
        const bh = Math.min(100 - by, det.bbox.h + padPct * 2);
        const px = Math.round((bx / 100) * img.width);
        const py = Math.round((by / 100) * img.height);
        const pw = Math.round((bw / 100) * img.width);
        const ph = Math.round((bh / 100) * img.height);
        if (pw <= 0 || ph <= 0) continue;
        canvas.width = pw;
        canvas.height = ph;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, px, py, pw, ph, 0, 0, pw, ph);
        // Store the padded coordinates for re-extraction
        sym.cropCoordinates = { x: bx, y: by, w: bw, h: bh };
        cropData.push({ det, sym, cropDataUrl: canvas.toDataURL('image/png') });
      }

      // Show raw crops immediately so user sees what was detected
      setSymbolGenState(prev => ({
        ...prev,
        symbols: prev.symbols.map(s => {
          const crop = cropData.find(c => c.sym.id === s.id);
          return crop ? { ...s, rawCropDataUrl: crop.cropDataUrl } : s;
        }),
      }));

      await parallelBatch(
        cropData,
        async (item) => {
          const { det, sym, cropDataUrl } = item;
          const isLongTile = det.isLongTile;
          const useFrame = det.role !== 'low';
          const processed = isLongTile
            ? await cleanLongTile(cropDataUrl)
            : useFrame
              ? await isolateSymbolWithFrame(cropDataUrl)
              : await isolateSymbol(cropDataUrl);
          return { det, sym, cropDataUrl, processed, isLongTile };
        },
        (result) => {
          const { det, sym, cropDataUrl, processed, isLongTile } = result;
          setSymbolGenState(prev => ({
            ...prev,
            symbols: prev.symbols.map(s =>
              s.id === sym.id
                ? { ...s, rawCropDataUrl: cropDataUrl, isolatedUrl: processed || cropDataUrl, isProcessing: false }
                : s
            ),
          }));
          addAsset({
            id: `symgen-symbol-${sym.id}`,
            url: processed || cropDataUrl,
            type: isLongTile ? 'long_game_tile' : 'game_symbol',
            name: det.name,
          });
          if (isLongTile) {
            updateActiveLayout({ useLongTiles: true });
          }
        },
        4, // batch size — 4 parallel AI calls
        300, // delay between batches
        // onItemError: mark failed symbols as done so they don't stay stuck loading
        (error, item) => {
          console.warn(`Symbol isolation failed for "${item.det.name}":`, error.message);
          setSymbolGenState(prev => ({
            ...prev,
            symbols: prev.symbols.map(s =>
              s.id === item.sym.id
                ? { ...s, isolatedUrl: item.cropDataUrl, isProcessing: false }
                : s
            ),
          }));
        },
      );
      toast('Symbols extracted', { type: 'success' });
    } catch (err) {
      console.error('Auto extract failed:', err);
      toast('Auto extract failed', { type: 'error' });
    } finally {
      setIsAutoExtracting(false);
    }
  };

  const handleRetryIsolation = async (symbolId: string) => {
    const sym = symbols.find(s => s.id === symbolId);
    if (!sym || !sym.rawCropDataUrl) return;
    const rawCrop = sym.rawCropDataUrl;
    const isLongTile = (sym.spanRows || 1) >= 3;
    const useFrame = sym.withFrame || false;

    setSymbolGenState(prev => ({
      ...prev,
      symbols: prev.symbols.map(s => (s.id === symbolId ? { ...s, isProcessing: true } : s)),
    }));
    try {
      const processed = isLongTile
        ? await cleanLongTile(rawCrop)
        : useFrame
          ? await isolateSymbolWithFrame(rawCrop)
          : await isolateSymbol(rawCrop);
      setSymbolGenState(prev => ({
        ...prev,
        symbols: prev.symbols.map(s =>
          s.id === symbolId
            ? { ...s, isolatedUrl: processed || rawCrop || null, isProcessing: false }
            : s
        ),
      }));
    } catch (err) {
      console.error(err);
      toast('Retry failed', { type: 'error' });
      setSymbolGenState(prev => ({
        ...prev,
        symbols: prev.symbols.map(s => (s.id === symbolId ? { ...s, isProcessing: false } : s)),
      }));
    }
  };

  // ── Bulk re-process all symbols (parallel) ──────────────────────
  const [isBulkRetrying, setIsBulkRetrying] = useState(false);

  const handleBulkReprocess = async () => {
    const eligible = symbols.filter(s => s.rawCropDataUrl && !s.isProcessing);
    if (eligible.length === 0) return;

    setIsBulkRetrying(true);
    // Mark all eligible as processing
    setSymbolGenState(prev => ({
      ...prev,
      symbols: prev.symbols.map(s =>
        s.rawCropDataUrl && !s.isProcessing ? { ...s, isProcessing: true } : s
      ),
    }));

    try {
      await parallelBatch(
        eligible,
        async (sym) => {
          const rawCrop = sym.rawCropDataUrl!;
          const isLongTile = (sym.spanRows || 1) >= 3;
          const useFrame = sym.withFrame || false;
          const processed = isLongTile
            ? await cleanLongTile(rawCrop)
            : useFrame
              ? await isolateSymbolWithFrame(rawCrop)
              : await isolateSymbol(rawCrop);
          return { sym, processed, isLongTile };
        },
        (result) => {
          const { sym, processed, isLongTile } = result;
          setSymbolGenState(prev => ({
            ...prev,
            symbols: prev.symbols.map(s =>
              s.id === sym.id
                ? { ...s, isolatedUrl: processed || sym.rawCropDataUrl || null, isProcessing: false }
                : s
            ),
          }));
          addAsset({
            id: `symgen-symbol-${sym.id}`,
            url: processed || sym.rawCropDataUrl || '',
            type: isLongTile ? 'long_game_tile' : 'game_symbol',
            name: sym.name,
          });
        },
        4,
        300,
      );
      toast('Symbols reprocessed', { type: 'success' });
    } catch (err) {
      console.error('Bulk reprocess failed:', err);
      toast('Bulk reprocess failed', { type: 'error' });
    } finally {
      // Clear any remaining processing flags
      setSymbolGenState(prev => ({
        ...prev,
        symbols: prev.symbols.map(s => ({ ...s, isProcessing: false })),
      }));
      setIsBulkRetrying(false);
    }
  };

  const handleUpscaleSymbol = useCallback(async (symbolId: string, scale: 2 | 3 = 2) => {
    // Read current isolatedUrl from latest state snapshot
    let isolatedUrl: string | null = null;
    let symName = symbolId;
    setSymbolGenState(prev => {
      const sym = prev.symbols.find(s => s.id === symbolId);
      if (!sym?.isolatedUrl) return prev;
      isolatedUrl = sym.isolatedUrl;
      symName = sym.name;
      return { ...prev, symbols: prev.symbols.map(s => s.id === symbolId ? { ...s, isUpscaling: true } : s) };
    });

    // Wait a tick so state has settled before checking
    await new Promise(r => setTimeout(r, 0));
    if (!isolatedUrl) return;

    try {
      const result = await upscaleSymbol(isolatedUrl, scale);
      if (result) {
        setSymbolGenState(prev => ({
          ...prev,
          symbols: prev.symbols.map(s => s.id === symbolId
            ? { ...s, isUpscaling: false, upscaledUrls: { ...s.upscaledUrls, [scale]: result } }
            : s
          ),
        }));
        toast(`${symName} upscaled ${scale}×`, { type: 'success' });
      } else {
        throw new Error('Upscale returned null');
      }
    } catch (e) {
      console.error('[upscale]', e);
      toast('Upscale failed', { type: 'error' });
      setSymbolGenState(prev => ({
        ...prev,
        symbols: prev.symbols.map(s => s.id === symbolId ? { ...s, isUpscaling: false } : s),
      }));
    }
  }, [setSymbolGenState, toast]);

  const handleUpscaleAll = useCallback(async (scale: 2 | 3 = 2) => {
    const eligible = symbols.filter(s => s.isolatedUrl && !s.isProcessing && !s.isUpscaling);
    if (eligible.length === 0) return;
    toast(`Upscaling ${eligible.length} symbol${eligible.length > 1 ? 's' : ''} ${scale}× in parallel…`, { type: 'info' });
    const BATCH = 4;
    for (let i = 0; i < eligible.length; i += BATCH) {
      await Promise.all(eligible.slice(i, i + BATCH).map(sym => handleUpscaleSymbol(sym.id, scale)));
    }
  }, [symbols, handleUpscaleSymbol, toast]);

  const saveSymbolToAssets = (sym: SymbolItem) => {
    if (!sym.isolatedUrl) return;
    const asset: ReferenceAsset = {
      id: crypto.randomUUID(),
      url: sym.isolatedUrl,
      type: 'game_symbol',
      name: sym.name,
    };
    setReferenceAssets(prev => [...prev, asset]);
    toast('Saved to Assets', { type: 'success' });
  };

  // Feature 4: Auto re-extract all symbols after reskin
  const autoReExtractSymbols = async (reskinImageUrl: string) => {
    const symbolsWithCrops = symbols.filter(s => s.cropCoordinates && s.cropCoordinates.w > 0);
    if (symbolsWithCrops.length === 0) return;

    // Mark all as processing
    setSymbolGenState(prev => ({
      ...prev,
      symbols: prev.symbols.map(s =>
        s.cropCoordinates && s.cropCoordinates.w > 0 ? { ...s, isProcessing: true } : s
      ),
    }));

    // Load reskinned image
    const img = new Image();
    img.src = reskinImageUrl;
    await new Promise<void>(r => { img.onload = () => r(); img.onerror = () => r(); });
    if (!img.width || !img.height) return;

    await parallelBatch(
      symbolsWithCrops,
      async (sym) => {
        const coords = sym.cropCoordinates!;
        const isLongTile = (sym.spanRows || 1) >= 3;
        const canvas = document.createElement('canvas');
        const px = Math.round((coords.x / 100) * img.width);
        const py = Math.round((coords.y / 100) * img.height);
        const pw = Math.round((coords.w / 100) * img.width);
        const ph = Math.round((coords.h / 100) * img.height);
        if (pw <= 0 || ph <= 0) return { sym, newCropDataUrl: null, processed: null, isLongTile };
        canvas.width = pw;
        canvas.height = ph;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, px, py, pw, ph, 0, 0, pw, ph);
        const newCropDataUrl = canvas.toDataURL('image/png');
        const useFrame = sym.withFrame || false;
        const processed = isLongTile
          ? await cleanLongTile(newCropDataUrl)
          : useFrame
            ? await isolateSymbolWithFrame(newCropDataUrl)
            : await isolateSymbol(newCropDataUrl);
        return { sym, newCropDataUrl, processed, isLongTile };
      },
      (result) => {
        const { sym, newCropDataUrl, processed, isLongTile } = result;
        if (!newCropDataUrl) {
          setSymbolGenState(prev => ({
            ...prev,
            symbols: prev.symbols.map(s => s.id === sym.id ? { ...s, isProcessing: false } : s),
          }));
          return;
        }
        setSymbolGenState(prev => ({
          ...prev,
          symbols: prev.symbols.map(s =>
            s.id === sym.id
              ? { ...s, rawCropDataUrl: newCropDataUrl, isolatedUrl: processed || newCropDataUrl, isProcessing: false, cropSourceView: 'reskinned' as const }
              : s
          ),
        }));
        addAsset({
          id: `symgen-symbol-${sym.id}`,
          url: isLongTile ? newCropDataUrl : (processed || newCropDataUrl),
          type: isLongTile ? 'long_game_tile' : 'game_symbol',
          name: sym.name,
        });
      },
      4, // batch size
      500, // delay between batches
    );
  };

  // Auto re-extract background (reels frame) after reskin using stored crop coords.
  // Uses the original clean frame as a reference so the AI knows exactly what "clean" looks like.
  const autoReExtractBackground = async (reskinImageUrl: string) => {
    // Only use the active frame's own clean frame as reference. Borrowing a
    // sibling frame's clean frame causes foreground content (leaves, decor)
    // from that image to bleed into the output.
    const cleanRef = activeFrame?.reelsFrame ?? reelsFrame;
    // Capture frame ID so async completion targets the correct frame
    const targetFrameId = symbolGenState.activeSourceFrameId ?? (symbolGenState.sourceFrames ?? [])[0]?.id;

    setIsCleaningFrame(true);

    const img = new Image();
    img.src = reskinImageUrl;
    await new Promise<void>(r => { img.onload = () => r(); img.onerror = () => r(); });
    if (!img.width || !img.height) { setIsCleaningFrame(false); return; }

    try {
      let dirtyCrop: string;
      const frameCropCoords = activeFrame?.reelsFrameCropCoordinates ?? reelsFrameCropCoordinates;

      if (frameCropCoords && frameCropCoords.w > 0) {
        // Crop the reskinned image using stored coordinates
        const canvas = document.createElement('canvas');
        const px = Math.round((frameCropCoords.x / 100) * img.width);
        const py = Math.round((frameCropCoords.y / 100) * img.height);
        const pw = Math.round((frameCropCoords.w / 100) * img.width);
        const ph = Math.round((frameCropCoords.h / 100) * img.height);
        if (pw <= 0 || ph <= 0) { setIsCleaningFrame(false); return; }
        canvas.width = pw;
        canvas.height = ph;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, px, py, pw, ph, 0, 0, pw, ph);
        dirtyCrop = canvas.toDataURL('image/png');
      } else {
        // No crop coordinates — can't auto-extract background without knowing where the reels are
        console.log('[autoReExtractBackground] No crop coordinates, skipping. User needs to manually crop the frame.');
        setIsCleaningFrame(false);
        return;
      }

      let result: string;
      if (cleanRef) {
        // Pass 1: reference-based clean (sends original clean frame so AI knows the target)
        const refCleaned = await cleanReelsFrameWithReference(dirtyCrop, cleanRef);
        result = refCleaned || dirtyCrop;
        // Pass 2: standard clean to catch any remaining artifacts
        const polished = await extractReelsFrame(result);
        if (polished) result = polished;
      } else {
        // No reference available — single strict pass. Multiple passes
        // compound drift (each pass hallucinates small decorative changes).
        const cleaned = await extractReelsFrame(dirtyCrop);
        result = cleaned || dirtyCrop;
      }

      if (targetFrameId) {
        updateFrameById(targetFrameId, { reelsFrame: result });
      } else {
        updateActiveFrame({ reelsFrame: result });
      }
      addAsset({
        id: `symgen-reelsframe-${Date.now()}`,
        url: result,
        type: 'background',
        name: 'Reels Frame (Reskinned)',
      });
      toast('Reels frame extracted', { type: 'success' });
    } catch (err) {
      console.error('Auto re-extract background failed', err);
    } finally {
      setIsCleaningFrame(false);
    }
  };

  // Feature 5: Upload custom asset per symbol
  const handleUploadSymbol = (symbolId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const symName = symbols.find(s => s.id === symbolId)?.name || 'Symbol';
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (!ev.target?.result) return;
      const dataUrl = ev.target.result as string;
      setSymbolGenState(prev => ({
        ...prev,
        symbols: prev.symbols.map(s =>
          s.id === symbolId ? { ...s, isolatedUrl: dataUrl, rawCropDataUrl: s.rawCropDataUrl || dataUrl } : s
        ),
      }));
      // Bridge uploaded symbol to Lab
      addAsset({
        id: `symgen-symbol-${symbolId}`,
        url: dataUrl,
        type: 'game_symbol',
        name: symName,
      });
    };
    reader.readAsDataURL(file);
  };

  // Proportional fit into canonical dimensions (no stretch/distortion)
  const resizeToCanonical = (dataUrl: string, w: number, h: number, bgColor = '#FFFFFF'): Promise<string> =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, w, h);
        const scale = Math.min(w / img.width, h / img.height);
        const dw = Math.round(img.width * scale);
        const dh = Math.round(img.height * scale);
        ctx.drawImage(img, Math.round((w - dw) / 2), Math.round((h - dh) / 2), dw, dh);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });

  // Feature 6: Per-symbol inpaint
  const handleEditSymbol = async () => {
    if (!editingSymbol || !editPrompt || !editingSymbol.isolatedUrl) return;
    const symbolId = editingSymbol.id;
    const symbolName = editingSymbol.name;
    const symbolIsolatedUrl = editingSymbol.isolatedUrl;
    const isLongTile = (editingSymbol.spanRows || 1) >= 3;
    const isReelsFrame = symbolId === '__reelsframe__';
    const prompt = editPrompt;
    const localRef = editReference;
    setEditingSymbol(null);
    setEditPrompt('');
    setEditReference(null);

    // Show processing state
    if (isReelsFrame) {
      setIsCleaningFrame(true);
    } else {
      setSymbolGenState(prev => ({
        ...prev,
        symbols: prev.symbols.map(s => s.id === symbolId ? { ...s, isProcessing: true } : s),
      }));
    }

    try {
      const editAssets: ReferenceAsset[] = [];
      if (localRef) editAssets.push({ id: 'temp-edit-ref', url: localRef, type: 'style', name: 'Edit Reference' });

      if (isReelsFrame) {
        // Measure the original reels frame so we can lock the edited result
        // back to the same pixel dimensions (Gemini returns arbitrary sizes
        // that fit its aspect-ratio preset, not the source's exact crop size).
        const origDims = await new Promise<{ w: number; h: number }>((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = () => resolve({ w: 0, h: 0 });
          img.src = symbolIsolatedUrl;
        });
        // Pick the closest Gemini aspect-ratio preset to the real frame shape.
        const pickRatio = (w: number, h: number): string => {
          if (!w || !h) return '1:1';
          const r = w / h;
          const presets: Array<[string, number]> = [
            ['16:9', 16 / 9], ['4:3', 4 / 3], ['1:1', 1], ['3:4', 3 / 4], ['9:16', 9 / 16],
          ];
          return presets.reduce((best, cur) => Math.abs(cur[1] - r) < Math.abs(best[1] - r) ? cur : best)[0];
        };
        const editRatio = pickRatio(origDims.w, origDims.h);
        let modified = await modifyImage(symbolIsolatedUrl, prompt, editRatio, editAssets, true);
        // Force output to match original frame's exact pixel dimensions
        if (origDims.w > 0 && origDims.h > 0) {
          modified = await new Promise<string>((resolve) => {
            const img = new Image();
            img.onload = () => {
              const c = document.createElement('canvas');
              c.width = origDims.w;
              c.height = origDims.h;
              const ctx = c.getContext('2d');
              if (!ctx) { resolve(modified); return; }
              ctx.drawImage(img, 0, 0, origDims.w, origDims.h);
              resolve(c.toDataURL('image/png'));
            };
            img.onerror = () => resolve(modified);
            img.src = modified;
          });
        }
        updateActiveFrame({ reelsFrame: modified });
        addAsset({ id: `symgen-reelsframe-${Date.now()}`, url: modified, type: 'background', name: 'Reels Frame (Edited)' });
        setIsCleaningFrame(false);
      } else {
        // Edit a regular symbol or long tile
        const editRatio = isLongTile ? '9:16' : '1:1';
        let modified = await modifyImage(symbolIsolatedUrl, prompt, editRatio, editAssets, true);
        modified = await resizeToCanonical(
          modified,
          isLongTile ? LONG_TILE_WIDTH : SYMBOL_WIDTH,
          isLongTile ? LONG_TILE_HEIGHT : SYMBOL_HEIGHT,
        );

        setSymbolGenState(prev => ({
          ...prev,
          symbols: prev.symbols.map(s =>
            s.id === symbolId ? { ...s, isolatedUrl: modified, isProcessing: false } : s
          ),
        }));

        const assetType = isLongTile ? 'long_game_tile' : 'game_symbol';
        setReferenceAssets(prev =>
          prev.map(a => a.name === symbolName && (a.type === 'game_symbol' || a.type === 'long_game_tile') ? { ...a, url: modified } : a)
        );
        addAsset({
          id: `symgen-symbol-${symbolId}`,
          url: modified,
          type: assetType,
          name: symbolName,
        });
      }
    } catch (err) {
      console.error('Edit failed', err);
      toast('Edit failed', { type: 'error' });
      if (isReelsFrame) {
        setIsCleaningFrame(false);
      } else {
        setSymbolGenState(prev => ({
          ...prev,
          symbols: prev.symbols.map(s => s.id === symbolId ? { ...s, isProcessing: false } : s),
        }));
      }
    }
  };

  const handleEditReferenceUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => { if (event.target?.result) setEditReference(event.target.result as string); };
      reader.readAsDataURL(file);
    }
  };

  // Clear / delete extracted image from a symbol slot
  const handleClearSymbol = (symbolId: string) => {
    setSymbolGenState(prev => ({
      ...prev,
      symbols: prev.symbols.map(s =>
        s.id === symbolId ? { ...s, isolatedUrl: null, rawCropDataUrl: null, cropCoordinates: null, cropSourceView: undefined } : s
      ),
    }));
  };

  // Optional: AI-clean the reels frame (remove symbols from background)
  const [isCleaningFrame, setIsCleaningFrame] = useState(false);
  const handleAICleanFrame = async () => {
    if (!reelsFrame || isCleaningFrame) return;
    const targetFrameId = symbolGenState.activeSourceFrameId ?? (symbolGenState.sourceFrames ?? [])[0]?.id;
    setIsCleaningFrame(true);
    try {
      const cleaned = await extractReelsFrame(reelsFrame);
      if (cleaned) {
        if (targetFrameId) {
          updateFrameById(targetFrameId, { reelsFrame: cleaned });
        } else {
          updateActiveFrame({ reelsFrame: cleaned });
        }
        addAsset({
          id: `symgen-reelsframe-${Date.now()}`,
          url: cleaned,
          type: 'background',
          name: 'Reels Frame (AI Cleaned)',
        });
      }
      toast('Frame cleaned', { type: 'success' });
    } catch (err) {
      console.error('AI frame clean failed', err);
      toast('Frame clean failed', { type: 'error' });
    } finally {
      setIsCleaningFrame(false);
    }
  };

  // =========================================================================
  // LAYOUT & ANIMATE TAB
  // =========================================================================

  // ---- Grid fill presets ----

  // Helper: build a grid that places long tiles first, then fills remaining cells with regular symbols
  const buildGridWithLongTiles = (
    regularIds: string[],
    longTileIds: string[],
    overrides?: { r: number; c: number; id: string }[],
  ): string[][] => {
    const g: string[][] = Array(gridRows).fill(null).map(() => Array(gridCols).fill(''));
    const occupied = new Set<string>(); // "r-c" keys

    // Place long tiles: for each column, try to fit long tiles stacked from top
    if (longTileIds.length > 0) {
      for (let c = 0; c < gridCols; c++) {
        let r = 0;
        while (r + 3 <= gridRows) {
          // ~30% chance to place a long tile in this slot (keep it varied)
          if (Math.random() < 0.3) {
            const ltId = longTileIds[Math.floor(Math.random() * longTileIds.length)];
            g[r][c] = ltId;
            occupied.add(`${r}-${c}`);
            for (let sr = 1; sr < 3; sr++) {
              g[r + sr][c] = ''; // covered by long tile
              occupied.add(`${r + sr}-${c}`);
            }
            r += 3;
          } else {
            r += 1;
          }
        }
      }
    }

    // Fill remaining empty cells with regular symbols
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        if (!occupied.has(`${r}-${c}`)) {
          g[r][c] = regularIds[Math.floor(Math.random() * regularIds.length)];
        }
      }
    }

    // Apply overrides (e.g. for V-shape wild placement)
    if (overrides) {
      overrides.forEach(({ r, c, id }) => {
        if (r >= gridRows || c >= gridCols) return;
        // If this cell is the anchor of a long tile, fill orphaned covered cells below
        const existingId = g[r][c];
        if (existingId) {
          const existingSym = symbols.find(s => s.id === existingId);
          const existingSpan = existingSym?.spanRows || 1;
          if (existingSpan > 1) {
            for (let sr = 1; sr < existingSpan && (r + sr) < gridRows; sr++) {
              g[r + sr][c] = regularIds[Math.floor(Math.random() * regularIds.length)];
            }
          }
        }
        // Also check if this cell is COVERED by a long tile above — break that tile
        for (let rr = r - 1; rr >= 0 && rr >= r - 2; rr--) {
          const aboveId = g[rr][c];
          if (aboveId) {
            const aboveSym = symbols.find(s => s.id === aboveId);
            if ((aboveSym?.spanRows || 1) + rr > r) {
              // This cell is covered by a long tile at rr — replace the long tile with a regular symbol
              g[rr][c] = regularIds[Math.floor(Math.random() * regularIds.length)];
              for (let sr = 1; sr < (aboveSym?.spanRows || 1) && (rr + sr) < gridRows; sr++) {
                if (rr + sr !== r) g[rr + sr][c] = regularIds[Math.floor(Math.random() * regularIds.length)];
              }
            }
            break;
          }
        }
        g[r][c] = id;
      });
    }

    return g;
  };

  const handleRandomFill = () => {
    const regularIds = symbols.filter(s => s.isolatedUrl && (s.spanRows || 1) === 1).map(s => s.id);
    const longTileIds = (useLongTiles ?? false) ? symbols.filter(s => s.isolatedUrl && (s.spanRows || 1) >= 3).map(s => s.id) : [];
    if (regularIds.length === 0) { toast('Extract symbols first', { type: 'error' }); return; }
    updateActiveLayout({ gridState: buildGridWithLongTiles(regularIds, longTileIds), hideReelsBg: false });
  };

  const handleVShapeFill = () => {
    const wild = symbols.find(s => s.name === 'Wild' && (s.spanRows || 1) === 1);
    if (!wild || !wild.isolatedUrl) { toast("Extract 'Wild' symbol first", { type: 'error' }); return; }
    const others = symbols.filter(s => s.isolatedUrl && s.id !== wild.id && (s.spanRows || 1) === 1).map(s => s.id);
    const longTileIds = (useLongTiles ?? false) ? symbols.filter(s => s.isolatedUrl && (s.spanRows || 1) >= 3).map(s => s.id) : [];
    if (others.length === 0) { toast('Extract other symbols first', { type: 'error' }); return; }

    const vCoords = [
      { r: 1, c: 0 }, { r: 2, c: 1 }, { r: 3, c: 2 }, { r: 2, c: 3 }, { r: 1, c: 4 },
    ].map(({ r, c }) => ({ r, c, id: wild.id }));
    updateActiveLayout({ gridState: buildGridWithLongTiles(others, longTileIds, vCoords), hideReelsBg: false });
  };

  const handleChessboardFill = () => {
    const wild = symbols.find(s => s.name === 'Wild' && (s.spanRows || 1) === 1);
    if (!wild || !wild.isolatedUrl) { toast("Extract 'Wild' symbol first for Chessboard", { type: 'error' }); return; }
    const others = symbols.filter(s => s.isolatedUrl && s.id !== wild.id && (s.spanRows || 1) === 1).map(s => s.id);
    if (others.length === 0) { toast('Extract other symbols first', { type: 'error' }); return; }

    // Chessboard doesn't mix well with long tiles — use regular symbols only
    const g = (gridState || []).map((row, r) =>
      row.map((_, c) =>
        (r + c) % 2 === 0
          ? wild.id
          : others[Math.floor(Math.random() * others.length)]
      )
    );
    updateActiveLayout({ gridState: g, hideReelsBg: false });
  };

  const handleClearVShapeFill = () => {
    const wild = symbols.find(s => s.name === 'Wild' && (s.spanRows || 1) === 1);
    if (!wild || !wild.isolatedUrl) { toast("Extract 'Wild' symbol first", { type: 'error' }); return; }
    const vPositions = new Set(
      [{ r: 1, c: 0 }, { r: 2, c: 1 }, { r: 3, c: 2 }, { r: 2, c: 3 }, { r: 1, c: 4 }]
        .map(({ r, c }) => `${r}-${c}`)
    );
    const g = (gridState || []).map((row, r) =>
      row.map((_, c) => vPositions.has(`${r}-${c}`) ? wild.id : '')
    );
    updateActiveLayout({ gridState: g, hideReelsBg: true });
  };

  const handleClearChessFill = () => {
    const wild = symbols.find(s => s.name === 'Wild' && (s.spanRows || 1) === 1);
    if (!wild || !wild.isolatedUrl) { toast("Extract 'Wild' symbol first", { type: 'error' }); return; }
    const g = (gridState || []).map((row, r) =>
      row.map((_, c) => (r + c) % 2 === 0 ? wild.id : '')
    );
    updateActiveLayout({ gridState: g, hideReelsBg: true });
  };

  const handleClearGrid = () => {
    updateActiveLayout({ gridState: (gridState || []).map(row => row.map(() => '')), hideReelsBg: false });
  };

  // ---- Drag & Drop ----

  const handleDragStartLibrary = (e: React.DragEvent, symbolId: string) => {
    setDragItem({ type: 'LIBRARY_SYMBOL', symbolId });
    e.dataTransfer.effectAllowed = 'copy';
  };

  // Convert canvas mouse event to grid cell [row, col] using same math as drawLayout
  const canvasEventToCell = useCallback((e: React.DragEvent | React.MouseEvent): [number, number] | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;

    const gW = canvas.width * (layoutWidth / 100);
    const gH = canvas.height * (layoutHeight / 100);
    const gH_gutter = layoutGutterHorizontal || 0;
    const gV_gutter = layoutGutterVertical || 0;
    const totalGutterW = (gridCols - 1) * gH_gutter;
    const totalGutterH = (gridRows - 1) * gV_gutter;
    const cellW = (gW - totalGutterW) / gridCols;
    const cellH = (gH - totalGutterH) / gridRows;
    const startX = ((canvas.width - gW) / 2) + (layoutOffsetX || 0);
    const startY = ((canvas.height - gH) / 2) + (layoutOffsetY || 0);

    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const cellX = startX + c * (cellW + gH_gutter);
        const cellY = startY + r * (cellH + gV_gutter);
        if (cx >= cellX && cx <= cellX + cellW && cy >= cellY && cy <= cellY + cellH) {
          return [r, c];
        }
      }
    }
    return null;
  }, [layoutWidth, layoutHeight, layoutOffsetX, layoutOffsetY, layoutGutterHorizontal, layoutGutterVertical, gridRows, gridCols]);

  // ---- Canvas click → symbol selection (uses shared grid math) ----
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const cell = canvasEventToCell(e);
    if (!cell) { setSelectedLayoutSymbolId(null); return; }
    const [r, c] = cell;
    const symId = gridState?.[r]?.[c];
    if (symId) {
      setSelectedLayoutSymbolId(symId);
    } else {
      // Check if this cell is covered by a long tile from a row above
      for (let rr = r - 1; rr >= 0; rr--) {
        const aboveId = gridState?.[rr]?.[c];
        if (aboveId) {
          const sym = symbols.find(s => s.id === aboveId);
          const span = sym?.spanRows || 1;
          if (rr + span > r) {
            setSelectedLayoutSymbolId(aboveId);
            return;
          }
        }
        break;
      }
      setSelectedLayoutSymbolId(null);
    }
  }, [canvasEventToCell, gridState, symbols]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const cell = canvasEventToCell(e);
    if (!cell) { setHoveredLayoutSymbolId(null); return; }
    const [r, c] = cell;
    let symId = gridState?.[r]?.[c] || null;
    // Check if covered by long tile above
    if (!symId) {
      for (let rr = r - 1; rr >= 0; rr--) {
        const aboveId = gridState?.[rr]?.[c];
        if (aboveId) {
          const sym = symbols.find(s => s.id === aboveId);
          if ((sym?.spanRows || 1) + rr > r) symId = aboveId;
        }
        break;
      }
    }
    setHoveredLayoutSymbolId(symId);
  }, [canvasEventToCell, gridState, symbols]);

  const handleCanvasMouseLeave = useCallback(() => {
    setHoveredLayoutSymbolId(null);
  }, []);

  const handleCanvasDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = dragItem?.type === 'GRID_SYMBOL' ? 'move' : 'copy';
  }, [dragItem]);

  const handleCanvasDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!dragItem) return;
    const cell = canvasEventToCell(e);
    if (!cell) return;
    let [r, c] = cell;

    const symToPlace = dragItem.type === 'LIBRARY_SYMBOL'
      ? symbols.find(s => s.id === dragItem.symbolId)
      : dragItem.gridR !== undefined ? symbols.find(s => s.id === (gridState?.[dragItem.gridR!]?.[dragItem.gridC!] || '')) : null;
    const span = symToPlace?.spanRows || 1;

    // Auto-grow ONLY when the layout's rows are fewer than the tile's span.
    // Fixes the silent-fail on secondary layouts whose gridRows < 3.
    let effectiveRows = gridRows;
    let g: string[][] = (gridState || []).map(row => [...row]);
    if (span > gridRows) {
      const cols = g[0]?.length ?? gridCols;
      while (g.length < span) g.push(Array(cols).fill(''));
      effectiveRows = span;
      r = 0;
    } else if (span > 1 && r + span > effectiveRows) {
      r = effectiveRows - span;
      if (r < 0) { toast('Grid too small for this tile', { type: 'error' }); return; }
    }
    // Safety: ensure g has at least effectiveRows rows (guards against
    // gridState/gridRows drift that previously caused silent drop failures).
    while (g.length < effectiveRows) g.push(Array(g[0]?.length ?? gridCols).fill(''));

    if (dragItem.type === 'LIBRARY_SYMBOL') {
      for (let sr = 0; sr < span && (r + sr) < effectiveRows; sr++) {
        if (g[r + sr]) g[r + sr][c] = '';
      }
      g[r][c] = dragItem.symbolId;
    } else if (dragItem.gridR !== undefined && dragItem.gridC !== undefined) {
      const srcR = dragItem.gridR;
      const srcC = dragItem.gridC;
      const src = g[srcR]?.[srcC] || '';
      const srcSym = symbols.find(s => s.id === src);
      const srcSpan = srcSym?.spanRows || 1;
      for (let sr = 0; sr < srcSpan && (srcR + sr) < effectiveRows; sr++) {
        if (g[srcR + sr]) g[srcR + sr][srcC] = '';
      }
      for (let sr = 0; sr < span && (r + sr) < effectiveRows; sr++) {
        if (g[r + sr]) g[r + sr][c] = '';
      }
      g[r][c] = src;
    }

    const updates: Partial<SlotLayout> = { gridState: g };
    if (effectiveRows > gridRows) updates.gridRows = effectiveRows;
    updateActiveLayout(updates);
    setDragItem(null);
  }, [dragItem, canvasEventToCell, gridState, symbols, gridRows, gridCols, updateActiveLayout, toast]);

  // Determine which frame's reelsFrame to use as the layout canvas background
  const layoutBackground = useMemo(() => {
    if (!activeLayout?.sourceFrameId) return reelsFrame;
    const frame = symbolGenState.sourceFrames.find(f => f.id === activeLayout.sourceFrameId);
    return frame?.reelsFrame ?? reelsFrame;
  }, [activeLayout, symbolGenState.sourceFrames, reelsFrame]);

  // ---- Sync canvas size to reels frame dimensions ----
  useEffect(() => {
    let cancelled = false;
    const src = layoutBackground || masterImage;
    if (!src) return;
    const img = new Image();
    img.onload = () => {
      if (cancelled || !img.width || !img.height) return;
      // Scale so the width is 1080, height proportional — this preserves
      // the exact aspect ratio of the cropped reels frame (or master image)
      const maxW = 1080;
      const scale = maxW / img.width;
      setCanvasSize({ w: maxW, h: Math.round(img.height * scale) });
    };
    img.src = src;
    return () => { cancelled = true; };
  }, [layoutBackground, masterImage]);

  // ---- Canvas drawing ----

  const drawImageRemovingWhite = (
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    x: number, y: number, w: number, h: number,
  ) => {
    const osc = document.createElement('canvas');
    osc.width = w;
    osc.height = h;
    const osCtx = osc.getContext('2d');
    if (!osCtx) return;
    osCtx.drawImage(img, 0, 0, w, h);
    const frame = osCtx.getImageData(0, 0, w, h);
    const d = frame.data;

    // Step 1: Find average non-white colour (the symbol's dominant edge colour)
    // Used to "defringe" semi-transparent edge pixels so they don't appear white.
    let avgR = 0, avgG = 0, avgB = 0, count = 0;
    for (let i = 0; i < d.length; i += 4) {
      const luminance = d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
      if (luminance < 180) { // non-white-ish pixel
        avgR += d[i]; avgG += d[i+1]; avgB += d[i+2]; count++;
      }
    }
    if (count > 0) { avgR /= count; avgG /= count; avgB /= count; }

    // Step 2: Process each pixel — white removal with defringing
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i+1], b = d[i+2];
      // "Whiteness" = how close to pure white (min channel / 255)
      const luminance = r * 0.299 + g * 0.587 + b * 0.114;
      const saturation = Math.max(r, g, b) - Math.min(r, g, b);

      if (luminance > 248 && saturation < 15) {
        // Pure white — fully transparent
        d[i+3] = 0;
      } else if (luminance > 190 && saturation < 40) {
        // Near-white / anti-aliased edge pixel — fade alpha based on whiteness
        // and shift RGB towards the symbol's edge colour to eliminate white fringe
        const whiteness = (luminance - 190) / (248 - 190); // 0..1
        const newAlpha = Math.round((1 - whiteness) * d[i+3]);
        d[i+3] = newAlpha;
        // Defringe: blend RGB towards the symbol's average edge colour
        if (count > 0 && newAlpha > 0) {
          const blend = Math.min(whiteness * 1.5, 1); // stronger blend for whiter pixels
          d[i]   = Math.round(r * (1 - blend) + avgR * blend);
          d[i+1] = Math.round(g * (1 - blend) + avgG * blend);
          d[i+2] = Math.round(b * (1 - blend) + avgB * blend);
        }
      }
      // else: keep pixel as-is (opaque symbol content)
    }
    osCtx.putImageData(frame, 0, 0);
    ctx.drawImage(osc, x, y);
  };

  // Helper: load an image from a data URL and return a promise
  const loadImg = (src: string): Promise<HTMLImageElement> =>
    new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(img); // resolve anyway — caller checks dimensions
      img.src = src;
    });

  const drawLayout = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Green screen background
    ctx.fillStyle = '#00FF00';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Reels frame — fills the entire canvas (skipped in "clear" wild-only modes)
    if (layoutBackground && !hideReelsBg) {
      const frameImg = await loadImg(layoutBackground);
      if (frameImg.width && frameImg.height) {
        ctx.drawImage(frameImg, 0, 0, canvas.width, canvas.height);
      }
    }

    // Pre-load all unique symbol images used in the grid
    const usedSymIds = new Set<string>();
    (gridState || []).forEach(row => row.forEach(id => { if (id) usedSymIds.add(id); }));
    const symImgMap = new Map<string, HTMLImageElement>();
    await Promise.all(
      Array.from(usedSymIds).map(async (symId) => {
        const sym = symbols.find(s => s.id === symId);
        if (!sym?.isolatedUrl) return;
        const img = await loadImg(sym.isolatedUrl);
        if (img.width && img.height) symImgMap.set(symId, img);
      })
    );

    // Grid geometry
    const gW = canvas.width * (layoutWidth / 100);
    const gH = canvas.height * (layoutHeight / 100);
    const gH_gutter = layoutGutterHorizontal || 0;
    const gV_gutter = layoutGutterVertical || 0;
    const totalGutterW = (gridCols - 1) * gH_gutter;
    const totalGutterH = (gridRows - 1) * gV_gutter;
    const cellW = (gW - totalGutterW) / gridCols;
    const cellH = (gH - totalGutterH) / gridRows;
    const startX = ((canvas.width - gW) / 2) + (layoutOffsetX || 0);
    const startY = ((canvas.height - gH) / 2) + (layoutOffsetY || 0);
    const userScale = (symbolScale || 100) / 100;

    // First pass: build complete set of cells covered by long tiles
    const coveredCells = new Set<string>();
    (gridState || []).forEach((row, rIdx) => {
      row.forEach((symId, cIdx) => {
        if (!symId) return;
        if (coveredCells.has(`${rIdx}-${cIdx}`)) return;
        const sym = symbols.find(s => s.id === symId);
        const span = sym?.spanRows || 1;
        if (span > 1) {
          for (let sr = 1; sr < span && (rIdx + sr) < gridRows; sr++) {
            coveredCells.add(`${rIdx + sr}-${cIdx}`);
          }
        }
      });
    });

    // Second pass: draw symbols
    (gridState || []).forEach((row, rIdx) => {
      row.forEach((symId, cIdx) => {
        if (!symId) return;
        const cellKey = `${rIdx}-${cIdx}`;
        if (coveredCells.has(cellKey)) return; // skip cells under a long tile

        const img = symImgMap.get(symId);
        if (!img) return;
        const sym = symbols.find(s => s.id === symId);
        const span = sym?.spanRows || 1;
        const cellX = startX + cIdx * (cellW + gH_gutter);
        const cellY = startY + rIdx * (cellH + gV_gutter);

        // For long tiles, occupy span rows and use combined height
        const spanH = cellH * span + gV_gutter * (span - 1);

        const fitScale = Math.min(cellW / img.width, spanH / img.height);
        const perScaleX = (sym?.scaleX ?? 100) / 100;
        const perScaleY = (sym?.scaleY ?? 100) / 100;
        const finalScaleX = fitScale * userScale * perScaleX;
        const finalScaleY = fitScale * userScale * perScaleY;
        const drawW = img.width * finalScaleX;
        const drawH = img.height * finalScaleY;
        const x = cellX + (cellW - drawW) / 2;
        const y = cellY + (spanH - drawH) / 2;
        // Long tiles keep their background — draw directly; regular symbols remove white bg
        if (span > 1) {
          ctx.drawImage(img, x, y, drawW, drawH);
        } else {
          drawImageRemovingWhite(ctx, img, x, y, drawW, drawH);
        }

        // Hover / selection highlight
        const isSelected = symId === selectedLayoutSymbolId;
        const isHovered = symId === hoveredLayoutSymbolId && !isSelected;
        if (isSelected || isHovered) {
          ctx.save();
          ctx.strokeStyle = isSelected ? '#ec4899' : 'rgba(255,255,255,0.5)';
          ctx.lineWidth = isSelected ? 3 : 2;
          if (isHovered) ctx.setLineDash([6, 4]);
          ctx.strokeRect(cellX, cellY, cellW, spanH);
          ctx.restore();
          // Label
          if (isSelected && sym?.name) {
            const label = sym.name;
            ctx.save();
            ctx.font = 'bold 18px sans-serif';
            const tm = ctx.measureText(label);
            const lx = cellX + (cellW - tm.width) / 2 - 6;
            const ly = cellY - 8;
            ctx.fillStyle = '#ec4899';
            ctx.beginPath();
            ctx.roundRect(lx, ly - 16, tm.width + 12, 22, 4);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.fillText(label, lx + 6, ly);
            ctx.restore();
          }
        }
      });
    });
  }, [gridState, layoutBackground, hideReelsBg, symbols, layoutWidth, layoutHeight, layoutOffsetX, layoutOffsetY, layoutGutterHorizontal, layoutGutterVertical, symbolScale, gridRows, gridCols, canvasSize, selectedLayoutSymbolId, hoveredLayoutSymbolId]);

  useEffect(() => {
    const t = setTimeout(drawLayout, 100);
    return () => clearTimeout(t);
  }, [drawLayout, activeSubTab]);

  // Pause all generated videos whenever this component becomes invisible:
  // - switching SymbolGenerator's own sub-tabs (activeSubTab)
  // - switching top-level app tabs (activeTab)
  // - switching ToolkitTab sections to Character/Background/Compositor (isVisible)
  // useLayoutEffect cleanup fires before the next DOM commit so videos are
  // still in the DOM when pause() is called.
  useLayoutEffect(() => {
    const pauseAll = () =>
      document.querySelectorAll<HTMLVideoElement>('[data-slot-video]').forEach(v => v.pause());
    if (!isVisible) pauseAll();
    return pauseAll;
  }, [activeSubTab, activeTab, isVisible]);

  // ---- Merge & Save ----

  // Bake a 9:16 green-screen frame with the composition anchored to the bottom (or centered).
  const bakeGreenScreenFrame = (sourceDataUrl: string, verticalAlign: 'bottom' | 'center'): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const srcW = img.width, srcH = img.height;
        if (!srcW || !srcH) { resolve(sourceDataUrl); return; }

        // Target is 9:16 with the same width as the source.
        const targetAR = 9 / 16;
        const targetW = srcW;
        const targetH = Math.round(srcW / targetAR);

        // If the source is already taller than 9:16 (srcAR < targetAR), grow width instead.
        let canW = targetW, canH = targetH;
        if (srcH > targetH) {
          canH = srcH;
          canW = Math.round(srcH * targetAR);
        }

        const out = document.createElement('canvas');
        out.width = canW;
        out.height = canH;
        const ctx = out.getContext('2d');
        if (!ctx) { resolve(sourceDataUrl); return; }
        ctx.fillStyle = '#00FF00';
        ctx.fillRect(0, 0, canW, canH);

        const offsetX = Math.round((canW - srcW) / 2);
        const offsetY = verticalAlign === 'bottom'
          ? canH - srcH
          : Math.round((canH - srcH) / 2);
        ctx.drawImage(img, offsetX, offsetY);
        resolve(out.toDataURL('image/png'));
      };
      img.onerror = () => resolve(sourceDataUrl);
      img.src = sourceDataUrl;
    });
  };

  const handleMergeAndSaveFrame = async () => {
    if (!canvasRef.current) return;
    const rawUrl = canvasRef.current.toDataURL('image/png');
    const align = hideReelsBg ? 'center' : 'bottom';
    const url = await bakeGreenScreenFrame(rawUrl, align);
    const frame: MergedFrame = {
      id: crypto.randomUUID(),
      dataUrl: url,
      label: `Frame ${(savedFrames || mergedFrames).length + 1}`,
      timestamp: Date.now(),
      hideReelsBg: !!hideReelsBg,
    };
    updateState({ savedFrames: [...(savedFrames || []), frame], mergedFrames: [...mergedFrames, frame] });
  };

  const handleDeleteMergedFrame = (frameId: string) => {
    updateState({
      savedFrames: (savedFrames || []).filter(f => f.id !== frameId),
      mergedFrames: mergedFrames.filter(f => f.id !== frameId),
      selectedStartFrameId: selectedStartFrameId === frameId ? null : selectedStartFrameId,
      selectedEndFrameId: selectedEndFrameId === frameId ? null : selectedEndFrameId,
    });
  };

  // ---- Animation ----

  // Video aspect ratio selector state
  const [videoAspectRatio, setVideoAspectRatio] = useState<'16:9' | '9:16'>('16:9');
  // Track number of active generation jobs (allows parallel generation)
  const [activeVideoJobs, setActiveVideoJobs] = useState(0);

  // Pad a frame image with green (#00FF00) to match the target video aspect ratio.
  // verticalAlign: 'bottom' anchors the source to the bottom (green above only); 'center' centers vertically.
  const padFrameForVideoRatio = (
    frameDataUrl: string,
    targetRatio: '16:9' | '9:16',
    verticalAlign: 'center' | 'bottom' = 'center'
  ): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const targetAR = targetRatio === '16:9' ? 16 / 9 : 9 / 16;
        const srcAR = img.width / img.height;

        // If aspect ratios match closely enough, just return original
        if (Math.abs(srcAR - targetAR) < 0.01) {
          resolve(frameDataUrl);
          return;
        }

        // Calculate target canvas dimensions — fit source inside, pad with green
        let canW: number, canH: number;
        if (srcAR > targetAR) {
          // Source is wider than target — add green bars top/bottom
          canW = img.width;
          canH = Math.round(img.width / targetAR);
        } else {
          // Source is taller than target — add green bars left/right
          canH = img.height;
          canW = Math.round(img.height * targetAR);
        }

        const canvas = document.createElement('canvas');
        canvas.width = canW;
        canvas.height = canH;
        const ctx = canvas.getContext('2d')!;

        // Fill with green screen
        ctx.fillStyle = '#00FF00';
        ctx.fillRect(0, 0, canW, canH);

        const offsetX = Math.round((canW - img.width) / 2);
        // Bottom-align only applies when we added bars top/bottom (srcAR > targetAR)
        const offsetY = verticalAlign === 'bottom' && srcAR > targetAR
          ? canH - img.height
          : Math.round((canH - img.height) / 2);
        ctx.drawImage(img, offsetX, offsetY);

        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve(frameDataUrl);
      img.src = frameDataUrl;
    });
  };

  const handleGenerateVideo = () => {
    if (!selectedStartFrameId || !selectedEndFrameId) {
      toast('Select Start and End frames', { type: 'error' });
      return;
    }
    const allFrames = savedFrames || mergedFrames;
    const startFrame = allFrames.find(f => f.id === selectedStartFrameId);
    const endFrame = allFrames.find(f => f.id === selectedEndFrameId);
    if (!startFrame || !endFrame) return;

    const activePrompts = (animationPrompts || [animationPrompt]).filter(p => p.trim());
    if (activePrompts.length === 0) { toast('Enter at least one animation prompt', { type: 'error' }); return; }
    const count = Math.min(4, Math.max(1, animationVideoCount || 1));
    const total = activePrompts.length * count;
    const ratio = videoAspectRatio;

    // Fire-and-forget — user can immediately change start/end and generate more
    setActiveVideoJobs(n => n + total);
    toast(`Generating ${total} video${total > 1 ? 's' : ''}...`, { type: 'info' });

    (async () => {
      try {
        const startAlign = startFrame.hideReelsBg ? 'center' : 'bottom';
        const endAlign = endFrame.hideReelsBg ? 'center' : 'bottom';
        const paddedStart = await padFrameForVideoRatio(startFrame.dataUrl, ratio, startAlign);
        const paddedEnd = await padFrameForVideoRatio(endFrame.dataUrl, ratio, endAlign);

        const jobs: Array<{ prompt: string }> = [];
        for (const p of activePrompts) {
          for (let i = 0; i < count; i++) jobs.push({ prompt: p });
        }
        await Promise.all(jobs.map(async ({ prompt: p }) => {
          try {
            const { url } = await generateAnimation(paddedStart, paddedEnd, p, ratio, 'fast');
            const vidId = crypto.randomUUID();
            // Add each video as it completes
            setSymbolGenState(prev => ({
              ...prev,
              generatedVideos: [{ id: vidId, url, prompt: p }, ...(prev.generatedVideos || [])],
            }));
            addAsset({ id: vidId, url, type: 'game_symbol', name: `Slot Anim: ${p.slice(0, 20)}`, mediaType: 'video' });
          } catch (err) {
            console.error('Single video generation failed:', err);
          } finally {
            setActiveVideoJobs(n => n - 1);
          }
        }));
        toast(`Done generating ${total} video${total > 1 ? 's' : ''}`, { type: 'success', sound: true });
      } catch (err) {
        console.error(err);
        toast('Animation generation failed.', { type: 'error' });
        setActiveVideoJobs(n => Math.max(0, n - total));
      }
    })();
  };

  // =========================================================================
  // RENDER
  // =========================================================================

  const tabBtn = (tab: typeof activeSubTab, label: string, disabled = false) => (
    <button
      onClick={() => updateState({ activeSubTab: tab })}
      disabled={disabled}
      className={`px-4 py-1.5 rounded text-xs font-bold uppercase transition-colors ${
        activeSubTab === tab
          ? 'bg-indigo-600 text-white shadow'
          : 'text-zinc-400 hover:text-white disabled:opacity-30'
      }`}
    >
      {label}
    </button>
  );

  const frames = savedFrames || mergedFrames || [];

  return (
    <div className="h-full flex flex-col animate-in fade-in duration-300 relative">
      {/* Asset Picker Modal (Feature 1) */}
      {showAssetPicker && (
        <div className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center p-6 backdrop-blur-sm" onClick={() => setShowAssetPicker(false)}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-3xl w-full max-h-[80vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-6 border-b border-zinc-800">
              <h3 className="text-lg font-black uppercase tracking-widest text-white flex items-center gap-2">
                <i className="fas fa-folder-open text-indigo-500" /> Load from Assets
              </h3>
              <button onClick={() => setShowAssetPicker(false)} className="text-zinc-400 hover:text-white"><i className="fas fa-times" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {labAssets.length === 0 ? (
                <div className="text-center py-12 text-zinc-400">No assets available yet.</div>
              ) : (
                <div className="grid grid-cols-3 md:grid-cols-4 gap-4">
                  {labAssets.map(asset => (
                    <button key={asset.id} onClick={() => handleLoadFromLab(asset)} className="bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden hover:border-indigo-500 transition-all group">
                      <div className="aspect-square bg-black p-2 flex items-center justify-center">
                        <img src={asset.url} className="max-w-full max-h-full object-contain group-hover:scale-105 transition-transform" />
                      </div>
                      <div className="p-2 text-center">
                        <span className="text-[10px] font-bold text-zinc-400 truncate block">{asset.name || asset.type}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Symbol Edit Modal (Feature 6) */}
      {editingSymbol && (
        <div className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center p-6 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl flex flex-col gap-4">
            <div className="flex justify-between items-center border-b border-zinc-800 pb-4">
              <h3 className="text-lg font-black uppercase tracking-widest text-white flex items-center gap-2">
                <i className="fas fa-wand-magic-sparkles text-amber-500" /> Edit: {editingSymbol.name}
              </h3>
              <button onClick={() => setEditingSymbol(null)} className="text-zinc-400 hover:text-white"><i className="fas fa-times" /></button>
            </div>
            <div className="flex gap-4">
              <div className="w-1/3 aspect-square bg-black rounded-lg overflow-hidden border border-zinc-800 flex items-center justify-center p-2">
                {editingSymbol.isolatedUrl && <img src={editingSymbol.isolatedUrl} className="max-w-full max-h-full object-contain" />}
                <span className="absolute text-[9px] font-bold text-zinc-400 uppercase bg-black/60 px-2 py-0.5 rounded" style={{ position: 'relative', marginTop: 'auto' }}>Current</span>
              </div>
              <div className="flex-1 flex flex-col gap-4">
                <div>
                  <label className="text-[10px] font-bold text-zinc-400 uppercase mb-2 block">Edit Instruction</label>
                  <textarea value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)} className="w-full bg-black border border-zinc-700 rounded-lg p-3 text-sm text-white focus:border-indigo-500 outline-none resize-none h-24" placeholder='E.g. "Change color to gold", "Add glowing frame", "Make metallic"' />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-zinc-400 uppercase mb-2 block">Reference (Optional)</label>
                  <div className="flex gap-2 items-center">
                    {editReference && <img src={editReference} className="w-10 h-10 rounded object-cover border border-zinc-700" />}
                    <label className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs px-4 py-2 rounded-lg cursor-pointer border border-zinc-700 flex items-center justify-center gap-2">
                      <i className="fas fa-upload" /> Upload Reference
                      <input type="file" accept="image/*" onChange={handleEditReferenceUpload} className="hidden" />
                    </label>
                    {editReference && <button onClick={() => setEditReference(null)} className="text-zinc-400 hover:text-red-500 px-2"><i className="fas fa-trash" /></button>}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setEditingSymbol(null)} className="px-4 py-2 text-xs font-bold uppercase text-zinc-400 hover:text-white">Cancel</button>
              <button onClick={handleEditSymbol} disabled={!editPrompt} className="bg-amber-600 hover:bg-amber-500 text-white px-6 py-2 rounded-lg text-xs font-bold uppercase shadow-lg disabled:opacity-50 flex items-center gap-2">
                <i className="fas fa-wand-magic-sparkles" /> Apply Edit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen Preview Modal */}
      {previewImage && (
        <div className="fixed inset-0 z-[200] bg-black/95 flex items-center justify-center p-8 backdrop-blur-md" onClick={() => setPreviewImage(null)}>
          <img src={previewImage} className="max-w-full max-h-full object-contain shadow-2xl border border-zinc-800 rounded-lg" />
          <button className="absolute top-4 right-4 text-zinc-400 hover:text-white"><i className="fas fa-times text-2xl"></i></button>
        </div>
      )}

      {/* Symbol Version Viewer — Original + ×2 + ×3 at actual pixel sizes */}
      {viewingSymbol && (
        <div className="fixed inset-0 z-[250] bg-black/90 flex items-center justify-center p-8 backdrop-blur-md" onClick={() => setViewingSymbol(null)}>
          <div className="bg-zinc-950 border border-zinc-700 rounded-2xl p-6 shadow-2xl max-w-[95vw]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-black uppercase tracking-widest text-white flex items-center gap-2">
                <i className="fas fa-layer-group text-violet-400" /> {viewingSymbol.name} — Versions
              </h3>
              <button onClick={() => setViewingSymbol(null)} className="text-zinc-400 hover:text-white transition-colors ml-8">
                <i className="fas fa-xmark text-lg" />
              </button>
            </div>
            {/* Cards: side by side, each image at actual pixel size */}
            <div className="flex gap-6 items-start overflow-x-auto pb-2">
              <SymbolVersionCard
                label="Original"
                url={viewingSymbol.isolatedUrl}
                filename={`${viewingSymbol.name}_original.png`}
              />
              {viewingSymbol.upscaledUrls?.[2] && (
                <SymbolVersionCard
                  label="×2 Upscale"
                  url={viewingSymbol.upscaledUrls[2]}
                  filename={`${viewingSymbol.name}_x2.png`}
                />
              )}
              {viewingSymbol.upscaledUrls?.[3] && (
                <SymbolVersionCard
                  label="×3 Upscale"
                  url={viewingSymbol.upscaledUrls[3]}
                  filename={`${viewingSymbol.name}_x3.png`}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* ------ Header ------ */}
      <div className="h-14 border-b border-zinc-800 flex items-center px-8 justify-between bg-zinc-900/50 shrink-0">
        <h1 className="text-xl font-black uppercase tracking-tighter text-white flex items-center gap-3">
          <i className="fas fa-gem text-indigo-500" /> Symbol Generator
        </h1>
        <div className="flex bg-zinc-800 rounded p-1">
          {tabBtn('master', '1. Master Reel')}
          {tabBtn('extract', '2. Extract', !currentMasterImage)}
          {tabBtn('layout', '3. Layout & Animate', symbols.every(s => !s.isolatedUrl))}
        </div>
        <SkinSelector type="slots" />
      </div>

      <div className="flex-1 overflow-y-auto p-8">

        {/* ================================================================
            TAB 1 -- MASTER REEL
        ================================================================= */}
        {activeSubTab === 'master' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 h-full">
            {/* Controls */}
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl h-fit overflow-hidden">
              {/* Frame switcher */}
              <div className="flex items-center gap-1 px-3 pt-2 pb-1 border-b border-zinc-800 flex-wrap">
                <span className="text-[9px] font-bold uppercase text-zinc-500 mr-1">FRAMES</span>
                {(symbolGenState.sourceFrames ?? []).map((frame) => {
                  const isActive = (symbolGenState.activeSourceFrameId ?? (symbolGenState.sourceFrames ?? [])[0]?.id) === frame.id;
                  const frames = symbolGenState.sourceFrames ?? [];
                  return (
                    <div key={frame.id} className={`flex items-center gap-0.5 rounded text-[10px] font-bold transition-colors group/frametab ${isActive ? 'bg-violet-600' : 'bg-zinc-800 hover:bg-zinc-700'}`}>
                      {/* Name — double-click to rename */}
                      <button
                        onClick={() => updateState({ activeSourceFrameId: frame.id })}
                        onDoubleClick={() => {
                          const val = window.prompt('Rename frame:', frame.name);
                          if (val?.trim()) {
                            setSymbolGenState(prev => ({
                              ...prev,
                              sourceFrames: (prev.sourceFrames ?? []).map(f => f.id === frame.id ? { ...f, name: val.trim() } : f),
                            }));
                          }
                        }}
                        className={`px-2.5 py-1 ${isActive ? 'text-white' : 'text-zinc-400 hover:text-white'}`}
                        title="Click to switch · Double-click to rename"
                      >
                        {frame.name}
                        {frame.masterImage && <span className="ml-1 text-[8px] opacity-60">●</span>}
                      </button>
                      {/* Delete — only show when >1 frame */}
                      {frames.length > 1 && (
                        <button
                          onClick={() => {
                            if (!window.confirm(`Delete "${frame.name}"?`)) return;
                            setSymbolGenState(prev => {
                              const remaining = (prev.sourceFrames ?? []).filter(f => f.id !== frame.id);
                              const newActive = prev.activeSourceFrameId === frame.id
                                ? (remaining[0]?.id ?? null)
                                : prev.activeSourceFrameId;
                              return { ...prev, sourceFrames: remaining, activeSourceFrameId: newActive };
                            });
                          }}
                          className={`pr-1.5 opacity-0 group-hover/frametab:opacity-100 transition-opacity ${isActive ? 'text-violet-200 hover:text-white' : 'text-zinc-500 hover:text-red-400'}`}
                          title="Delete frame"
                        >
                          <i className="fas fa-xmark text-[8px]" />
                        </button>
                      )}
                    </div>
                  );
                })}
                {/* Add frame — uses functional setState to avoid stale closure */}
                <button
                  onClick={() => {
                    setSymbolGenState(prev => {
                      const frames = prev.sourceFrames ?? [];
                      const newFrame: SourceFrame = {
                        id: crypto.randomUUID(),
                        name: `Frame ${frames.length + 1}`,
                        masterImage: null,
                        reskinResult: null,
                        reelsFrame: null,
                        reelsFrameCropCoordinates: null,
                        masterPrompt: '',
                        isProcessingMaster: false,
                        activeMasterView: 'source',
                      };
                      return { ...prev, sourceFrames: [...frames, newFrame], activeSourceFrameId: newFrame.id };
                    });
                  }}
                  className="w-6 h-6 flex items-center justify-center rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
                  title="Add new frame"
                >
                  <i className="fas fa-plus text-[9px]" />
                </button>
              </div>
              {/* Upload */}
              <div className="p-6 space-y-6">
              <div>
                <h3 className="text-xs font-black uppercase tracking-widest text-zinc-400 mb-4">
                  A. Source Image
                </h3>
                <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-zinc-700 rounded-xl hover:border-indigo-500 hover:bg-zinc-800/50 transition-all cursor-pointer group">
                  <i className="fas fa-upload text-2xl text-zinc-400 group-hover:text-indigo-400 mb-2" />
                  <span className="text-xs font-bold text-zinc-400 group-hover:text-zinc-300">
                    Upload Full Slot Screen
                  </span>
                  <input type="file" accept="image/*" className="hidden" onChange={handleMasterUpload} />
                </label>
                <button
                  onClick={() => setShowAssetPicker(true)}
                  disabled={labAssets.length === 0}
                  className="w-full mt-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 py-3 rounded-xl text-xs font-bold uppercase border border-zinc-700 transition-all disabled:opacity-30 flex items-center justify-center gap-2"
                >
                  <i className="fas fa-flask" /> Load from Assets
                  {labAssets.length > 0 && (
                    <span className="bg-indigo-600 text-white px-2 py-0.5 rounded-full text-[9px]">{labAssets.length}</span>
                  )}
                </button>
                {masterImage && (
                  <div className="text-[10px] text-zinc-400 mt-2 text-center">
                    Detected Ratio: {detectedRatio}
                  </div>
                )}
              </div>

              {/* Reskin Theme */}
              <div>
                <h3 className="text-xs font-black uppercase tracking-widest text-zinc-400 mb-2">
                  B. Reskin Theme
                </h3>
                <p className="text-[10px] text-zinc-400 mb-3">
                  Just type the theme. Layout, positions, and symbol types are auto-preserved.
                </p>
                <input
                  type="text"
                  className="w-full bg-black border border-zinc-700 rounded-lg px-3 py-3 text-sm text-white focus:border-indigo-500 outline-none mb-2"
                  placeholder='e.g. "Christmas", "Ancient Egypt", "Cyberpunk Neon"'
                  value={masterPrompt}
                  onChange={e => updateActiveFrame({ masterPrompt: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter' && masterImage && masterPrompt && !isProcessingMaster) handleGenerateMaster(); }}
                />
                <button
                  onClick={handleGenerateMaster}
                  disabled={!masterImage || !masterPrompt || isProcessingMaster}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-lg text-xs font-black uppercase tracking-widest shadow-lg transition-all disabled:opacity-50"
                >
                  {isProcessingMaster ? 'Reskinning...' : 'Reskin All'}
                </button>
              </div>

              {/* View toggle — only shown when no reskin yet (once reskinned, both show side by side) */}
              {masterImage && !reskinResult && (
                <div>
                  <h3 className="text-xs font-black uppercase tracking-widest text-zinc-400 mb-4">
                    C. Active View
                  </h3>
                  <div className="flex bg-black rounded p-1 border border-zinc-800">
                    <button className="flex-1 py-2 rounded text-xs font-bold uppercase bg-zinc-700 text-white">
                      Original
                    </button>
                    <button disabled className="flex-1 py-2 rounded text-xs font-bold uppercase text-zinc-400 cursor-not-allowed">
                      Pending...
                    </button>
                  </div>
                </div>
              )}
              </div>{/* end p-6 space-y-6 */}
            </div>

            {/* Preview — side by side when reskinned, single when not */}
            {masterImage && reskinResult ? (
              /* Before / After comparison — takes full 2-col span */
              <div className={`lg:col-span-2 bg-black border border-zinc-800 rounded-2xl p-4 relative overflow-hidden min-h-[500px] flex ${detectedRatio === '16:9' || detectedRatio === '4:3' ? 'flex-col' : 'flex-row'} gap-3`}>
                {/* Original */}
                <div className="flex-1 flex items-center justify-center relative min-h-0">
                  <div className="absolute top-2 left-2 z-10 bg-zinc-800/80 text-zinc-300 text-[10px] font-bold uppercase px-2.5 py-1 rounded-full border border-zinc-700 backdrop-blur-sm">
                    <i className="fas fa-image mr-1" /> Original
                  </div>
                  <img
                    src={masterImage}
                    className="max-w-full max-h-full object-contain shadow-xl rounded-lg border border-zinc-800 cursor-pointer"
                    onClick={() => { updateActiveFrame({ activeMasterView: 'source' }); setPreviewImage(masterImage); }}
                  />
                </div>
                {/* Reskinned */}
                <div className="flex-1 flex items-center justify-center relative min-h-0">
                  <div className="absolute top-2 left-2 z-10 bg-indigo-600/80 text-white text-[10px] font-bold uppercase px-2.5 py-1 rounded-full border border-indigo-500 backdrop-blur-sm">
                    <i className="fas fa-wand-magic-sparkles mr-1" /> Reskinned
                  </div>
                  <img
                    src={reskinResult}
                    className="max-w-full max-h-full object-contain shadow-xl rounded-lg border border-indigo-500/30 cursor-pointer"
                    onClick={() => { updateActiveFrame({ activeMasterView: 'reskinned' }); setPreviewImage(reskinResult); }}
                  />
                </div>
                {isProcessingMaster && (
                  <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center z-10">
                    <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
                    <span className="text-indigo-400 font-bold uppercase tracking-widest animate-pulse">
                      Designing Slot Screen...
                    </span>
                  </div>
                )}
              </div>
            ) : (
              /* Single image — original layout exactly as before */
              <div className="lg:col-span-2 bg-black border border-zinc-800 rounded-2xl flex items-center justify-center p-4 relative overflow-hidden min-h-[500px]">
                {currentMasterImage ? (
                  <img src={currentMasterImage} className="max-w-full max-h-full object-contain shadow-2xl" />
                ) : (
                  <div className="text-zinc-700 font-mono text-sm">Upload a source image to begin</div>
                )}
                {isProcessingMaster && (
                  <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center z-10">
                    <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
                    <span className="text-indigo-400 font-bold uppercase tracking-widest animate-pulse">
                      Designing Slot Screen...
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ================================================================
            TAB 2 -- EXTRACT
        ================================================================= */}
        {activeSubTab === 'extract' && (
          <div className="flex flex-col gap-6">
            {/* Extract header */}
            <div className="flex justify-between items-center bg-zinc-900 p-2 rounded-xl border border-zinc-800">
              <div className="flex gap-2 items-center">
                <span className="px-4 py-2 rounded-lg text-xs font-bold uppercase flex items-center gap-2 bg-indigo-600 text-white">
                  <i className="fas fa-shapes" /> Symbols & Frame
                </span>
                {masterImage && (
                  <button
                    onClick={handleAutoExtract}
                    disabled={isAutoExtracting || isProcessingMaster}
                    className="px-4 py-2 rounded-lg text-xs font-bold uppercase flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isAutoExtracting ? (
                      <>
                        <i className="fas fa-spinner fa-spin" /> Extracting...
                      </>
                    ) : (
                      <>
                        <i className="fas fa-magic" /> Auto Extract Assets
                      </>
                    )}
                  </button>
                )}
                {symbols.some(s => s.rawCropDataUrl) && (
                  <button
                    onClick={handleBulkReprocess}
                    disabled={isBulkRetrying || isAutoExtracting || isProcessingMaster}
                    className="px-4 py-2 rounded-lg text-xs font-bold uppercase flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isBulkRetrying ? (
                      <><i className="fas fa-spinner fa-spin" /> Re-processing...</>
                    ) : (
                      <><i className="fas fa-sync-alt" /> Re-process All</>
                    )}
                  </button>
                )}
                {symbols.some(s => s.isolatedUrl) && (
                  <div className="relative group/upscaleall">
                    <button
                      onClick={() => handleUpscaleAll(2)}
                      disabled={symbols.some(s => s.isUpscaling)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600/20 hover:bg-amber-600/40 border border-amber-500/30 text-amber-300 hover:text-amber-200 rounded-lg text-[10px] font-bold uppercase transition-colors disabled:opacity-40"
                    >
                      <i className="fas fa-expand-arrows-alt text-[10px]" />
                      Upscale All
                    </button>
                    <div className="absolute right-0 top-9 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl z-50 hidden group-hover/upscaleall:block min-w-[100px]">
                      <button onClick={() => handleUpscaleAll(2)} className="block w-full px-3 py-1.5 text-[10px] text-zinc-300 hover:text-white hover:bg-zinc-700 text-left">All × 2</button>
                      <button onClick={() => handleUpscaleAll(3)} className="block w-full px-3 py-1.5 text-[10px] text-zinc-300 hover:text-white hover:bg-zinc-700 text-left">All × 3</button>
                    </div>
                  </div>
                )}
              </div>
              {reelsFrame && (
                <div className="flex items-center gap-2 px-3 py-1 bg-blue-900/30 border border-blue-500/30 rounded">
                  <i className="fas fa-check text-blue-400" />
                  <span className="text-xs font-bold text-blue-200">Frame Ready</span>
                </div>
              )}
            </div>

            {/* Symbol grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6">
              {symbols.map(sym => {
                const isLongTile = (sym.spanRows || 1) >= 3;
                return (
                <div
                  key={sym.id}
                  className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden flex flex-col group"
                  draggable={!!sym.isolatedUrl}
                  onDragStart={(e) => handleDragStartLibrary(e, sym.id)}
                >
                  {/* Image area — uniform card height, contain-fit */}
                  <div
                    className="bg-zinc-800 relative flex items-center justify-center border-b border-zinc-700 cursor-grab active:cursor-grabbing w-full overflow-hidden p-2"
                    style={{ height: isLongTile ? 300 : 170 }}
                  >
                    {sym.isolatedUrl ? (
                      <img src={sym.isolatedUrl} className="max-w-full max-h-full object-contain pointer-events-none" />
                    ) : (
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-zinc-400 text-xs font-bold">{sym.name}</span>
                        {isLongTile && <span className="text-amber-500 text-[9px] font-bold">TALL TILE (3×)</span>}
                        {sym.withFrame && <span className="text-blue-400 text-[9px] font-bold">WITH FRAME</span>}
                        {sym.symbolRole === 'high' && <span className="text-orange-400 text-[9px] font-bold">HIGH</span>}
                        {sym.symbolRole === 'wild' && <span className="text-purple-400 text-[9px] font-bold">WILD</span>}
                        {sym.symbolRole === 'scatter' && <span className="text-emerald-400 text-[9px] font-bold">SCATTER</span>}
                      </div>
                    )}

                    {/* Upscale badges — top right, stacked */}
                    <div className="absolute top-1 right-1 flex flex-col gap-0.5 items-end">
                      {sym.upscaledUrls?.[2] && (
                        <div className="bg-violet-600 text-white text-xs font-black px-2 py-0.5 rounded shadow flex items-center gap-1">
                          <i className="fas fa-expand-arrows-alt" /> ×2
                        </div>
                      )}
                      {sym.upscaledUrls?.[3] && (
                        <div className="bg-violet-800 text-white text-xs font-black px-2 py-0.5 rounded shadow flex items-center gap-1">
                          <i className="fas fa-expand-arrows-alt" /> ×3
                        </div>
                      )}
                    </div>

                    {sym.isProcessing ? (
                      <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
                        <i className="fas fa-spinner animate-spin text-indigo-500" />
                      </div>
                    ) : sym.isUpscaling ? (
                      <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
                        <div className="flex flex-col items-center gap-1">
                          <i className="fas fa-spinner animate-spin text-amber-400" />
                          <span className="text-[8px] text-amber-300 font-bold">UPSCALING</span>
                        </div>
                      </div>
                    ) : (
                      <div className="absolute inset-0 bg-black/75 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center p-2">
                        <div className="grid grid-cols-3 gap-1 w-full">
                          {/* Row 1: View | Retry | Re-Crop */}
                          {sym.isolatedUrl ? (
                            <button onClick={() => setViewingSymbol(sym)}
                              className="bg-zinc-500 hover:bg-zinc-400 text-white py-1.5 rounded text-xs font-bold uppercase flex items-center justify-center gap-1">
                              <i className="fas fa-magnifying-glass-plus" /> View
                            </button>
                          ) : <div />}
                          {sym.rawCropDataUrl ? (
                            <button onClick={() => handleRetryIsolation(sym.id)}
                              className="bg-zinc-200 hover:bg-white text-black py-1.5 rounded text-xs font-bold uppercase flex items-center justify-center gap-1">
                              <i className="fas fa-sync-alt" /> Retry
                            </button>
                          ) : <div />}
                          <button
                            onClick={() => handleStartCrop(sym.id)}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white py-1.5 rounded text-xs font-bold uppercase flex items-center justify-center gap-1"
                          >
                            <i className="fas fa-crop-alt" />
                            {sym.isolatedUrl ? 'Re-Crop' : (isLongTile ? 'Crop↕' : 'Crop')}
                          </button>
                          {/* Row 2: Edit | Upload | Clear */}
                          {sym.isolatedUrl ? (
                            <button onClick={() => { setEditingSymbol(sym); setEditPrompt(''); setEditReference(null); }}
                              className="bg-amber-600 hover:bg-amber-500 text-white py-1.5 rounded text-xs font-bold uppercase flex items-center justify-center gap-1">
                              <i className="fas fa-wand-magic-sparkles" /> Edit
                            </button>
                          ) : <div />}
                          <label className="bg-zinc-600 hover:bg-zinc-500 text-white py-1.5 rounded text-xs font-bold uppercase flex items-center justify-center gap-1 cursor-pointer">
                            <i className="fas fa-upload" /> Upload
                            <input type="file" accept="image/*" className="hidden" onChange={(e) => handleUploadSymbol(sym.id, e)} />
                          </label>
                          {sym.isolatedUrl ? (
                            <button onClick={() => handleClearSymbol(sym.id)}
                              className="bg-red-700 hover:bg-red-600 text-white py-1.5 rounded text-xs font-bold uppercase flex items-center justify-center gap-1">
                              <i className="fas fa-trash" /> Clear
                            </button>
                          ) : <div />}
                          {/* Row 3: ×2 ×3 — compact, left-aligned, not stretched */}
                          {sym.isolatedUrl && (
                            <div className="col-span-3 flex gap-1">
                              <button onClick={() => handleUpscaleSymbol(sym.id, 2)}
                                className="bg-violet-600 hover:bg-violet-500 text-white py-1.5 px-3 rounded text-xs font-bold uppercase flex items-center gap-1">
                                <i className="fas fa-expand-arrows-alt" /> ×2
                              </button>
                              <button onClick={() => handleUpscaleSymbol(sym.id, 3)}
                                className="bg-violet-700 hover:bg-violet-600 text-white py-1.5 px-3 rounded text-xs font-bold uppercase flex items-center gap-1">
                                <i className="fas fa-expand-arrows-alt" /> ×3
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="p-3 flex flex-col gap-2 bg-zinc-900/50">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-zinc-300">{sym.name}</span>
                      <button
                        onClick={() => saveSymbolToAssets(sym)}
                        disabled={!sym.isolatedUrl}
                        className="text-zinc-400 hover:text-white disabled:opacity-0"
                      >
                        <i className="fas fa-save" />
                      </button>
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      {/* 3× Tall toggle */}
                      <button
                        onClick={() => {
                          setSymbolGenState(prev => ({
                            ...prev,
                            symbols: prev.symbols.map(s =>
                              s.id === sym.id ? { ...s, spanRows: (s.spanRows || 1) === 1 ? 3 : 1 } : s
                            ),
                          }));
                        }}
                        className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border transition-colors flex items-center gap-1 ${
                          isLongTile
                            ? 'bg-amber-600 border-amber-500 text-white shadow-lg shadow-amber-600/30'
                            : 'border-zinc-700 text-zinc-400 hover:text-zinc-300 hover:border-zinc-500'
                        }`}
                        title="Toggle Tall Tile — spans 3 rows in layout, keeps background on crop"
                      >
                        <i className={`fas ${isLongTile ? 'fa-arrows-up-down' : 'fa-up-down'}`} />
                        {isLongTile ? 'Tall' : '3×'}
                      </button>
                      {/* With Frame toggle */}
                      <button
                        onClick={() => {
                          setSymbolGenState(prev => ({
                            ...prev,
                            symbols: prev.symbols.map(s =>
                              s.id === sym.id ? { ...s, withFrame: !s.withFrame } : s
                            ),
                          }));
                        }}
                        className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border transition-colors flex items-center gap-1 ${
                          sym.withFrame
                            ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-600/30'
                            : 'border-zinc-700 text-zinc-400 hover:text-zinc-300 hover:border-zinc-500'
                        }`}
                        title="Extract with decorative frame/border (keeps frame around symbol)"
                      >
                        <i className="fas fa-border-all" />
                        Frame
                      </button>
                      {/* Symbol Role: Wild */}
                      <button
                        onClick={() => {
                          setSymbolGenState(prev => ({
                            ...prev,
                            symbols: prev.symbols.map(s =>
                              s.id === sym.id
                                ? { ...s, symbolRole: s.symbolRole === 'wild' ? 'low' : 'wild', withFrame: s.symbolRole === 'wild' ? s.withFrame : true }
                                : s
                            ),
                          }));
                        }}
                        className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border transition-colors flex items-center gap-1 ${
                          sym.symbolRole === 'wild'
                            ? 'bg-purple-600 border-purple-500 text-white shadow-lg shadow-purple-600/30'
                            : 'border-zinc-700 text-zinc-400 hover:text-zinc-300 hover:border-zinc-500'
                        }`}
                        title="Mark as Wild — auto-enables frame extraction"
                      >
                        <i className="fas fa-star" />
                        W
                      </button>
                      {/* Symbol Role: Scatter */}
                      <button
                        onClick={() => {
                          setSymbolGenState(prev => ({
                            ...prev,
                            symbols: prev.symbols.map(s =>
                              s.id === sym.id
                                ? { ...s, symbolRole: s.symbolRole === 'scatter' ? 'low' : 'scatter', withFrame: s.symbolRole === 'scatter' ? s.withFrame : true }
                                : s
                            ),
                          }));
                        }}
                        className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border transition-colors flex items-center gap-1 ${
                          sym.symbolRole === 'scatter'
                            ? 'bg-emerald-600 border-emerald-500 text-white shadow-lg shadow-emerald-600/30'
                            : 'border-zinc-700 text-zinc-400 hover:text-zinc-300 hover:border-zinc-500'
                        }`}
                        title="Mark as Scatter — auto-enables frame extraction"
                      >
                        <i className="fas fa-diamond" />
                        S
                      </button>
                    </div>
                  </div>
                </div>
              );
              })}

              {/* Reels Frame cards — one per source frame */}
              {(symbolGenState.sourceFrames ?? []).map((srcFrame, frameIdx) => {
                const frameBg = srcFrame.reelsFrame;
                const isActiveFrame = srcFrame.id === (symbolGenState.activeSourceFrameId ?? (symbolGenState.sourceFrames ?? [])[0]?.id);
                return (
                  <div
                    key={`bg-${srcFrame.id}`}
                    className={`bg-zinc-900 border rounded-xl overflow-hidden flex flex-col group col-span-2 ${isActiveFrame ? 'border-blue-800/50' : 'border-zinc-700/50'}`}
                  >
                    <div
                      className="bg-zinc-800 relative flex items-center justify-center border-b border-blue-700/30 w-full overflow-hidden p-2"
                    >
                      {frameBg ? (
                        <img src={frameBg} className="max-w-full h-auto object-contain" style={{ imageRendering: 'auto' }} />
                      ) : (
                        <div className="flex flex-col items-center gap-1">
                          <i className="fas fa-border-all text-blue-500 text-lg" />
                          <span className="text-zinc-400 text-xs font-bold">{srcFrame.name} BG</span>
                          <span className="text-blue-400 text-[9px] font-bold">NOT EXTRACTED</span>
                        </div>
                      )}
                      <div className="absolute top-1 left-1">
                        <div className="bg-blue-600 text-white text-[8px] font-black px-1.5 py-0.5 rounded shadow w-fit">
                          BG {frameIdx + 1}
                        </div>
                      </div>
                      {/* Processing spinner */}
                      {isActiveFrame && (isProcessingMaster || isCleaningFrame) ? (
                        <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-2">
                          <i className="fas fa-spinner animate-spin text-blue-500 text-xl" />
                          <span className="text-blue-300 text-[10px] font-bold uppercase">
                            {isCleaningFrame ? 'AI Cleaning...' : 'Extracting Frame...'}
                          </span>
                        </div>
                      ) : (
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                          {isActiveFrame ? (
                            <>
                              <button
                                onClick={handleStartFrameCrop}
                                className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded text-[10px] font-bold uppercase shadow-lg transition-all transform hover:scale-105"
                              >
                                {frameBg ? 'Re-Crop' : 'Crop'}
                              </button>
                              {frameBg && (
                                <>
                                  <button
                                    onClick={handleAICleanFrame}
                                    className="bg-white hover:bg-zinc-200 text-black px-3 py-1.5 rounded text-[10px] font-bold uppercase shadow-lg flex items-center gap-1 transition-all transform hover:scale-105"
                                  >
                                    <i className="fas fa-sync-alt" /> Retry
                                  </button>
                                  <button
                                    onClick={() => { setEditingSymbol({ id: '__reelsframe__', name: 'Reels Frame', isolatedUrl: frameBg } as any); setEditPrompt(''); setEditReference(null); }}
                                    className="bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded text-[10px] font-bold uppercase shadow-lg flex items-center gap-1 transition-all transform hover:scale-105"
                                  >
                                    <i className="fas fa-wand-magic-sparkles" /> Edit
                                  </button>
                                  <label className="bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1.5 rounded text-[10px] font-bold uppercase shadow-lg flex items-center gap-1 transition-all transform hover:scale-105 cursor-pointer">
                                    <i className="fas fa-upload" /> Upload
                                    <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (!file) return;
                                      const reader = new FileReader();
                                      reader.onload = () => {
                                        const url = reader.result as string;
                                        updateActiveFrame({ reelsFrame: url });
                                        addAsset({ id: `symgen-reelsframe-${Date.now()}`, url, type: 'background', name: `${srcFrame.name} BG (Uploaded)` });
                                      };
                                      reader.readAsDataURL(file);
                                    }} />
                                  </label>
                                  <button
                                    onClick={() => updateActiveFrame({ reelsFrame: null, reelsFrameCropCoordinates: null })}
                                    className="bg-red-600/80 hover:bg-red-500 text-white px-3 py-1.5 rounded text-[10px] font-bold uppercase shadow-lg flex items-center gap-1 transition-all transform hover:scale-105"
                                  >
                                    <i className="fas fa-trash" /> Clear
                                  </button>
                                </>
                              )}
                            </>
                          ) : (
                            <button
                              onClick={() => updateState({ activeSourceFrameId: srcFrame.id })}
                              className="bg-violet-600 hover:bg-violet-500 text-white px-3 py-1.5 rounded text-[10px] font-bold uppercase shadow-lg transition-all transform hover:scale-105"
                            >
                              Switch to {srcFrame.name}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="p-3 flex justify-between items-center bg-zinc-900/50">
                      <span className="text-xs font-bold text-blue-300">{srcFrame.name} Background</span>
                      {frameBg && (
                        <button
                          onClick={() => addAsset({ id: `symgen-reelsframe-${Date.now()}`, url: frameBg, type: 'background', name: `${srcFrame.name} BG` })}
                          className="text-zinc-400 hover:text-white"
                        >
                          <i className="fas fa-save" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ================================================================
            TAB 3 -- LAYOUT & ANIMATE
        ================================================================= */}
        {activeSubTab === 'layout' && (
          <div className="flex flex-col gap-8 h-full">
            {/* Layout switcher */}
            <div className="flex items-center gap-1 px-3 pt-2 pb-1 border-b border-zinc-800 shrink-0 bg-zinc-900/50 rounded-xl border border-zinc-800">
              <span className="text-[9px] font-bold uppercase text-zinc-500 mr-1">LAYOUTS</span>
              {(symbolGenState.layouts ?? []).map((layout) => {
                const isActive = (symbolGenState.activeLayoutId ?? (symbolGenState.layouts ?? [])[0]?.id) === layout.id;
                const layouts = symbolGenState.layouts ?? [];
                return (
                  <div key={layout.id} className={`flex items-center gap-0.5 rounded text-[10px] font-bold transition-colors group/layouttab ${isActive ? 'bg-cyan-600' : 'bg-zinc-800 hover:bg-zinc-700'}`}>
                    <button
                      onClick={() => updateState({ activeLayoutId: layout.id })}
                      onDoubleClick={() => {
                        const val = window.prompt('Rename layout:', layout.name);
                        if (val?.trim()) {
                          setSymbolGenState(prev => ({
                            ...prev,
                            layouts: (prev.layouts ?? []).map(l => l.id === layout.id ? { ...l, name: val.trim() } : l),
                          }));
                        }
                      }}
                      className={`px-2.5 py-1 ${isActive ? 'text-white' : 'text-zinc-400 hover:text-white'}`}
                      title="Click to switch · Double-click to rename"
                    >
                      {layout.name}
                    </button>
                    {layouts.length > 1 && (
                      <button
                        onClick={() => {
                          if (!window.confirm(`Delete "${layout.name}"?`)) return;
                          setSymbolGenState(prev => {
                            const remaining = (prev.layouts ?? []).filter(l => l.id !== layout.id);
                            const newActive = prev.activeLayoutId === layout.id
                              ? (remaining[0]?.id ?? null)
                              : prev.activeLayoutId;
                            return { ...prev, layouts: remaining, activeLayoutId: newActive };
                          });
                        }}
                        className={`pr-1.5 opacity-0 group-hover/layouttab:opacity-100 transition-opacity ${isActive ? 'text-cyan-200 hover:text-white' : 'text-zinc-500 hover:text-red-400'}`}
                        title="Delete layout"
                      >
                        <i className="fas fa-xmark text-[8px]" />
                      </button>
                    )}
                  </div>
                );
              })}
              <button
                onClick={() => {
                  const newLayout: SlotLayout = {
                    id: crypto.randomUUID(),
                    name: `Layout ${(symbolGenState.layouts ?? []).length + 1}`,
                    sourceFrameId: (symbolGenState.sourceFrames ?? [])[0]?.id ?? null,
                    gridRows: 3,
                    gridCols: 5,
                    gridState: Array(3).fill(null).map(() => Array(5).fill('')),
                    layoutOffsetX: 0,
                    layoutOffsetY: 0,
                    layoutWidth: 90,
                    layoutHeight: 81,
                    layoutGutterHorizontal: 10,
                    layoutGutterVertical: 10,
                    symbolScale: 105,
                    hideReelsBg: false,
                    useLongTiles: false,
                  };
                  updateState({
                    layouts: [...(symbolGenState.layouts ?? []), newLayout],
                    activeLayoutId: newLayout.id,
                  });
                }}
                className="w-6 h-6 flex items-center justify-center rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
                title="Add new layout"
              >
                <i className="fas fa-plus text-[9px]" />
              </button>
              {/* Background frame selector for active layout */}
              {activeLayout && (symbolGenState.sourceFrames ?? []).length > 1 && (
                <div className="ml-auto flex items-center gap-1.5">
                  <span className="text-[9px] text-zinc-500">BG:</span>
                  <select
                    value={activeLayout.sourceFrameId ?? ''}
                    onChange={e => updateActiveLayout({ sourceFrameId: e.target.value || null })}
                    className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-[10px] rounded px-1.5 py-0.5 outline-none"
                  >
                    {(symbolGenState.sourceFrames ?? []).map(f => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* TOP: LAYOUT EDITOR */}
            <div className="flex gap-4 min-h-[500px] max-h-[700px]">
              {/* LEFT PANEL: grid config + symbol library */}
              <div className="w-80 flex flex-col gap-4 shrink-0 overflow-y-auto pr-2">
                {/* Grid Config */}
                <div className="bg-zinc-900/50 p-4 rounded-xl border border-zinc-800 space-y-4">
                  <h3 className="text-xs font-black uppercase tracking-widest text-zinc-400">
                    1. Grid Config
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[9px] uppercase font-bold text-zinc-400 block mb-1">Rows</label>
                      <input
                        type="number" min={1} max={10} value={gridRows}
                        onChange={e => updateActiveLayout({ gridRows: parseInt(e.target.value) || 3 })}
                        className="w-full bg-black border border-zinc-700 rounded px-2 py-1 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase font-bold text-zinc-400 block mb-1">Cols</label>
                      <input
                        type="number" min={1} max={10} value={gridCols}
                        onChange={e => updateActiveLayout({ gridCols: parseInt(e.target.value) || 5 })}
                        className="w-full bg-black border border-zinc-700 rounded px-2 py-1 text-xs text-white"
                      />
                    </div>
                  </div>
                  {/* Use long tiles toggle */}
                  <label className="flex items-center gap-2 cursor-pointer select-none mt-1">
                    <input
                      type="checkbox"
                      checked={useLongTiles ?? false}
                      onChange={e => updateActiveLayout({ useLongTiles: e.target.checked })}
                      className="accent-amber-500 w-3 h-3"
                    />
                    <span className="text-[9px] uppercase font-bold text-zinc-400">
                      Use Long Tiles
                    </span>
                  </label>
                  {/* Presets */}
                  <div className="grid grid-cols-4 gap-1 mt-2">
                    <button onClick={handleRandomFill} className="bg-zinc-800 hover:bg-zinc-700 text-white py-1.5 rounded text-[9px] font-bold uppercase border border-zinc-700">Random</button>
                    <button onClick={handleVShapeFill} className="bg-zinc-800 hover:bg-zinc-700 text-white py-1.5 rounded text-[9px] font-bold uppercase border border-zinc-700">V-Shape</button>
                    <button onClick={handleChessboardFill} className="bg-zinc-800 hover:bg-zinc-700 text-white py-1.5 rounded text-[9px] font-bold uppercase border border-zinc-700">Chess</button>
                    <button onClick={handleClearGrid} className="bg-zinc-800 hover:bg-zinc-700 text-white py-1.5 rounded text-[9px] font-bold uppercase border border-zinc-700">Clear</button>
                  </div>
                  <div className="grid grid-cols-2 gap-1 mt-1">
                    <button onClick={handleClearVShapeFill} className="bg-zinc-900 hover:bg-zinc-800 text-emerald-400 py-1.5 rounded text-[9px] font-bold uppercase border border-zinc-700" title="Wilds only in V-shape, no background">Clear V-Shape</button>
                    <button onClick={handleClearChessFill} className="bg-zinc-900 hover:bg-zinc-800 text-emerald-400 py-1.5 rounded text-[9px] font-bold uppercase border border-zinc-700" title="Wilds only in chess pattern, no background">Clear Chess</button>
                  </div>
                </div>

                {/* Symbol Library */}
                <div className="bg-zinc-900/50 p-4 rounded-xl border border-zinc-800 flex-1 flex flex-col min-h-[300px]">
                  <h3 className="text-xs font-black uppercase tracking-widest text-zinc-400 mb-4">
                    2. Symbols
                  </h3>
                  <div className="grid grid-cols-3 gap-2 overflow-y-auto auto-rows-max">
                    {symbols.map(s => {
                      const isLong = (s.spanRows || 1) >= 3;
                      return (
                        <div
                          key={s.id}
                          draggable={!!s.isolatedUrl}
                          onDragStart={e => handleDragStartLibrary(e, s.id)}
                          onClick={() => setSelectedLayoutSymbolId(s.id)}
                          className={`rounded border relative overflow-hidden transition-all cursor-grab active:cursor-grabbing ${
                            selectedLayoutSymbolId === s.id
                              ? 'border-indigo-500 ring-2 ring-indigo-500/20'
                              : 'border-zinc-700 opacity-50 hover:opacity-100'
                          }`}
                          style={{ height: isLong ? '120px' : '60px' }}
                        >
                          {s.isolatedUrl ? (
                            <img src={s.isolatedUrl} className="w-full h-full object-contain bg-zinc-800 pointer-events-none" />
                          ) : (
                            <div className="w-full h-full bg-black flex items-center justify-center text-[8px] text-zinc-700">
                              {s.name}
                            </div>
                          )}
                          {isLong && (
                            <div className="absolute top-0.5 right-0.5 bg-amber-600 text-white text-[6px] font-bold px-0.5 rounded shadow">
                              3×
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-4 text-[10px] text-zinc-400 text-center italic">
                    Drag to grid to place.
                  </div>
                </div>
              </div>

              {/* CENTER: CANVAS */}
              <div className="flex-1 bg-black border border-zinc-800 rounded-xl overflow-hidden relative flex flex-col justify-end items-center">
                <canvas
                  ref={canvasRef}
                  width={canvasSize.w}
                  height={canvasSize.h}
                  onClick={handleCanvasClick}
                  onMouseMove={handleCanvasMouseMove}
                  onMouseLeave={handleCanvasMouseLeave}
                  onDragOver={handleCanvasDragOver}
                  onDrop={handleCanvasDrop}
                  className="max-w-full max-h-full shadow-2xl object-contain cursor-crosshair"
                  style={{ aspectRatio: `${canvasSize.w}/${canvasSize.h}` }}
                />
                {selectedLayoutSymbolId && (
                  <div className="absolute bottom-2 left-2 bg-pink-500/80 text-white text-[9px] font-bold px-2 py-0.5 rounded shadow">
                    <i className="fas fa-crosshairs mr-1" />
                    {symbols.find(s => s.id === selectedLayoutSymbolId)?.name || 'Selected'}
                    <button onClick={() => setSelectedLayoutSymbolId(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
                  </div>
                )}
              </div>

              {/* RIGHT PANEL: sliders + frame */}
              <div className="w-72 flex flex-col gap-4 shrink-0">
                <div className="bg-zinc-900/50 p-4 rounded-xl border border-zinc-800 space-y-4 flex-1 overflow-y-auto">
                  <h3 className="text-xs font-black uppercase tracking-widest text-zinc-400">
                    3. Reel Window
                  </h3>

                  {/* Sliders */}
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-[9px] uppercase font-bold text-zinc-400">Grid Width</label>
                        <span className="text-[9px] font-mono text-zinc-400">{layoutWidth}%</span>
                      </div>
                      <input type="range" min={10} max={100} value={layoutWidth} onChange={e => updateActiveLayout({ layoutWidth: +e.target.value })} className="w-full accent-indigo-500 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer" />
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-[9px] uppercase font-bold text-zinc-400">Grid Height</label>
                        <span className="text-[9px] font-mono text-zinc-400">{layoutHeight}%</span>
                      </div>
                      <input type="range" min={10} max={100} value={layoutHeight} onChange={e => updateActiveLayout({ layoutHeight: +e.target.value })} className="w-full accent-indigo-500 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer" />
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-[9px] uppercase font-bold text-zinc-400">Vertical Offset</label>
                        <span className="text-[9px] font-mono text-zinc-400">{layoutOffsetY || 0}px</span>
                      </div>
                      <input type="range" min={-500} max={500} step={5} value={layoutOffsetY || 0} onChange={e => updateActiveLayout({ layoutOffsetY: +e.target.value })} className="w-full accent-indigo-500 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer" />
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-[9px] uppercase font-bold text-zinc-400">Horizontal Offset</label>
                        <span className="text-[9px] font-mono text-zinc-400">{layoutOffsetX || 0}px</span>
                      </div>
                      <input type="range" min={-500} max={500} step={5} value={layoutOffsetX || 0} onChange={e => updateActiveLayout({ layoutOffsetX: +e.target.value })} className="w-full accent-indigo-500 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer" />
                    </div>

                    <div className="h-px bg-zinc-800 my-2" />

                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-[9px] uppercase font-bold text-zinc-400">H. Gutter</label>
                        <span className="text-[9px] font-mono text-zinc-400">{layoutGutterHorizontal || 0}px</span>
                      </div>
                      <input type="range" min={-50} max={100} step={1} value={layoutGutterHorizontal || 0} onChange={e => updateActiveLayout({ layoutGutterHorizontal: +e.target.value })} className="w-full accent-indigo-500 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer" />
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-[9px] uppercase font-bold text-zinc-400">V. Gutter</label>
                        <span className="text-[9px] font-mono text-zinc-400">{layoutGutterVertical || 0}px</span>
                      </div>
                      <input type="range" min={-50} max={100} step={1} value={layoutGutterVertical || 0} onChange={e => updateActiveLayout({ layoutGutterVertical: +e.target.value })} className="w-full accent-indigo-500 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer" />
                    </div>

                    <div className="h-px bg-zinc-800 my-2" />

                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-[9px] uppercase font-bold text-zinc-400">Symbol Scale (All)</label>
                        <span className="text-[9px] font-mono text-zinc-400">{symbolScale || 100}%</span>
                      </div>
                      <input type="range" min={10} max={200} step={5} value={symbolScale || 100} onChange={e => updateActiveLayout({ symbolScale: +e.target.value })} className="w-full accent-pink-500 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer" />
                    </div>
                  </div>

                  {/* Per-symbol scale override */}
                  {(() => {
                    const sel = selectedLayoutSymbolId ? symbols.find(s => s.id === selectedLayoutSymbolId) : null;
                    if (!sel) return (
                      <div className="mt-3 bg-zinc-800/40 border border-zinc-700/40 rounded-lg p-3 text-center">
                        <p className="text-[9px] text-zinc-400 italic">Click a symbol on the grid to adjust its individual scale.</p>
                      </div>
                    );
                    return (
                      <div className="mt-3 bg-zinc-800/60 border border-pink-500/20 rounded-lg p-3 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black uppercase text-pink-400 tracking-wider flex items-center gap-1.5">
                            <i className="fas fa-crosshairs" /> {sel.name}
                          </span>
                          <button
                            onClick={() => {
                              setSymbolGenState(prev => ({
                                ...prev,
                                symbols: prev.symbols.map(s =>
                                  s.id === sel.id ? { ...s, scaleX: 100, scaleY: 100 } : s
                                ),
                              }));
                            }}
                            className="text-[8px] text-zinc-400 hover:text-white uppercase font-bold px-1.5 py-0.5 rounded border border-zinc-700 hover:border-zinc-500 transition-colors"
                          >
                            Reset
                          </button>
                        </div>
                        {/* Lock proportions toggle */}
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={sel.lockScale ?? true}
                            onChange={e => {
                              const locked = e.target.checked;
                              setSymbolGenState(prev => ({
                                ...prev,
                                symbols: prev.symbols.map(s =>
                                  s.id === sel.id ? { ...s, lockScale: locked } : s
                                ),
                              }));
                            }}
                            className="accent-pink-500 w-3 h-3"
                          />
                          <span className="text-[9px] uppercase font-bold text-zinc-400">
                            <i className={`fas fa-${(sel.lockScale ?? true) ? 'lock' : 'lock-open'} mr-1`} />
                            Lock Proportions
                          </span>
                        </label>
                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <label className="text-[9px] uppercase font-bold text-zinc-400">H. Scale</label>
                            <span className="text-[9px] font-mono text-zinc-400">{sel.scaleX ?? 100}%</span>
                          </div>
                          <input
                            type="range" min={10} max={200} step={1}
                            value={sel.scaleX ?? 100}
                            onChange={e => {
                              const v = +e.target.value;
                              setSymbolGenState(prev => ({
                                ...prev,
                                symbols: prev.symbols.map(s => {
                                  if (s.id !== sel.id) return s;
                                  const locked = s.lockScale ?? true;
                                  return { ...s, scaleX: v, ...(locked ? { scaleY: v } : {}) };
                                }),
                              }));
                            }}
                            className="w-full accent-pink-500 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer"
                          />
                        </div>
                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <label className="text-[9px] uppercase font-bold text-zinc-400">V. Scale</label>
                            <span className="text-[9px] font-mono text-zinc-400">{sel.scaleY ?? 100}%</span>
                          </div>
                          <input
                            type="range" min={10} max={200} step={1}
                            value={sel.scaleY ?? 100}
                            onChange={e => {
                              const v = +e.target.value;
                              setSymbolGenState(prev => ({
                                ...prev,
                                symbols: prev.symbols.map(s => {
                                  if (s.id !== sel.id) return s;
                                  const locked = s.lockScale ?? true;
                                  return { ...s, scaleY: v, ...(locked ? { scaleX: v } : {}) };
                                }),
                              }));
                            }}
                            className="w-full accent-pink-500 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer"
                          />
                        </div>
                      </div>
                    );
                  })()}

                  {!reelsFrame && (
                    <div className="mt-4">
                      <button
                        onClick={() => { updateState({ activeSubTab: 'extract' }); handleStartFrameCrop(); }}
                        className="w-full text-[10px] bg-blue-600/20 hover:bg-blue-600/40 text-blue-300 border border-blue-600/30 px-3 py-2 rounded uppercase font-bold transition-colors"
                      >
                        <i className="fas fa-border-all mr-1" /> Extract Frame in Extract Tab
                      </button>
                    </div>
                  )}

                </div>
                <button
                  onClick={handleMergeAndSaveFrame}
                  className="w-full bg-green-600 hover:bg-green-500 text-white py-3 rounded-lg text-xs font-black uppercase tracking-widest shadow-lg transition-all shrink-0"
                >
                  <i className="fas fa-layer-group mr-2" /> Merge & Save Frame
                </button>
              </div>
            </div>

            {/* BOTTOM: ANIMATION STUDIO */}
            <div className="bg-zinc-900/50 p-6 rounded-2xl border border-zinc-800 flex flex-col gap-6 mt-4">
              <div className="flex items-center border-b border-zinc-800 pb-4">
                <h3 className="text-sm font-black uppercase tracking-widest text-zinc-200 flex items-center gap-2">
                  <i className="fas fa-film text-indigo-500" /> 4. Animation Studio
                </h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                {/* LEFT: Frames + controls */}
                <div className="flex flex-col gap-4">

                  {/* Aspect ratio — above frames so previews match */}
                  <div>
                    <label className="text-[10px] uppercase font-bold text-zinc-400 block mb-2">Video Aspect Ratio</label>
                    <AspectRatioSelector value={videoAspectRatio} onChange={(r) => setVideoAspectRatio(r as '16:9' | '9:16')} options={['16:9', '9:16']} />
                  </div>

                  {/* Saved Merged Frames */}
                  <div className="flex items-center gap-4">
                    <h4 className="text-xs font-bold text-white uppercase">
                      Saved Merged Frames ({frames.length})
                    </h4>
                    <span className="text-xs text-zinc-400">Select start and end frames</span>
                  </div>

                  <div className="grid grid-cols-3 gap-4 p-1">
                    {frames.length === 0 && (
                      <div className="col-span-2 text-center py-10 border border-dashed border-zinc-800 rounded-xl bg-zinc-900/30">
                        <i className="fas fa-images text-zinc-700 text-2xl mb-2" />
                        <p className="text-zinc-400 text-xs">
                          No saved frames yet.<br />Click "Merge &amp; Save Frame" above.
                        </p>
                      </div>
                    )}
                    {frames.map((frame, i) => {
                      const isStart = selectedStartFrameId === frame.id;
                      const isEnd = selectedEndFrameId === frame.id;
                      return (
                        <div
                          key={frame.id}
                          className={`relative bg-black border rounded-lg overflow-hidden group transition-all shadow-xl hover:shadow-2xl ${
                            isStart ? 'border-indigo-500 ring-4 ring-indigo-500/20'
                            : isEnd ? 'border-pink-500 ring-4 ring-pink-500/20'
                            : 'border-zinc-800 hover:border-zinc-600'
                          }`}
                        >
                          {isStart && <div className="absolute top-2 left-2 bg-indigo-600 text-white text-[10px] font-bold px-2 py-1 rounded shadow z-10 uppercase">Start</div>}
                          {isEnd && <div className="absolute top-2 left-2 bg-pink-600 text-white text-[10px] font-bold px-2 py-1 rounded shadow z-10 uppercase">End</div>}
                          <div className="absolute top-2 right-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={(e) => { e.stopPropagation(); setPreviewImage(frame.dataUrl); }}
                              className="w-8 h-8 rounded-full bg-black/60 hover:bg-white hover:text-black text-white flex items-center justify-center backdrop-blur-md shadow-lg transition-colors border border-white/10" title="Fullscreen Preview">
                              <i className="fas fa-eye text-xs" />
                            </button>
                          </div>
                          <div className="aspect-[9/16] w-full relative">
                            <img src={frame.dataUrl} className="w-full h-full object-contain bg-[#00FF00]" />
                            <div className="absolute inset-0 bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-3 p-4">
                              <div className="flex gap-2 w-full">
                                <button onClick={() => updateState({ selectedStartFrameId: frame.id })}
                                  className={`flex-1 py-2 text-[10px] font-bold uppercase rounded-lg ${isStart ? 'bg-white text-indigo-900' : 'bg-indigo-600 text-white hover:bg-indigo-500'}`}>Start</button>
                                <button onClick={() => updateState({ selectedEndFrameId: frame.id })}
                                  className={`flex-1 py-2 text-[10px] font-bold uppercase rounded-lg ${isEnd ? 'bg-white text-pink-900' : 'bg-pink-600 text-white hover:bg-pink-500'}`}>End</button>
                              </div>
                              <button onClick={() => handleDeleteMergedFrame(frame.id)}
                                className="w-full py-2 bg-zinc-800 hover:bg-red-900/50 text-zinc-400 hover:text-red-400 text-[10px] uppercase font-bold rounded-lg transition-colors border border-zinc-700">Delete</button>
                            </div>
                          </div>
                          <div className="p-3 bg-zinc-900/90 border-t border-zinc-800 text-[10px] text-zinc-400 font-mono text-center font-bold">Frame #{i + 1}</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Animation Prompts */}
                  <div>
                    <label className="text-[10px] uppercase font-bold text-zinc-400 block mb-2">Animation Prompts</label>
                    <div className="flex flex-col gap-2">
                      {(animationPrompts || [animationPrompt]).map((vp, idx) => (
                        <div key={idx} className="flex gap-2 items-start">
                          <span className="text-[10px] text-zinc-400 font-bold mt-2.5 w-4 text-right">{idx + 1}.</span>
                          <textarea
                            className="flex-1 bg-black border border-zinc-700 rounded-lg p-2 text-sm text-white focus:border-indigo-500 outline-none resize-none h-16"
                            placeholder={idx === 0 ? 'E.g. "Slot machine reels spinning blur then stopping"' : 'Another animation style...'}
                            value={vp}
                            onChange={e => {
                              const updated = [...(animationPrompts || [animationPrompt])];
                              updated[idx] = e.target.value;
                              updateState({ animationPrompts: updated });
                            }}
                          />
                          {(animationPrompts || []).length > 1 && (
                            <button onClick={() => { const updated = (animationPrompts || []).filter((_, i) => i !== idx); updateState({ animationPrompts: updated }); }}
                              className="text-zinc-400 hover:text-red-400 mt-2 transition-colors">
                              <i className="fas fa-times" />
                            </button>
                          )}
                        </div>
                      ))}
                      {(animationPrompts || []).length < 4 && (
                        <button onClick={() => updateState({ animationPrompts: [...(animationPrompts || [animationPrompt]), ''] })}
                          className="text-[10px] text-zinc-400 hover:text-indigo-400 uppercase font-bold flex items-center gap-1 self-start ml-6 transition-colors">
                          <i className="fas fa-plus" /> Add Prompt (up to 4)
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Per-prompt count */}
                  <div className="flex items-center gap-4">
                    <label className="text-[10px] uppercase font-bold text-zinc-400">Per prompt:</label>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4].map(n => (
                        <button key={n} onClick={() => updateState({ animationVideoCount: n })}
                          className={`w-9 h-9 rounded-lg text-sm font-black transition-all ${(animationVideoCount || 1) === n ? 'bg-indigo-600 text-white shadow-lg scale-105' : 'bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700 border border-zinc-700'}`}>
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Animate button */}
                  {(() => {
                    const total = (animationPrompts || [animationPrompt]).filter(p => p.trim()).length * (animationVideoCount || 1);
                    return (
                      <button onClick={handleGenerateVideo} disabled={!selectedStartFrameId || !selectedEndFrameId}
                        className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-lg text-xs font-black uppercase tracking-widest shadow-lg disabled:opacity-50 flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-95">
                        <i className="fas fa-video" /> Animate {total > 1 ? `${total} Videos` : 'Selected Frames'}
                        {activeVideoJobs > 0 && <span className="ml-1 text-[9px] bg-white/20 px-1.5 py-0.5 rounded-full"><i className="fas fa-spinner animate-spin mr-1" />{activeVideoJobs} job{activeVideoJobs > 1 ? 's' : ''}</span>}
                      </button>
                    );
                  })()}
                </div>

                {/* RIGHT: Generated Videos — padded to align with Saved Frames title */}
                <div className="flex flex-col gap-4 pt-[72px]">
                  <h4 className="text-xs font-bold text-white uppercase">
                    Generated Videos ({(generatedVideos || []).length})
                  </h4>
                  <div className="grid grid-cols-3 gap-4 p-1">
                    {(generatedVideos || []).map((vid, i) => (
                      <div key={vid.id} className="bg-black rounded-lg border border-zinc-800 overflow-hidden group relative shadow-lg">
                        <video data-slot-video src={vid.url} className="w-full aspect-[9/16] object-contain" controls loop />
                        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                          <button onClick={() => setFullscreenVideo(vid.url)} className="bg-black/50 hover:bg-white text-white hover:text-black w-7 h-7 rounded flex items-center justify-center transition-colors">
                            <i className="fas fa-expand text-[10px]" />
                          </button>
                          <a href={vid.url} download={`slot_anim_${i + 1}.mp4`} className="bg-black/50 hover:bg-white text-white hover:text-black w-7 h-7 rounded flex items-center justify-center transition-colors">
                            <i className="fas fa-download text-[10px]" />
                          </a>
                        </div>
                        <div className="p-2 bg-zinc-900 border-t border-zinc-800 flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <span className="text-[9px] font-bold text-white">slot_anim_{i + 1}.mp4</span>
                            {vid.prompt && <p className="text-[9px] text-zinc-400 line-clamp-2 mt-0.5">{vid.prompt}</p>}
                          </div>
                          <button
                            onClick={() => {
                              if (vid.url.startsWith('blob:')) URL.revokeObjectURL(vid.url);
                              updateState({ generatedVideos: (generatedVideos || []).filter(v => v.id !== vid.id) });
                            }}
                            className="text-zinc-500 hover:text-red-400 transition-colors shrink-0 mt-0.5"
                            title="Delete video"
                          >
                            <i className="fas fa-trash text-[10px]" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ==================================================================
          CROPPER MODAL
      =================================================================== */}
      {croppingSymbolId && cropImage && (
        <div className="fixed inset-0 z-[100] bg-black/95 flex flex-col items-center justify-center p-8 backdrop-blur-md">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-7xl h-[85vh] flex flex-col overflow-hidden shadow-2xl relative">
            {/* Modal header */}
            <div className="h-14 border-b border-zinc-800 flex justify-between items-center px-6 bg-black/50">
              <h3 className="text-sm font-bold text-white uppercase">
                {cropMode === 'frame'
                  ? 'Crop Reels Frame (Background)'
                  : (() => {
                      const sym = symbols.find(s => s.id === croppingSymbolId);
                      const isLong = (sym?.spanRows || 1) >= 3;
                      return isLong
                        ? `Crop Long Tile: ${sym?.name ?? ''} (3 rows — keeps background)`
                        : `Crop Symbol: ${sym?.name ?? ''}`;
                    })()}
              </h3>
              <div className="flex items-center gap-3">
                {/* Source image selector — available for both symbol and frame crop */}
                <div className="flex items-center gap-2 bg-zinc-900/80 rounded-lg px-3 py-1.5 border border-zinc-700/50">
                  <span className="text-[10px] uppercase font-bold text-zinc-400 mr-1">Source:</span>
                  <button
                    onClick={() => setCropSourceOverride(null)}
                    className={`text-[11px] font-bold px-3 py-1 rounded transition-colors ${
                      !cropSourceOverride
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700'
                    }`}
                  >
                    <i className="fas fa-image mr-1" />Master
                  </button>
                  <label className="text-[11px] font-bold px-3 py-1 rounded bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700 cursor-pointer transition-colors flex items-center gap-1.5">
                    <i className="fas fa-upload" /> Other Image
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                          if (ev.target?.result) {
                            setCropSourceOverride(ev.target.result as string);
                            setCrop({ x: 10, y: 10, w: 30, h: 30 });
                          }
                        };
                        reader.readAsDataURL(file);
                      }}
                    />
                  </label>
                  {cropSourceOverride && (
                    <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                      <i className="fas fa-check-circle" /> Custom
                    </span>
                  )}
                </div>
                <button
                  onClick={() => { setCroppingSymbolId(null); setCropSourceOverride(null); }}
                  className="text-zinc-400 hover:text-white"
                >
                  <i className="fas fa-times" />
                </button>
              </div>
            </div>

            {/* Image container */}
            <div className="flex-1 bg-black relative overflow-auto flex items-center justify-center select-none p-4 custom-scrollbar">
              <div
                ref={masterWrapperRef}
                className="relative inline-block cursor-crosshair group/crop shadow-2xl border border-zinc-800"
                style={{ width: 'fit-content', height: 'fit-content' }}
                onMouseDown={e => handleMouseDown(e, 'create')}
              >
                <img
                  ref={masterImgRef}
                  src={cropImage}
                  className="block max-h-[70vh] max-w-full pointer-events-none"
                  draggable={false}
                />
                {/* Crop box */}
                <div
                  className={`absolute border-2 box-content cursor-move z-20 shadow-[0_0_0_9999px_rgba(0,0,0,0.7)] ${
                    cropMode === 'frame' ? 'border-blue-500' : 'border-indigo-500'
                  }`}
                  style={{
                    left: `${crop.x}%`,
                    top: `${crop.y}%`,
                    width: `${crop.w}%`,
                    height: `${crop.h}%`,
                  }}
                  onMouseDown={e => handleMouseDown(e, 'move')}
                >
                  {/* Corner handles */}
                  {(['nw', 'ne', 'sw', 'se'] as DragHandle[]).map(h => {
                    const pos: Record<string, string> = {};
                    if (h.includes('n')) pos.top = '-8px';
                    if (h.includes('s')) pos.bottom = '-8px';
                    if (h.includes('w')) pos.left = '-8px';
                    if (h.includes('e')) pos.right = '-8px';
                    return (
                      <div
                        key={h}
                        className={`absolute w-4 h-4 z-30 ${
                          cropMode === 'frame' ? 'bg-blue-500' : 'bg-indigo-500'
                        } cursor-${h}-resize`}
                        style={pos}
                        onMouseDown={e => handleMouseDown(e, h)}
                      />
                    );
                  })}

                  {/* Tooltip */}
                  <div
                    className={`absolute -top-10 left-0 text-white text-[10px] font-bold px-2 py-1 rounded shadow-lg whitespace-nowrap ${
                      cropMode === 'frame' ? 'bg-blue-600' : 'bg-indigo-600'
                    }`}
                  >
                    {cropMode === 'frame'
                      ? 'Crop the Reels Area (Pixel-perfect raw crop)'
                      : (() => {
                          const sym = symbols.find(s => s.id === croppingSymbolId);
                          return (sym?.spanRows || 1) >= 3
                            ? 'Crop Tall Tile (3 rows — background kept)'
                            : 'Crop Single Symbol';
                        })()}
                  </div>
                </div>
              </div>
            </div>

            {/* Modal footer */}
            <div className="h-16 border-t border-zinc-800 bg-zinc-900 flex items-center justify-between px-6">
              <div className="text-[10px] text-zinc-400">
                <i className="fas fa-magic mr-2" />
                {cropMode === 'frame'
                  ? 'Raw crop — pixel-perfect match. Use "AI Clean" button afterwards to remove symbols.'
                  : (() => {
                      const sym = symbols.find(s => s.id === croppingSymbolId);
                      return (sym?.spanRows || 1) >= 3
                        ? 'AI will clean up the crop, keep background/frame, and output at exact 3× height.'
                        : 'Auto-processing: Crop will be isolated on solid WHITE.';
                    })()}
              </div>
              <div className="flex gap-4">
                <button
                  onClick={() => { setCroppingSymbolId(null); setCropSourceOverride(null); }}
                  className="px-4 py-2 text-xs font-bold uppercase text-zinc-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmCrop}
                  className={`text-white px-6 py-2 rounded text-xs font-bold uppercase shadow-lg ${
                    cropMode === 'frame'
                      ? 'bg-blue-600 hover:bg-blue-500'
                      : 'bg-indigo-600 hover:bg-indigo-500'
                  }`}
                >
                  {cropMode === 'frame'
                    ? 'Extract Frame (Raw)'
                    : (() => {
                        const sym = symbols.find(s => s.id === croppingSymbolId);
                        return (sym?.spanRows || 1) >= 3 ? 'Extract Long Tile' : 'Confirm & Extract';
                      })()}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {fullscreenVideo && <VideoFullscreen url={fullscreenVideo} onClose={() => setFullscreenVideo(null)} />}
    </div>
  );
};

export default SymbolGenerator;
