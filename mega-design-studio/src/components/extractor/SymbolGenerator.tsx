import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
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
  SYMBOL_WIDTH,
  SYMBOL_HEIGHT,
  LONG_TILE_WIDTH,
  LONG_TILE_HEIGHT,
} from '@/services/gemini';
import { SymbolItem, MergedFrame, ReferenceAsset } from '@/types';
import { VideoFullscreen } from '@/components/shared/VideoFullscreen';
import { parallelBatch } from '@/services/parallelBatch';
import { AspectRatioSelector } from '@/components/shared/AspectRatioSelector';

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
// Component
// ---------------------------------------------------------------------------

export const SymbolGenerator: React.FC = () => {
  const { symbolGenState, setSymbolGenState, setReferenceAssets, referenceAssets } = useExtractor();
  const { assetLibrary, addAsset } = useApp();

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
    generatedVideos,
    isGeneratingVideo,
    prompt,
    isProcessing,
    activeSubTab,
  } = symbolGenState;

  const updateState = (updates: Partial<typeof symbolGenState>) => {
    setSymbolGenState(prev => ({ ...prev, ...updates }));
  };

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
    updateState({
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
        updateState({
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
    updateState({ isProcessingMaster: true });
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
- Replace EVERY visual from the source image with the new theme — no original artwork should remain.
- Keep the same perspective, camera angle, and overall composition.

COLOUR & CONTRAST REQUIREMENTS — THIS IS CRITICAL FOR VISUAL QUALITY:
- Use a RICH, DIVERSE colour palette — at minimum 5-6 distinct hues across all symbols.
- LOW PAY symbols (letters A/K/Q/J, numbers 10/9) must use DIFFERENT colours from each other (e.g. blue A, green K, purple Q, red J, orange 10, teal 9). They should look distinct at a glance.
- HIGH PAY thematic symbols must be VISUALLY DISTINCT from low pays — use brighter, more saturated, richer colours with glow/shine effects.
- SPECIAL symbols (Wild, Scatter, Bonus) must POP with the most vibrant, eye-catching colours and effects (gold, glowing, particle effects).
- CONTRAST: Every symbol must stand out clearly against the background. If the background is dark, symbols need bright colours, glow, or light outlines. If the background is light, symbols need dark outlines and rich saturated fills.
- NO monochrome palettes. Avoid making everything the same colour family. The result must look like a premium, commercially appealing slot machine with rich visual variety.`;

      const result = await generateBackgroundImage(fullPrompt, detectedRatio, masterImage);
      if (result) {
        updateState({
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
        // Auto re-extract symbols + background after reskin
        autoReExtractSymbols(result);
        autoReExtractBackground(result);
      } else {
        throw new Error('Generation returned null');
      }
    } catch (e) {
      console.error(e);
      alert('Master generation failed.');
      updateState({ isProcessingMaster: false });
    }
  };

  // Feature 1: Load master image from Lab assets
  const handleLoadFromLab = (asset: ReferenceAsset) => {
    const img = new Image();
    img.onload = () => {
      setDetectedRatio(getClosestAspectRatioStatic(img.width, img.height));
      updateState({
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
        // Show processing state
        updateState({
          reelsFrameCropCoordinates: storedFrameCrop,
          isProcessingMaster: true,
        });
        // AI cleans the frame (removes symbols, keeps everything else)
        // Then resizes output to match the raw crop dimensions exactly
        try {
          const cleaned = await extractReelsFrame(cropDataUrl);
          const result = cleaned || cropDataUrl;
          updateState({
            reelsFrame: result,
            isProcessingMaster: false,
          });
          addAsset({
            id: `symgen-reelsframe-${Date.now()}`,
            url: result,
            type: 'background',
            name: 'Reels Frame',
          });
        } catch (frameErr) {
          console.error('Frame extraction failed', frameErr);
          // Fallback to raw crop
          updateState({
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
      }
    } catch (err) {
      console.error(err);
      alert('Extraction failed.');
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
        alert('No symbols detected in the image.');
        setIsAutoExtracting(false);
        return;
      }

      // Step 2: Load image for canvas cropping
      const img = new Image();
      img.src = sourceImg;
      await new Promise<void>(r => { img.onload = () => r(); img.onerror = () => r(); });
      if (!img.width || !img.height) { setIsAutoExtracting(false); return; }

      // Step 3: Create symbol entries and mark all as processing
      const newSymbols: typeof symbols = detected.map((det, i) => ({
        id: `auto-${Date.now()}-${i}`,
        name: det.name,
        sourceUrl: sourceImg,
        rawCropDataUrl: null,
        isolatedUrl: null,
        isProcessing: true,
        cropCoordinates: det.bbox,
        cropSourceView: activeMasterView as 'source' | 'reskinned',
        spanRows: det.isLongTile ? 3 : 1,
        withFrame: det.role !== 'low', // All non-low symbols get withFrame (high, wild, scatter)
        symbolRole: det.role,
      }));

      // Replace existing symbols (keep reels frame state untouched)
      updateState({ symbols: newSymbols, activeSubTab: 'extract' });

      // Step 4: Pre-crop all symbols (canvas ops are instant), then AI-isolate in parallel batches of 4
      const cropData: { det: typeof detected[0]; sym: typeof newSymbols[0]; cropDataUrl: string }[] = [];
      for (let i = 0; i < detected.length; i++) {
        const det = detected[i];
        const sym = newSymbols[i];
        const canvas = document.createElement('canvas');
        const px = Math.round((det.bbox.x / 100) * img.width);
        const py = Math.round((det.bbox.y / 100) * img.height);
        const pw = Math.round((det.bbox.w / 100) * img.width);
        const ph = Math.round((det.bbox.h / 100) * img.height);
        if (pw <= 0 || ph <= 0) continue;
        canvas.width = pw;
        canvas.height = ph;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, px, py, pw, ph, 0, 0, pw, ph);
        cropData.push({ det, sym, cropDataUrl: canvas.toDataURL('image/png') });
      }

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
        },
        4, // batch size — 4 parallel AI calls
        300, // delay between batches
      );
    } catch (err) {
      console.error('Auto extract failed:', err);
      alert('Auto extract failed. Try again.');
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
      alert('Retry failed.');
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
    } catch (err) {
      console.error('Bulk reprocess failed:', err);
    } finally {
      // Clear any remaining processing flags
      setSymbolGenState(prev => ({
        ...prev,
        symbols: prev.symbols.map(s => ({ ...s, isProcessing: false })),
      }));
      setIsBulkRetrying(false);
    }
  };

  const saveSymbolToAssets = (sym: SymbolItem) => {
    if (!sym.isolatedUrl) return;
    const asset: ReferenceAsset = {
      id: crypto.randomUUID(),
      url: sym.isolatedUrl,
      type: 'game_symbol',
      name: sym.name,
    };
    setReferenceAssets(prev => [...prev, asset]);
    alert('Saved to Assets!');
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
    const frameCropCoords = reelsFrameCropCoordinates;
    if (!frameCropCoords || frameCropCoords.w <= 0) return;

    // We need the existing clean reelsFrame as reference
    const cleanRef = reelsFrame;

    setIsCleaningFrame(true);

    const img = new Image();
    img.src = reskinImageUrl;
    await new Promise<void>(r => { img.onload = () => r(); img.onerror = () => r(); });
    if (!img.width || !img.height) { setIsCleaningFrame(false); return; }

    try {
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
      const dirtyCrop = canvas.toDataURL('image/png');

      let result: string;
      if (cleanRef) {
        // Pass 1: reference-based clean (sends original clean frame so AI knows the target)
        const refCleaned = await cleanReelsFrameWithReference(dirtyCrop, cleanRef);
        result = refCleaned || dirtyCrop;
        // Pass 2: standard clean to catch any remaining artifacts
        const polished = await extractReelsFrame(result);
        if (polished) result = polished;
      } else {
        // No reference available — fall back to multi-pass blind cleaning
        result = dirtyCrop;
        for (let pass = 0; pass < 3; pass++) {
          const cleaned = await extractReelsFrame(result);
          if (cleaned) result = cleaned;
        }
      }

      updateState({ reelsFrame: result });
      addAsset({
        id: `symgen-reelsframe-${Date.now()}`,
        url: result,
        type: 'background',
        name: 'Reels Frame (Reskinned)',
      });
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
        // Edit the reels frame background
        const modified = await modifyImage(symbolIsolatedUrl, prompt, '1:1', editAssets, true);
        updateState({ reelsFrame: modified });
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
    setIsCleaningFrame(true);
    try {
      // Detect aspect ratio from the frame image
      const cleaned = await extractReelsFrame(reelsFrame);
      if (cleaned) {
        updateState({ reelsFrame: cleaned });
        addAsset({
          id: `symgen-reelsframe-${Date.now()}`,
          url: cleaned,
          type: 'background',
          name: 'Reels Frame (AI Cleaned)',
        });
      }
    } catch (err) {
      console.error('AI frame clean failed', err);
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
    const longTileIds = symbols.filter(s => s.isolatedUrl && (s.spanRows || 1) >= 3).map(s => s.id);
    if (regularIds.length === 0) { alert('Extract symbols first.'); return; }
    updateState({ gridState: buildGridWithLongTiles(regularIds, longTileIds) });
  };

  const handleVShapeFill = () => {
    const wild = symbols.find(s => s.name === 'Wild' && (s.spanRows || 1) === 1);
    if (!wild || !wild.isolatedUrl) { alert("Extract 'Wild' symbol first."); return; }
    const others = symbols.filter(s => s.isolatedUrl && s.id !== wild.id && (s.spanRows || 1) === 1).map(s => s.id);
    const longTileIds = symbols.filter(s => s.isolatedUrl && (s.spanRows || 1) >= 3).map(s => s.id);
    if (others.length === 0) { alert('Extract other symbols first.'); return; }

    const vCoords = [
      { r: 1, c: 0 }, { r: 2, c: 1 }, { r: 3, c: 2 }, { r: 2, c: 3 }, { r: 1, c: 4 },
    ].map(({ r, c }) => ({ r, c, id: wild.id }));
    updateState({ gridState: buildGridWithLongTiles(others, longTileIds, vCoords) });
  };

  const handleChessboardFill = () => {
    const wild = symbols.find(s => s.name === 'Wild' && (s.spanRows || 1) === 1);
    if (!wild || !wild.isolatedUrl) { alert("Extract 'Wild' symbol first for Chessboard."); return; }
    const others = symbols.filter(s => s.isolatedUrl && s.id !== wild.id && (s.spanRows || 1) === 1).map(s => s.id);
    if (others.length === 0) { alert('Extract other symbols first.'); return; }

    // Chessboard doesn't mix well with long tiles — use regular symbols only
    const g = (gridState || []).map((row, r) =>
      row.map((_, c) =>
        (r + c) % 2 === 0
          ? wild.id
          : others[Math.floor(Math.random() * others.length)]
      )
    );
    updateState({ gridState: g });
  };

  const handleClearGrid = () => {
    updateState({ gridState: (gridState || []).map(row => row.map(() => '')) });
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
    const g = (gridState || []).map(row => [...row]);

    // Helper: find anchor row if dropping on a cell covered by a long tile
    const findAnchor = (row: number, col: number): number => {
      for (let rr = row; rr >= 0; rr--) {
        const id = g[rr]?.[col];
        if (id) {
          const s = symbols.find(sym => sym.id === id);
          if ((s?.spanRows || 1) + rr > row) return rr;
          break;
        }
      }
      return row;
    };

    const symToPlace = dragItem.type === 'LIBRARY_SYMBOL'
      ? symbols.find(s => s.id === dragItem.symbolId)
      : dragItem.gridR !== undefined ? symbols.find(s => s.id === g[dragItem.gridR!][dragItem.gridC!]) : null;
    const span = symToPlace?.spanRows || 1;

    // For long tiles: prevent overflow past grid bottom
    if (span > 1 && r + span > gridRows) {
      r = gridRows - span; // snap to last valid row
      if (r < 0) return; // grid too small for this tile
    }

    if (dragItem.type === 'LIBRARY_SYMBOL') {
      // Clear ALL cells in the span range first
      for (let sr = 0; sr < span && (r + sr) < gridRows; sr++) {
        g[r + sr][c] = '';
      }
      g[r][c] = dragItem.symbolId;
    } else if (dragItem.gridR !== undefined && dragItem.gridC !== undefined) {
      const srcR = dragItem.gridR;
      const srcC = dragItem.gridC;
      const src = g[srcR][srcC];
      // Clear source span
      const srcSym = symbols.find(s => s.id === src);
      const srcSpan = srcSym?.spanRows || 1;
      for (let sr = 0; sr < srcSpan && (srcR + sr) < gridRows; sr++) {
        g[srcR + sr][srcC] = '';
      }
      // Clear destination span
      for (let sr = 0; sr < span && (r + sr) < gridRows; sr++) {
        g[r + sr][c] = '';
      }
      g[r][c] = src;
    }

    updateState({ gridState: g });
    setDragItem(null);
  }, [dragItem, canvasEventToCell, gridState, symbols, gridRows, updateState]);

  // ---- Sync canvas size to reels frame dimensions ----
  useEffect(() => {
    let cancelled = false;
    const src = reelsFrame || masterImage;
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
  }, [reelsFrame, masterImage]);

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

    // Reels frame — fills the entire canvas (canvas is sized to match)
    if (reelsFrame) {
      const frameImg = await loadImg(reelsFrame);
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
  }, [gridState, reelsFrame, symbols, layoutWidth, layoutHeight, layoutOffsetX, layoutOffsetY, layoutGutterHorizontal, layoutGutterVertical, symbolScale, gridRows, gridCols, canvasSize, selectedLayoutSymbolId, hoveredLayoutSymbolId]);

  useEffect(() => {
    const t = setTimeout(drawLayout, 100);
    return () => clearTimeout(t);
  }, [drawLayout, activeSubTab]);

  // ---- Merge & Save ----

  const handleMergeAndSaveFrame = () => {
    if (!canvasRef.current) return;
    const url = canvasRef.current.toDataURL('image/png');
    const frame: MergedFrame = {
      id: crypto.randomUUID(),
      dataUrl: url,
      label: `Frame ${(savedFrames || mergedFrames).length + 1}`,
      timestamp: Date.now(),
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

  // Pad a frame image with green (#00FF00) to match the target video aspect ratio
  const padFrameForVideoRatio = (frameDataUrl: string, targetRatio: '16:9' | '9:16'): Promise<string> => {
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

        // Center the source image
        const offsetX = Math.round((canW - img.width) / 2);
        const offsetY = Math.round((canH - img.height) / 2);
        ctx.drawImage(img, offsetX, offsetY);

        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve(frameDataUrl);
      img.src = frameDataUrl;
    });
  };

  const handleGenerateVideo = async () => {
    if (!selectedStartFrameId || !selectedEndFrameId) {
      alert('Select Start and End frames.');
      return;
    }
    const allFrames = savedFrames || mergedFrames;
    const startFrame = allFrames.find(f => f.id === selectedStartFrameId);
    const endFrame = allFrames.find(f => f.id === selectedEndFrameId);
    if (!startFrame || !endFrame) return;

    updateState({ isGeneratingVideo: true });
    try {
      const p = animationPrompt || 'Slot machine reels spinning with motion blur and then stopping';
      // Pad frames with green screen to match the selected video aspect ratio
      const paddedStart = await padFrameForVideoRatio(startFrame.dataUrl, videoAspectRatio);
      const paddedEnd = await padFrameForVideoRatio(endFrame.dataUrl, videoAspectRatio);
      const { url } = await generateAnimation(paddedStart, paddedEnd, p, videoAspectRatio, 'fast');
      const vidId = crypto.randomUUID();
      updateState({
        generatedVideos: [{ id: vidId, url }, ...(generatedVideos || [])],
        isGeneratingVideo: false,
      });
      // Auto-save video to Lab
      addAsset({ id: vidId, url, type: 'game_symbol', name: `Slot Animation ${(generatedVideos || []).length + 1}`, mediaType: 'video' });
    } catch (err) {
      console.error(err);
      alert('Animation generation failed.');
      updateState({ isGeneratingVideo: false });
    }
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
              <button onClick={() => setShowAssetPicker(false)} className="text-zinc-500 hover:text-white"><i className="fas fa-times" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {labAssets.length === 0 ? (
                <div className="text-center py-12 text-zinc-500">No assets available yet.</div>
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
              <button onClick={() => setEditingSymbol(null)} className="text-zinc-500 hover:text-white"><i className="fas fa-times" /></button>
            </div>
            <div className="flex gap-4">
              <div className="w-1/3 aspect-square bg-black rounded-lg overflow-hidden border border-zinc-800 flex items-center justify-center p-2">
                {editingSymbol.isolatedUrl && <img src={editingSymbol.isolatedUrl} className="max-w-full max-h-full object-contain" />}
                <span className="absolute text-[9px] font-bold text-zinc-500 uppercase bg-black/60 px-2 py-0.5 rounded" style={{ position: 'relative', marginTop: 'auto' }}>Current</span>
              </div>
              <div className="flex-1 flex flex-col gap-4">
                <div>
                  <label className="text-[10px] font-bold text-zinc-500 uppercase mb-2 block">Edit Instruction</label>
                  <textarea value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)} className="w-full bg-black border border-zinc-700 rounded-lg p-3 text-sm text-white focus:border-indigo-500 outline-none resize-none h-24" placeholder='E.g. "Change color to gold", "Add glowing frame", "Make metallic"' />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-zinc-500 uppercase mb-2 block">Reference (Optional)</label>
                  <div className="flex gap-2 items-center">
                    {editReference && <img src={editReference} className="w-10 h-10 rounded object-cover border border-zinc-700" />}
                    <label className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs px-4 py-2 rounded-lg cursor-pointer border border-zinc-700 flex items-center justify-center gap-2">
                      <i className="fas fa-upload" /> Upload Reference
                      <input type="file" accept="image/*" onChange={handleEditReferenceUpload} className="hidden" />
                    </label>
                    {editReference && <button onClick={() => setEditReference(null)} className="text-zinc-500 hover:text-red-500 px-2"><i className="fas fa-trash" /></button>}
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
          <button className="absolute top-4 right-4 text-zinc-500 hover:text-white"><i className="fas fa-times text-2xl"></i></button>
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
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 h-fit space-y-6">
              {/* Upload */}
              <div>
                <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-4">
                  A. Source Image
                </h3>
                <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-zinc-700 rounded-xl hover:border-indigo-500 hover:bg-zinc-800/50 transition-all cursor-pointer group">
                  <i className="fas fa-upload text-2xl text-zinc-600 group-hover:text-indigo-400 mb-2" />
                  <span className="text-xs font-bold text-zinc-500 group-hover:text-zinc-300">
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
                  <div className="text-[10px] text-zinc-500 mt-2 text-center">
                    Detected Ratio: {detectedRatio}
                  </div>
                )}
              </div>

              {/* Reskin Theme */}
              <div>
                <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-2">
                  B. Reskin Theme
                </h3>
                <p className="text-[10px] text-zinc-600 mb-3">
                  Just type the theme. Layout, positions, and symbol types are auto-preserved.
                </p>
                <input
                  type="text"
                  className="w-full bg-black border border-zinc-700 rounded-lg px-3 py-3 text-sm text-white focus:border-indigo-500 outline-none mb-2"
                  placeholder='e.g. "Christmas", "Ancient Egypt", "Cyberpunk Neon"'
                  value={masterPrompt}
                  onChange={e => updateState({ masterPrompt: e.target.value })}
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
                  <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-4">
                    C. Active View
                  </h3>
                  <div className="flex bg-black rounded p-1 border border-zinc-800">
                    <button className="flex-1 py-2 rounded text-xs font-bold uppercase bg-zinc-700 text-white">
                      Original
                    </button>
                    <button disabled className="flex-1 py-2 rounded text-xs font-bold uppercase text-zinc-600 cursor-not-allowed">
                      Pending...
                    </button>
                  </div>
                </div>
              )}
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
                    onClick={() => { updateState({ activeMasterView: 'source' }); setPreviewImage(masterImage); }}
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
                    onClick={() => { updateState({ activeMasterView: 'reskinned' }); setPreviewImage(reskinResult); }}
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
                  {/* Image area — canonical 180:170 for regular, 180:510 for tall */}
                  <div
                    className="bg-zinc-800 relative flex items-center justify-center border-b border-zinc-700 cursor-grab active:cursor-grabbing w-full"
                    style={{ aspectRatio: isLongTile ? '180 / 510' : '180 / 170' }}
                  >
                    {sym.isolatedUrl ? (
                      <img src={sym.isolatedUrl} className="w-full h-full object-contain p-2 pointer-events-none" />
                    ) : (
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-zinc-500 text-xs font-bold">{sym.name}</span>
                        {isLongTile && <span className="text-amber-500 text-[9px] font-bold">TALL TILE (3×)</span>}
                        {sym.withFrame && <span className="text-blue-400 text-[9px] font-bold">WITH FRAME</span>}
                        {sym.symbolRole === 'high' && <span className="text-orange-400 text-[9px] font-bold">HIGH</span>}
                        {sym.symbolRole === 'wild' && <span className="text-purple-400 text-[9px] font-bold">WILD</span>}
                        {sym.symbolRole === 'scatter' && <span className="text-emerald-400 text-[9px] font-bold">SCATTER</span>}
                      </div>
                    )}

                    {/* Badges */}
                    <div className="absolute top-1 left-1 flex flex-col gap-0.5">
                      {isLongTile && (
                        <div className="bg-amber-600 text-white text-[8px] font-black px-1.5 py-0.5 rounded shadow w-fit">
                          3× TALL
                        </div>
                      )}
                      {sym.withFrame && (
                        <div className="bg-blue-600 text-white text-[8px] font-black px-1.5 py-0.5 rounded shadow w-fit">
                          FRAME
                        </div>
                      )}
                      {sym.symbolRole === 'high' && (
                        <div className="bg-orange-600 text-white text-[8px] font-black px-1.5 py-0.5 rounded shadow w-fit">
                          HIGH
                        </div>
                      )}
                      {sym.symbolRole === 'wild' && (
                        <div className="bg-purple-600 text-white text-[8px] font-black px-1.5 py-0.5 rounded shadow w-fit">
                          WILD
                        </div>
                      )}
                      {sym.symbolRole === 'scatter' && (
                        <div className="bg-emerald-600 text-white text-[8px] font-black px-1.5 py-0.5 rounded shadow w-fit">
                          SCATTER
                        </div>
                      )}
                    </div>

                    {sym.isProcessing ? (
                      <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
                        <i className="fas fa-spinner animate-spin text-indigo-500" />
                      </div>
                    ) : (
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                        <button
                          onClick={() => handleStartCrop(sym.id)}
                          className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded text-[10px] font-bold uppercase shadow-lg transition-all transform hover:scale-105"
                        >
                          {isLongTile
                            ? (sym.isolatedUrl ? 'Re-Crop Tall' : 'Crop Tall Tile')
                            : (sym.isolatedUrl ? 'Re-Crop' : 'Crop')}
                        </button>
                        {sym.rawCropDataUrl && (
                          <button
                            onClick={() => handleRetryIsolation(sym.id)}
                            className="bg-white hover:bg-zinc-200 text-black px-3 py-1.5 rounded text-[10px] font-bold uppercase shadow-lg flex items-center gap-1 transition-all transform hover:scale-105"
                          >
                            <i className="fas fa-sync-alt" /> Retry
                          </button>
                        )}
                        {sym.isolatedUrl && (
                          <button
                            onClick={() => { setEditingSymbol(sym); setEditPrompt(''); setEditReference(null); }}
                            className="bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded text-[10px] font-bold uppercase shadow-lg flex items-center gap-1 transition-all transform hover:scale-105"
                          >
                            <i className="fas fa-wand-magic-sparkles" /> Edit
                          </button>
                        )}
                        <label className="bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1.5 rounded text-[10px] font-bold uppercase shadow-lg flex items-center gap-1 transition-all transform hover:scale-105 cursor-pointer">
                          <i className="fas fa-upload" /> Upload
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => handleUploadSymbol(sym.id, e)} />
                        </label>
                        {sym.isolatedUrl && (
                          <button
                            onClick={() => handleClearSymbol(sym.id)}
                            className="bg-red-600/80 hover:bg-red-500 text-white px-3 py-1.5 rounded text-[10px] font-bold uppercase shadow-lg flex items-center gap-1 transition-all transform hover:scale-105"
                          >
                            <i className="fas fa-trash" /> Clear
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="p-3 flex flex-col gap-2 bg-zinc-900/50">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-zinc-300">{sym.name}</span>
                      <button
                        onClick={() => saveSymbolToAssets(sym)}
                        disabled={!sym.isolatedUrl}
                        className="text-zinc-500 hover:text-white disabled:opacity-0"
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
                            : 'border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500'
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
                            : 'border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500'
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
                            : 'border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500'
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
                            : 'border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500'
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

              {/* Reels Frame card — alongside symbols, same UX pattern */}
              <div
                className="bg-zinc-900 border border-blue-800/50 rounded-xl overflow-hidden flex flex-col group col-span-2"
              >
                <div
                  className="bg-zinc-800 relative flex items-center justify-center border-b border-blue-700/30 w-full"
                  style={{ aspectRatio: '360 / 170' }}
                >
                  {reelsFrame ? (
                    <img src={reelsFrame} className="w-full h-full object-contain p-2" />
                  ) : (
                    <div className="flex flex-col items-center gap-1">
                      <i className="fas fa-border-all text-blue-500 text-lg" />
                      <span className="text-zinc-500 text-xs font-bold">Reels Frame</span>
                      <span className="text-blue-400 text-[9px] font-bold">NOT EXTRACTED</span>
                    </div>
                  )}
                  <div className="absolute top-1 left-1">
                    <div className="bg-blue-600 text-white text-[8px] font-black px-1.5 py-0.5 rounded shadow w-fit">
                      FRAME
                    </div>
                  </div>
                  {/* Processing spinner — shown during frame extraction or AI clean */}
                  {(isProcessingMaster || isCleaningFrame) ? (
                    <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-2">
                      <i className="fas fa-spinner animate-spin text-blue-500 text-xl" />
                      <span className="text-blue-300 text-[10px] font-bold uppercase">
                        {isCleaningFrame ? 'AI Cleaning...' : 'Extracting Frame...'}
                      </span>
                    </div>
                  ) : (
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                      <button
                        onClick={handleStartFrameCrop}
                        className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded text-[10px] font-bold uppercase shadow-lg transition-all transform hover:scale-105"
                      >
                        {reelsFrame ? 'Re-Crop' : 'Crop'}
                      </button>
                      {reelsFrame && (
                        <>
                          <button
                            onClick={handleAICleanFrame}
                            className="bg-white hover:bg-zinc-200 text-black px-3 py-1.5 rounded text-[10px] font-bold uppercase shadow-lg flex items-center gap-1 transition-all transform hover:scale-105"
                          >
                            <i className="fas fa-sync-alt" /> Retry
                          </button>
                          <button
                            onClick={() => { setEditingSymbol({ id: '__reelsframe__', name: 'Reels Frame', isolatedUrl: reelsFrame } as any); setEditPrompt(''); setEditReference(null); }}
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
                                updateState({ reelsFrame: url });
                                addAsset({ id: `symgen-reelsframe-${Date.now()}`, url, type: 'background', name: 'Reels Frame (Uploaded)' });
                              };
                              reader.readAsDataURL(file);
                            }} />
                          </label>
                          <button
                            onClick={() => updateState({ reelsFrame: null, reelsFrameCropCoordinates: null })}
                            className="bg-red-600/80 hover:bg-red-500 text-white px-3 py-1.5 rounded text-[10px] font-bold uppercase shadow-lg flex items-center gap-1 transition-all transform hover:scale-105"
                          >
                            <i className="fas fa-trash" /> Clear
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <div className="p-3 flex justify-between items-center bg-zinc-900/50">
                  <span className="text-xs font-bold text-blue-300">Reels Frame</span>
                  {reelsFrame && (
                    <button
                      onClick={() => addAsset({ id: `symgen-reelsframe-${Date.now()}`, url: reelsFrame, type: 'background', name: 'Reels Frame' })}
                      className="text-zinc-500 hover:text-white"
                    >
                      <i className="fas fa-save" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================
            TAB 3 -- LAYOUT & ANIMATE
        ================================================================= */}
        {activeSubTab === 'layout' && (
          <div className="flex flex-col gap-8 h-full">
            {/* TOP: LAYOUT EDITOR */}
            <div className="flex gap-4 min-h-[500px] max-h-[700px]">
              {/* LEFT PANEL: grid config + symbol library */}
              <div className="w-80 flex flex-col gap-4 shrink-0 overflow-y-auto pr-2">
                {/* Grid Config */}
                <div className="bg-zinc-900/50 p-4 rounded-xl border border-zinc-800 space-y-4">
                  <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500">
                    1. Grid Config
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[9px] uppercase font-bold text-zinc-600 block mb-1">Rows</label>
                      <input
                        type="number" min={1} max={10} value={gridRows}
                        onChange={e => updateState({ gridRows: parseInt(e.target.value) || 3 })}
                        className="w-full bg-black border border-zinc-700 rounded px-2 py-1 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase font-bold text-zinc-600 block mb-1">Cols</label>
                      <input
                        type="number" min={1} max={10} value={gridCols}
                        onChange={e => updateState({ gridCols: parseInt(e.target.value) || 5 })}
                        className="w-full bg-black border border-zinc-700 rounded px-2 py-1 text-xs text-white"
                      />
                    </div>
                  </div>
                  {/* Presets */}
                  <div className="grid grid-cols-4 gap-1 mt-2">
                    <button onClick={handleRandomFill} className="bg-zinc-800 hover:bg-zinc-700 text-white py-1.5 rounded text-[9px] font-bold uppercase border border-zinc-700">Random</button>
                    <button onClick={handleVShapeFill} className="bg-zinc-800 hover:bg-zinc-700 text-white py-1.5 rounded text-[9px] font-bold uppercase border border-zinc-700">V-Shape</button>
                    <button onClick={handleChessboardFill} className="bg-zinc-800 hover:bg-zinc-700 text-white py-1.5 rounded text-[9px] font-bold uppercase border border-zinc-700">Chess</button>
                    <button onClick={handleClearGrid} className="bg-zinc-800 hover:bg-zinc-700 text-white py-1.5 rounded text-[9px] font-bold uppercase border border-zinc-700">Clear</button>
                  </div>
                </div>

                {/* Symbol Library */}
                <div className="bg-zinc-900/50 p-4 rounded-xl border border-zinc-800 flex-1 flex flex-col min-h-[300px]">
                  <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-4">
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
                  <div className="mt-4 text-[10px] text-zinc-500 text-center italic">
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
              <div className="w-72 flex flex-col gap-4 shrink-0 overflow-y-auto">
                <div className="bg-zinc-900/50 p-4 rounded-xl border border-zinc-800 space-y-4 flex-1">
                  <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500">
                    3. Reel Window
                  </h3>

                  {/* Sliders */}
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-[9px] uppercase font-bold text-zinc-500">Grid Width</label>
                        <span className="text-[9px] font-mono text-zinc-400">{layoutWidth}%</span>
                      </div>
                      <input type="range" min={10} max={100} value={layoutWidth} onChange={e => updateState({ layoutWidth: +e.target.value })} className="w-full accent-indigo-500 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer" />
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-[9px] uppercase font-bold text-zinc-500">Grid Height</label>
                        <span className="text-[9px] font-mono text-zinc-400">{layoutHeight}%</span>
                      </div>
                      <input type="range" min={10} max={100} value={layoutHeight} onChange={e => updateState({ layoutHeight: +e.target.value })} className="w-full accent-indigo-500 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer" />
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-[9px] uppercase font-bold text-zinc-500">Vertical Offset</label>
                        <span className="text-[9px] font-mono text-zinc-400">{layoutOffsetY || 0}px</span>
                      </div>
                      <input type="range" min={-500} max={500} step={5} value={layoutOffsetY || 0} onChange={e => updateState({ layoutOffsetY: +e.target.value })} className="w-full accent-indigo-500 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer" />
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-[9px] uppercase font-bold text-zinc-500">Horizontal Offset</label>
                        <span className="text-[9px] font-mono text-zinc-400">{layoutOffsetX || 0}px</span>
                      </div>
                      <input type="range" min={-500} max={500} step={5} value={layoutOffsetX || 0} onChange={e => updateState({ layoutOffsetX: +e.target.value })} className="w-full accent-indigo-500 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer" />
                    </div>

                    <div className="h-px bg-zinc-800 my-2" />

                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-[9px] uppercase font-bold text-zinc-500">H. Gutter</label>
                        <span className="text-[9px] font-mono text-zinc-400">{layoutGutterHorizontal || 0}px</span>
                      </div>
                      <input type="range" min={-50} max={100} step={1} value={layoutGutterHorizontal || 0} onChange={e => updateState({ layoutGutterHorizontal: +e.target.value })} className="w-full accent-indigo-500 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer" />
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-[9px] uppercase font-bold text-zinc-500">V. Gutter</label>
                        <span className="text-[9px] font-mono text-zinc-400">{layoutGutterVertical || 0}px</span>
                      </div>
                      <input type="range" min={-50} max={100} step={1} value={layoutGutterVertical || 0} onChange={e => updateState({ layoutGutterVertical: +e.target.value })} className="w-full accent-indigo-500 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer" />
                    </div>

                    <div className="h-px bg-zinc-800 my-2" />

                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-[9px] uppercase font-bold text-zinc-500">Symbol Scale (All)</label>
                        <span className="text-[9px] font-mono text-zinc-400">{symbolScale || 100}%</span>
                      </div>
                      <input type="range" min={10} max={200} step={5} value={symbolScale || 100} onChange={e => updateState({ symbolScale: +e.target.value })} className="w-full accent-pink-500 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer" />
                    </div>
                  </div>

                  {/* Per-symbol scale override */}
                  {(() => {
                    const sel = selectedLayoutSymbolId ? symbols.find(s => s.id === selectedLayoutSymbolId) : null;
                    if (!sel) return (
                      <div className="mt-3 bg-zinc-800/40 border border-zinc-700/40 rounded-lg p-3 text-center">
                        <p className="text-[9px] text-zinc-600 italic">Click a symbol on the grid to adjust its individual scale.</p>
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
                            className="text-[8px] text-zinc-500 hover:text-white uppercase font-bold px-1.5 py-0.5 rounded border border-zinc-700 hover:border-zinc-500 transition-colors"
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
                            <label className="text-[9px] uppercase font-bold text-zinc-500">H. Scale</label>
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
                            <label className="text-[9px] uppercase font-bold text-zinc-500">V. Scale</label>
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

                  {/* Frame status indicator */}
                  <div className="mt-4">
                    {reelsFrame ? (
                      <div className="flex items-center gap-2 px-3 py-2 bg-blue-900/20 border border-blue-500/30 rounded">
                        <i className="fas fa-check text-blue-400 text-xs" />
                        <span className="text-[10px] font-bold text-blue-200">Frame Active</span>
                      </div>
                    ) : (
                      <button
                        onClick={() => { updateState({ activeSubTab: 'extract' }); handleStartFrameCrop(); }}
                        className="w-full text-[10px] bg-blue-600/20 hover:bg-blue-600/40 text-blue-300 border border-blue-600/30 px-3 py-2 rounded uppercase font-bold transition-colors"
                      >
                        <i className="fas fa-border-all mr-1" /> Extract Frame in Extract Tab
                      </button>
                    )}
                  </div>

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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Saved frames + prompt */}
                <div className="flex flex-col gap-4">
                  <div>
                    <label className="text-[10px] uppercase font-bold text-zinc-500 block mb-2">
                      Animation Prompt
                    </label>
                    <textarea
                      value={animationPrompt}
                      onChange={e => updateState({ animationPrompt: e.target.value })}
                      className="w-full bg-black border border-zinc-700 rounded-lg p-3 text-sm text-white focus:border-indigo-500 outline-none resize-none h-20"
                      placeholder='E.g. "Slot machine reels spinning blur then stopping, cinematic lighting"'
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-zinc-500 block mb-2">
                      Video Aspect Ratio
                    </label>
                    <AspectRatioSelector
                      value={videoAspectRatio}
                      onChange={(r) => setVideoAspectRatio(r as '16:9' | '9:16')}
                      options={['16:9', '9:16']}
                    />
                    <p className="text-[9px] text-zinc-600 mt-1 italic">
                      Green screen padding fills any missing space to match the selected ratio.
                    </p>
                  </div>

                  <div className="flex items-center justify-between">
                    <h4 className="text-[10px] font-bold text-zinc-500 uppercase">
                      Saved Merged Frames ({frames.length})
                    </h4>
                    <span className="text-[9px] text-zinc-600 italic">Select Start and End points for Veo 3.1</span>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-6 overflow-y-auto max-h-[500px] p-2">
                    {frames.length === 0 && (
                      <div className="col-span-2 text-center py-10 border border-dashed border-zinc-800 rounded-xl bg-zinc-900/30">
                        <i className="fas fa-images text-zinc-700 text-2xl mb-2" />
                        <p className="text-zinc-600 text-xs">
                          No saved frames yet.<br />Click "Merge & Save Frame" above.
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
                            isStart
                              ? 'border-indigo-500 ring-4 ring-indigo-500/20'
                              : isEnd
                              ? 'border-pink-500 ring-4 ring-pink-500/20'
                              : 'border-zinc-800 hover:border-zinc-600'
                          }`}
                        >
                          {isStart && (
                            <div className="absolute top-2 left-2 bg-indigo-600 text-white text-[10px] font-bold px-2 py-1 rounded shadow z-10 uppercase">
                              Start
                            </div>
                          )}
                          {isEnd && (
                            <div className="absolute top-2 left-2 bg-pink-600 text-white text-[10px] font-bold px-2 py-1 rounded shadow z-10 uppercase">
                              End
                            </div>
                          )}

                          <div className="absolute top-2 right-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => { e.stopPropagation(); setPreviewImage(frame.dataUrl); }}
                              className="w-8 h-8 rounded-full bg-black/60 hover:bg-white hover:text-black text-white flex items-center justify-center backdrop-blur-md shadow-lg transition-colors border border-white/10"
                              title="Fullscreen Preview"
                            >
                              <i className="fas fa-eye text-xs"></i>
                            </button>
                          </div>

                          <div className="aspect-[9/16] w-full relative">
                            <img src={frame.dataUrl} className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-3 p-4">
                              <div className="flex gap-2 w-full">
                                <button
                                  onClick={() => updateState({ selectedStartFrameId: frame.id })}
                                  className={`flex-1 py-2 text-[10px] font-bold uppercase rounded-lg ${
                                    isStart ? 'bg-white text-indigo-900' : 'bg-indigo-600 text-white hover:bg-indigo-500'
                                  }`}
                                >
                                  Start
                                </button>
                                <button
                                  onClick={() => updateState({ selectedEndFrameId: frame.id })}
                                  className={`flex-1 py-2 text-[10px] font-bold uppercase rounded-lg ${
                                    isEnd ? 'bg-white text-pink-900' : 'bg-pink-600 text-white hover:bg-pink-500'
                                  }`}
                                >
                                  End
                                </button>
                              </div>
                              <button
                                onClick={() => handleDeleteMergedFrame(frame.id)}
                                className="w-full py-2 bg-zinc-800 hover:bg-red-900/50 text-zinc-400 hover:text-red-400 text-[10px] uppercase font-bold rounded-lg transition-colors border border-zinc-700"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                          <div className="p-3 bg-zinc-900/90 border-t border-zinc-800 text-[10px] text-zinc-400 font-mono text-center font-bold">
                            Frame #{i + 1}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Animate Selected Frames button - below the saved frames */}
                  <button
                    onClick={handleGenerateVideo}
                    disabled={isGeneratingVideo || !selectedStartFrameId || !selectedEndFrameId}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-lg text-xs font-black uppercase tracking-widest shadow-lg disabled:opacity-50 flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-95 mt-4"
                  >
                    {isGeneratingVideo ? (
                      <i className="fas fa-spinner animate-spin" />
                    ) : (
                      <i className="fas fa-video" />
                    )}
                    {isGeneratingVideo ? 'Generating...' : 'Animate Selected Frames'}
                  </button>
                </div>

                {/* Generated Videos Gallery */}
                <div className="flex flex-col gap-4">
                  <h4 className="text-[10px] font-bold text-zinc-500 uppercase mt-8 md:mt-0">
                    Generated Videos ({(generatedVideos || []).length})
                  </h4>
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 overflow-y-auto max-h-[500px] p-1">
                    {(generatedVideos || []).length === 0 && (
                      <div className="col-span-2 text-center py-10 text-zinc-600 text-xs italic">
                        No videos generated yet.
                      </div>
                    )}
                    {(generatedVideos || []).map((vid, i) => (
                      <div key={vid.id} className="bg-black rounded-lg border border-zinc-800 overflow-hidden group relative shadow-lg">
                        <video src={vid.url} className="w-full aspect-[9/16] object-cover" controls loop />
                        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => setFullscreenVideo(vid.url)} className="bg-black/50 hover:bg-white text-white hover:text-black w-7 h-7 rounded flex items-center justify-center transition-colors">
                            <i className="fas fa-expand text-[10px]" />
                          </button>
                          <a href={vid.url} download={`slot_anim_${i + 1}.mp4`} className="bg-black/50 hover:bg-white text-white hover:text-black w-7 h-7 rounded flex items-center justify-center transition-colors">
                            <i className="fas fa-download text-[10px]" />
                          </a>
                        </div>
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <span className="text-[9px] font-bold text-white">Video #{i + 1}</span>
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
                  className="text-zinc-500 hover:text-white"
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
              <div className="text-[10px] text-zinc-500">
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
