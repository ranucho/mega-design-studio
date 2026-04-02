import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useBanner } from '@/contexts/BannerContext';
import { useApp } from '@/contexts/AppContext';
import { analyzeBanner, canvasCropElement, extractElement, cropImageToRegion, modifyImage, whiteToAlpha, autoTrimTransparent } from '@/services/gemini';
import { parallelBatch } from '@/services/parallelBatch';
import { ExtractedElement, BannerLayer, DetectedElement, ROLE_TO_CATEGORY, CATEGORY_META, type ElementCategory } from '@/types';
import { useToast } from '@/components/shared/Toast';

// ── Recrop Modal ──────────────────────────────────────────────
// Shows the source banner with a draggable/resizable bounding box.
// User adjusts the crop, then re-extracts the element with the new bbox.

interface RecropModalProps {
  sourceImage: string;
  element: ExtractedElement;
  onApply: (elementId: string, newBbox: { x: number; y: number; w: number; h: number }) => void;
  onClose: () => void;
  isBusy: boolean;
}

const RecropModal: React.FC<RecropModalProps> = ({ sourceImage, element, onApply, onClose, isBusy }) => {
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Bbox in percentage (0-100) — initialized from element's sourceBbox
  const [bbox, setBbox] = useState(() => element.sourceBbox ?? { x: 10, y: 10, w: 80, h: 80 });
  const dragRef = useRef<{
    type: 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';
    startMouseX: number;
    startMouseY: number;
    startBbox: { x: number; y: number; w: number; h: number };
  } | null>(null);

  // Convert mouse coords to bbox-percentage space
  const getPercent = useCallback((clientX: number, clientY: number) => {
    const img = imgRef.current;
    if (!img) return { px: 0, py: 0 };
    const rect = img.getBoundingClientRect();
    return {
      px: ((clientX - rect.left) / rect.width) * 100,
      py: ((clientY - rect.top) / rect.height) * 100,
    };
  }, []);

  const handlePointerDown = useCallback((
    e: React.PointerEvent,
    type: NonNullable<typeof dragRef.current>['type'],
  ) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      type,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startBbox: { ...bbox },
    };
  }, [bbox]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const img = imgRef.current;
    if (!img) return;

    const rect = img.getBoundingClientRect();
    const dxPct = ((e.clientX - d.startMouseX) / rect.width) * 100;
    const dyPct = ((e.clientY - d.startMouseY) / rect.height) * 100;
    const s = d.startBbox;

    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

    if (d.type === 'move') {
      const nx = clamp(s.x + dxPct, 0, 100 - s.w);
      const ny = clamp(s.y + dyPct, 0, 100 - s.h);
      setBbox({ x: nx, y: ny, w: s.w, h: s.h });
    } else {
      let { x, y, w, h } = s;
      // Resize from edges/corners
      if (d.type.includes('w')) { x = clamp(s.x + dxPct, 0, s.x + s.w - 2); w = s.w - (x - s.x); }
      if (d.type.includes('e')) { w = clamp(s.w + dxPct, 2, 100 - s.x); }
      if (d.type.includes('n')) { y = clamp(s.y + dyPct, 0, s.y + s.h - 2); h = s.h - (y - s.y); }
      if (d.type.includes('s')) { h = clamp(s.h + dyPct, 2, 100 - s.y); }
      setBbox({ x, y, w, h });
    }
  }, []);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleApply = useCallback(() => {
    onApply(element.id, {
      x: Math.round(bbox.x * 100) / 100,
      y: Math.round(bbox.y * 100) / 100,
      w: Math.round(bbox.w * 100) / 100,
      h: Math.round(bbox.h * 100) / 100,
    });
  }, [bbox, element.id, onApply]);

  // Reset bbox
  const handleReset = useCallback(() => {
    if (element.sourceBbox) setBbox({ ...element.sourceBbox });
  }, [element.sourceBbox]);

  // Handle corners — small squares at each corner + edge midpoints
  const handles: Array<{ type: NonNullable<typeof dragRef.current>['type']; cursor: string; left: string; top: string }> = useMemo(() => [
    { type: 'nw', cursor: 'nwse-resize', left: '0%', top: '0%' },
    { type: 'ne', cursor: 'nesw-resize', left: '100%', top: '0%' },
    { type: 'sw', cursor: 'nesw-resize', left: '0%', top: '100%' },
    { type: 'se', cursor: 'nwse-resize', left: '100%', top: '100%' },
    { type: 'n', cursor: 'ns-resize', left: '50%', top: '0%' },
    { type: 's', cursor: 'ns-resize', left: '50%', top: '100%' },
    { type: 'w', cursor: 'ew-resize', left: '0%', top: '50%' },
    { type: 'e', cursor: 'ew-resize', left: '100%', top: '50%' },
  ], []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={() => onClose()}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 max-w-3xl w-full shadow-2xl flex flex-col gap-4"
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <i className="fa-solid fa-crop text-cyan-400" />
            Recrop: {element.label}
          </h3>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-zinc-400">Drag to move • Handles to resize</span>
            <button onClick={onClose} className="text-zinc-400 hover:text-white transition-colors">
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
        </div>

        {/* Image with crop overlay */}
        <div ref={containerRef} className="relative select-none overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950"
          onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}>
          <img ref={imgRef} src={sourceImage} alt="Source" className="w-full h-auto block" draggable={false} />

          {/* Dimming overlay outside the crop */}
          <div className="absolute inset-0 pointer-events-none"
            style={{
              background: `linear-gradient(to right,
                rgba(0,0,0,0.65) ${bbox.x}%,
                transparent ${bbox.x}%,
                transparent ${bbox.x + bbox.w}%,
                rgba(0,0,0,0.65) ${bbox.x + bbox.w}%)`,
            }} />
          {/* Top dim band */}
          <div className="absolute pointer-events-none" style={{
            left: `${bbox.x}%`, top: 0, width: `${bbox.w}%`, height: `${bbox.y}%`,
            backgroundColor: 'rgba(0,0,0,0.65)',
          }} />
          {/* Bottom dim band */}
          <div className="absolute pointer-events-none" style={{
            left: `${bbox.x}%`, top: `${bbox.y + bbox.h}%`, width: `${bbox.w}%`, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.65)',
          }} />

          {/* Crop rectangle — draggable */}
          <div
            className="absolute border-2 border-cyan-400"
            style={{
              left: `${bbox.x}%`, top: `${bbox.y}%`,
              width: `${bbox.w}%`, height: `${bbox.h}%`,
              cursor: 'move',
              boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
            }}
            onPointerDown={(e) => handlePointerDown(e, 'move')}
          >
            {/* Crosshair guide lines */}
            <div className="absolute inset-0 pointer-events-none"
              style={{
                backgroundImage: 'linear-gradient(to right, rgba(0,255,255,0.15) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,255,255,0.15) 1px, transparent 1px)',
                backgroundSize: '33.33% 33.33%',
              }} />

            {/* Resize handles */}
            {handles.map(h => (
              <div key={h.type}
                className="absolute w-3 h-3 bg-cyan-400 border border-cyan-600 rounded-sm shadow-lg"
                style={{
                  left: h.left, top: h.top, cursor: h.cursor,
                  transform: 'translate(-50%, -50%)',
                }}
                onPointerDown={(e) => handlePointerDown(e, h.type)}
              />
            ))}
          </div>
        </div>

        {/* Info + Actions */}
        <div className="flex items-center justify-between">
          <div className="text-[10px] text-zinc-400 font-mono">
            x:{bbox.x.toFixed(1)}% y:{bbox.y.toFixed(1)}% w:{bbox.w.toFixed(1)}% h:{bbox.h.toFixed(1)}%
          </div>
          <div className="flex gap-2">
            <button onClick={handleReset}
              className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white border border-zinc-700 rounded-lg transition-colors">
              <i className="fa-solid fa-rotate-left mr-1" />Reset
            </button>
            <button onClick={onClose}
              className="px-4 py-1.5 text-xs text-zinc-400 hover:text-white border border-zinc-700 rounded-lg transition-colors">
              Cancel
            </button>
            <button onClick={handleApply}
              disabled={isBusy}
              className="px-4 py-1.5 text-xs bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5">
              {isBusy
                ? <><i className="fa-solid fa-spinner fa-spin" /> Extracting...</>
                : <><i className="fa-solid fa-crop" /> Re-extract</>
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const ROLE_COLORS: Record<BannerLayer['role'], string> = {
  background: '#92400e',
  character: '#1d4ed8',
  text: '#15803d',
  cta: '#ea580c',
  logo: '#7c3aed',
  decoration: '#ca8a04',
  other: '#64748b',
};

const ROLE_ICONS: Record<BannerLayer['role'], string> = {
  background: 'fa-image',
  character: 'fa-user',
  text: 'fa-font',
  cta: 'fa-bullhorn',
  logo: 'fa-copyright',
  decoration: 'fa-sparkles',
  other: 'fa-shapes',
};

export const BannerExtractor: React.FC = () => {
  const { project, setProject, addExtractedElement, setStage, updateComposition } = useBanner();
  const { addAsset } = useApp();
  const { toast } = useToast();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [extractingIds, setExtractingIds] = useState<Set<number>>(new Set());
  const [retryingElementIds, setRetryingElementIds] = useState<Set<string>>(new Set());
  const [retryCountMap, setRetryCountMap] = useState<Record<string, number>>({});
  // processedInRun lives in project context so it survives tab switches
  const processedInRun = project?.extractionProcessedCount || 0;
  const [failedIds, setFailedIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const hasStarted = useRef(false);

  // Before/after toggle (for reskinned banners)
  const [showOriginal, setShowOriginal] = useState(false);

  // Edit modal state
  const [editingElement, setEditingElement] = useState<ExtractedElement | null>(null);
  const [editPrompt, setEditPrompt] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  // Recrop modal state
  const [recropElement, setRecropElement] = useState<ExtractedElement | null>(null);
  const [isRecropping, setIsRecropping] = useState(false);

  // Inline rename state
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [editLabelValue, setEditLabelValue] = useState('');

  // Enlarge preview lightbox state
  const [previewElement, setPreviewElement] = useState<ExtractedElement | null>(null);

  // Use detected elements from project context (persisted across tab switches)
  const detected = project?.detectedElements || [];
  const totalElements = detected.length;

  // Pre-extraction bbox editing state
  const [selectedBboxIdx, setSelectedBboxIdx] = useState<number | null>(null);
  const bboxDragRef = useRef<{
    type: 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';
    startPx: number; startPy: number;
    startBbox: { x: number; y: number; w: number; h: number };
  } | null>(null);
  const sourceImgRef = useRef<HTMLImageElement>(null);

  // Draw new element state
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [drawingBbox, setDrawingBbox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const drawStartRef = useRef<{ px: number; py: number } | null>(null);
  const [newElementForm, setNewElementForm] = useState<{ bbox: { x: number; y: number; w: number; h: number }; label: string; role: BannerLayer['role'] } | null>(null);

  // Helper: mouse → percentage coords on source image
  const getImgPercent = useCallback((clientX: number, clientY: number) => {
    const img = sourceImgRef.current;
    if (!img) return { px: 0, py: 0 };
    const rect = img.getBoundingClientRect();
    return {
      px: Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)),
      py: Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100)),
    };
  }, []);

  // Bbox drag handlers for pre-extraction editing
  const handleBboxPointerDown = useCallback((e: React.PointerEvent, idx: number, type: NonNullable<typeof bboxDragRef.current>['type']) => {
    e.preventDefault(); e.stopPropagation();
    setSelectedBboxIdx(idx);
    const p = getImgPercent(e.clientX, e.clientY);
    bboxDragRef.current = { type, startPx: p.px, startPy: p.py, startBbox: { ...detected[idx].bbox } };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [detected, getImgPercent]);

  const handleBboxPointerMove = useCallback((e: React.PointerEvent) => {
    // Drawing mode
    if (isDrawingMode && drawStartRef.current) {
      const p = getImgPercent(e.clientX, e.clientY);
      const sx = drawStartRef.current.px, sy = drawStartRef.current.py;
      setDrawingBbox({
        x: Math.min(sx, p.px), y: Math.min(sy, p.py),
        w: Math.abs(p.px - sx), h: Math.abs(p.py - sy),
      });
      return;
    }
    // Bbox editing
    const drag = bboxDragRef.current;
    if (!drag || selectedBboxIdx === null) return;
    const p = getImgPercent(e.clientX, e.clientY);
    const dx = p.px - drag.startPx, dy = p.py - drag.startPy;
    const b = { ...drag.startBbox };
    const MIN = 3;
    switch (drag.type) {
      case 'move': b.x += dx; b.y += dy; break;
      case 'nw': b.x += dx; b.y += dy; b.w -= dx; b.h -= dy; break;
      case 'ne': b.w += dx; b.y += dy; b.h -= dy; break;
      case 'sw': b.x += dx; b.w -= dx; b.h += dy; break;
      case 'se': b.w += dx; b.h += dy; break;
      case 'n': b.y += dy; b.h -= dy; break;
      case 's': b.h += dy; break;
      case 'w': b.x += dx; b.w -= dx; break;
      case 'e': b.w += dx; break;
    }
    b.x = Math.max(0, Math.min(100 - MIN, b.x));
    b.y = Math.max(0, Math.min(100 - MIN, b.y));
    b.w = Math.max(MIN, Math.min(100 - b.x, b.w));
    b.h = Math.max(MIN, Math.min(100 - b.y, b.h));
    setProject(prev => {
      if (!prev) return null;
      const newDet = [...prev.detectedElements];
      newDet[selectedBboxIdx] = { ...newDet[selectedBboxIdx], bbox: b };
      return { ...prev, detectedElements: newDet };
    });
  }, [isDrawingMode, selectedBboxIdx, getImgPercent, setProject]);

  const handleBboxPointerUp = useCallback(() => {
    // Finalize drawing
    if (isDrawingMode && drawStartRef.current && drawingBbox && drawingBbox.w > 2 && drawingBbox.h > 2) {
      setNewElementForm({ bbox: drawingBbox, label: '', role: 'other' });
      setDrawingBbox(null);
      drawStartRef.current = null;
      setIsDrawingMode(false);
      return;
    }
    drawStartRef.current = null;
    setDrawingBbox(null);
    bboxDragRef.current = null;
  }, [isDrawingMode, drawingBbox]);

  // Auto-start analysis on mount (only if no elements already detected or extracted)
  useEffect(() => {
    if (project?.sourceImage && !hasStarted.current && detected.length === 0 && !isAnalyzing && project.extractedElements.length === 0) {
      hasStarted.current = true;
      runAnalysis();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.sourceImage]);

  const runAnalysis = useCallback(async () => {
    if (!project?.sourceImage) return;
    setIsAnalyzing(true);
    setError(null);
    setProject(prev => prev ? { ...prev, detectedElements: [] } : null);

    setFailedIds(new Set());
    try {
      const elements = await analyzeBanner(project.sourceImage);
      // Persist detected elements in project context
      setProject(prev => prev ? { ...prev, detectedElements: elements } : null);
      toast(`Detected ${elements.length} elements`, { type: 'success' });
    } catch (err: any) {
      setError(err.message || 'Analysis failed');
    } finally {
      setIsAnalyzing(false);
    }
  }, [project?.sourceImage, setProject]);

  /**
   * Extract a single element using AI with white-background isolation.
   * Sends ONLY the crop (not both images) to avoid confusing AI on small banners.
   * Falls back to canvas crop if AI fails.
   */
  const extractSingleElement = useCallback(async (
    sourceImage: string,
    el: DetectedElement,
    attempt = 0,
    allElements?: DetectedElement[],
  ): Promise<ExtractedElement> => {
    try {
      let dataUrl: string;

      if (el.role === 'character') {
        // ── CHARACTER: Use the proven Character Studio approach ──
        // Send ONLY the crop to modifyImage (no full banner context)
        // This is the same method that works reliably in the Slot Generator
        const cropDataUrl = await cropImageToRegion(sourceImage, el.bbox, 25);
        const fullBodyPrompt = `CHARACTER EXTRACTION & FULL BODY GENERATION:
Look at this cropped image — it contains a character (or part of a character).
Your task:
1. LOOK at the character VISUALLY in this crop. Do NOT rely on any text label — extract EXACTLY what you SEE in the image.
2. REMOVE all background elements — output on a SOLID WHITE background (#FFFFFF)
3. GENERATE THE COMPLETE FULL BODY of this character from head to toe, even if only a portion is visible
4. Maintain the EXACT same art style, colors, outfit, features, pose, and design language as shown in the crop
5. The character must look IDENTICAL to what is in the crop — same person/creature, same clothing, same pose direction
6. Full body visible, centered on the canvas
7. The character should occupy about 80% of the canvas height
8. Do NOT add any outline, stroke, or border around the character
9. Do NOT change the character's identity, profession, species, or appearance in any way
Output: A clean, full-body character on pure white background that matches EXACTLY what is shown in the crop.`;
        const rawResult = await modifyImage(cropDataUrl, fullBodyPrompt, '9:16', []);
        const transparent = await whiteToAlpha(rawResult, 30);
        const trimmed = await autoTrimTransparent(transparent, 2);
        dataUrl = trimmed.dataUrl;
      } else {
        // ── ALL OTHER ELEMENTS: Use extractElement as before ──
        let croppedImg: string | undefined;
        if (el.role !== 'background') {
          try {
            croppedImg = await cropImageToRegion(sourceImage, el.bbox, el.role === 'decoration' ? 25 : 15);
          } catch { /* fallback to full image */ }
        }

        const neighbors = allElements
          ? allElements.filter(other => other !== el && other.role !== 'background')
          : undefined;

        dataUrl = await extractElement(sourceImage, el, croppedImg, attempt, neighbors);
      }

      const dims = await new Promise<{ w: number; h: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => resolve({ w: 100, h: 100 });
        img.src = dataUrl;
      });

      return {
        id: crypto.randomUUID(),
        dataUrl,
        role: el.role,
        label: el.label,
        nativeWidth: dims.w,
        nativeHeight: dims.h,
        detectedText: el.detectedText,
        sourceBbox: { ...el.bbox },
      };
    } catch {
      // Fallback: canvas pixel crop (no transparency but better than nothing)
      if (el.role === 'background') {
        const dims = await new Promise<{ w: number; h: number }>((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = () => resolve({ w: 100, h: 100 });
          img.src = sourceImage;
        });
        return {
          id: crypto.randomUUID(),
          dataUrl: sourceImage,
          role: el.role,
          label: el.label,
          nativeWidth: dims.w,
          nativeHeight: dims.h,
          detectedText: el.detectedText,
          sourceBbox: { ...el.bbox },
        };
      }
      const { dataUrl, width, height } = await canvasCropElement(sourceImage, el.bbox, 2);
      return {
        id: crypto.randomUUID(),
        dataUrl,
        role: el.role,
        label: el.label,
        nativeWidth: width,
        nativeHeight: height,
        detectedText: el.detectedText,
        sourceBbox: { ...el.bbox },
      };
    }
  }, []);

  // Auto-save element to global assets
  const saveToAssets = useCallback((el: ExtractedElement) => {
    addAsset({
      id: `banner-el-${el.id}`,
      url: el.dataUrl,
      type: 'symbol',
      name: `Banner: ${el.label}`,
    });
  }, [addAsset]);

  // Bulk AI extraction (2 concurrent AI calls, 1.5s delay between batches)
  // When existing elements are present (e.g. after reskin), updates them in-place
  const runExtraction = useCallback(async () => {
    if (!project?.sourceImage || detected.length === 0) return;

    const hasExisting = project.extractedElements.length > 0;
    // Don't clear elements — keep existing ones and update them live
    setProject(prev => prev ? { ...prev, isExtracting: true, extractionProcessedCount: 0 } : null);
    setFailedIds(new Set());
    setExtractingIds(new Set());
    setError(null);

    // Local counter to track failures within this invocation (avoids stale closure on failedIds state)
    let localFailedCount = 0;

    try {
      await parallelBatch(
        detected,
        async (el, idx) => {
          setExtractingIds(prev => new Set(prev).add(idx));
          return await extractSingleElement(project.sourceImage, el, 0, detected);
        },
        (result, _item, idx) => {
          // Update in-place if element with same label exists, otherwise add
          setProject(prev => {
            if (!prev) return null;
            const existingIdx = prev.extractedElements.findIndex(e => e.label === result.label);
            if (existingIdx >= 0) {
              const updated = [...prev.extractedElements];
              updated[existingIdx] = { ...result, id: prev.extractedElements[existingIdx].id };
              return { ...prev, extractedElements: updated };
            }
            return { ...prev, extractedElements: [...prev.extractedElements, result] };
          });
          saveToAssets(result);
          setProject(prev => prev ? { ...prev, extractionProcessedCount: (prev.extractionProcessedCount || 0) + 1 } : null);
          setExtractingIds(prev => {
            const next = new Set(prev);
            next.delete(idx);
            return next;
          });
        },
        2, // 2 concurrent AI calls (rate limit friendly)
        1500, // 1.5s delay between batches
        (_err, _item, idx) => {
          localFailedCount++;
          setProject(prev => prev ? { ...prev, extractionProcessedCount: (prev.extractionProcessedCount || 0) + 1 } : null);
          setFailedIds(prev => new Set(prev).add(idx));

          setExtractingIds(prev => {
            const next = new Set(prev);
            next.delete(idx);
            return next;
          });
        },
      );
    } catch (err: any) {
      setError(err.message || 'Extraction failed');
    } finally {
      setProject(prev => prev ? { ...prev, isExtracting: false } : null);
      setExtractingIds(new Set());
      // Toast with result summary — use local counter instead of stale failedIds closure
      const failedCount = localFailedCount;
      if (failedCount > 0) {
        toast(`Extracted ${detected.length - failedCount}/${detected.length} elements (${failedCount} failed)`, { type: 'error' });
      } else {
        toast(`Extracted ${detected.length} elements`, { type: 'success' });
      }

      // Auto-update existing compositions after re-extraction (e.g. after reskin)
      // Uses a longer timeout to ensure all React state batches have flushed
      setTimeout(() => {
        setProject(currentProj => {
          if (!currentProj || currentProj.compositions.length === 0 || currentProj.extractedElements.length === 0) return currentProj;
          const newEls = currentProj.extractedElements;
          let anyUpdated = false;
          const updatedComps = currentProj.compositions.map(comp => {
            let layersChanged = false;
            const newLayers = comp.layers.map(layer => {
              // Match by name (label) — case-insensitive, trimmed
              const layerName = layer.name.trim().toLowerCase();
              const newEl = newEls.find(e => e.label.trim().toLowerCase() === layerName);
              if (!newEl) return layer;
              // Always update src even if dimensions match — the image content may have changed after reskin
              if (newEl.dataUrl === layer.src) return layer;
              layersChanged = true;
              const scaleAdj = layer.nativeWidth > 0 && newEl.nativeWidth > 0
                ? (layer.nativeWidth * layer.scaleX) / newEl.nativeWidth
                : layer.scaleX;
              return { ...layer, src: newEl.dataUrl, nativeWidth: newEl.nativeWidth, nativeHeight: newEl.nativeHeight, scaleX: scaleAdj, scaleY: scaleAdj };
            });
            if (!layersChanged) return comp;
            anyUpdated = true;
            return { ...comp, layers: newLayers, sparkleDataUrl: undefined, status: 'edited' as const };
          });
          if (!anyUpdated) return currentProj;
          return { ...currentProj, compositions: updatedComps };
        });
      }, 500);
    }
  }, [project?.sourceImage, detected, setProject, addExtractedElement, extractSingleElement, saveToAssets, toast]);

  /**
   * Retry extraction for a single element.
   * Uses sourceBbox from the extracted element (not local detected state).
   */
  const retrySingleElement = useCallback(async (elementId: string) => {
    if (!project?.sourceImage) return;
    const existing = project.extractedElements.find(e => e.id === elementId);
    if (!existing || !existing.sourceBbox) return;

    // Build a DetectedElement from the existing extracted element's metadata
    const detectedEl: DetectedElement = {
      label: existing.label,
      role: existing.role,
      bbox: existing.sourceBbox,
      detectedText: existing.detectedText,
    };

    // Increment retry count for this element (starts at 1 for first retry)
    const currentRetry = (retryCountMap[elementId] || 0) + 1;
    setRetryCountMap(prev => ({ ...prev, [elementId]: currentRetry }));

    setRetryingElementIds(prev => new Set(prev).add(elementId));
    try {
      const newExtracted = await extractSingleElement(project.sourceImage, detectedEl, currentRetry, detected);
      setProject(prev => {
        if (!prev) return null;
        return {
          ...prev,
          extractedElements: prev.extractedElements.map(e =>
            e.id === elementId ? { ...newExtracted, id: elementId } : e
          ),
        };
      });
      saveToAssets({ ...newExtracted, id: elementId });

      // Auto-update all compositions that use this element
      const updatedEl = { ...newExtracted, id: elementId };
      if (project.compositions.length > 0) {
        for (const comp of project.compositions) {
          const layerToUpdate = comp.layers.find(l =>
            l.src === existing.dataUrl || l.name === existing.label
          );
          if (layerToUpdate) {
            const scaleAdj = (layerToUpdate.nativeWidth * layerToUpdate.scaleX) / updatedEl.nativeWidth;
            updateComposition(comp.id, {
              layers: comp.layers.map(l =>
                l.id === layerToUpdate.id
                  ? { ...l, src: updatedEl.dataUrl, nativeWidth: updatedEl.nativeWidth, nativeHeight: updatedEl.nativeHeight, scaleX: scaleAdj, scaleY: scaleAdj }
                  : l
              ),
              sparkleDataUrl: undefined,
            });
          }
        }
      }

      toast(`Re-extracted "${existing.label}" (attempt ${currentRetry})`, { type: 'success' });
    } catch (err: any) {
      setError(`AI extraction failed for "${existing.label}": ${err.message}`);
      toast(`Retry failed for "${existing.label}"`, { type: 'error' });
    } finally {
      setRetryingElementIds(prev => {
        const next = new Set(prev);
        next.delete(elementId);
        return next;
      });
    }
  }, [project?.sourceImage, project?.extractedElements, project?.compositions, setProject, extractSingleElement, saveToAssets, retryCountMap, updateComposition]);

  // Full-body character extraction — uses the same proven approach as Character Studio
  // Sends ONLY the crop to modifyImage with a full-body-on-white prompt, then whiteToAlpha
  const handleFullBodyExtract = useCallback(async (elementId: string) => {
    if (!project?.sourceImage) return;
    const existing = project.extractedElements.find(e => e.id === elementId);
    if (!existing || !existing.sourceBbox) return;

    setRetryingElementIds(prev => new Set(prev).add(elementId));
    try {
      // Crop the character region with generous padding
      const cropDataUrl = await cropImageToRegion(project.sourceImage, existing.sourceBbox, 25);

      // Same prompt as CharacterStudio.handleExtractCharacter
      const fullBodyPrompt = `CHARACTER EXTRACTION & FULL BODY GENERATION:
Look at this cropped image — it contains a character (or part of a character such as a torso, head, or upper body).
Your task:
1. IDENTIFY the character in the crop
2. REMOVE all background elements — output on a SOLID WHITE background (#FFFFFF)
3. GENERATE THE COMPLETE FULL BODY of this character from head to toe, even if only a portion is visible in the crop
4. Maintain the EXACT same art style, colors, outfit, features, and design language
5. Standing pose, full body visible, centered on the canvas
6. The character should occupy about 80% of the canvas height
7. Do NOT add any outline, stroke, or border around the character
Output: A clean, full-body character on pure white background.`;

      const rawResult = await modifyImage(cropDataUrl, fullBodyPrompt, '9:16', []);

      // Remove white background → transparent (edge flood-fill)
      const transparent = await whiteToAlpha(rawResult, 30);
      const trimmed = await autoTrimTransparent(transparent, 2);

      // Get dimensions
      const dims = await new Promise<{ w: number; h: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => resolve({ w: 100, h: 100 });
        img.src = trimmed.dataUrl;
      });

      setProject(prev => {
        if (!prev) return null;
        return {
          ...prev,
          extractedElements: prev.extractedElements.map(e =>
            e.id === elementId ? {
              ...e,
              dataUrl: trimmed.dataUrl,
              nativeWidth: dims.w,
              nativeHeight: dims.h,
            } : e
          ),
        };
      });
      saveToAssets({ ...existing, dataUrl: trimmed.dataUrl, nativeWidth: dims.w, nativeHeight: dims.h });
      toast(`Full-body extracted for "${existing.label}"`, { type: 'success' });
    } catch (err: any) {
      console.error('Full body extraction failed:', err);
      toast(`Full body failed for "${existing.label}": ${err.message}`, { type: 'error' });
    } finally {
      setRetryingElementIds(prev => {
        const next = new Set(prev);
        next.delete(elementId);
        return next;
      });
    }
  }, [project?.sourceImage, project?.extractedElements, setProject, saveToAssets, toast]);

  // Clear (delete) element
  const clearElement = useCallback((elementId: string) => {
    setProject(prev => {
      if (!prev) return null;
      return {
        ...prev,
        extractedElements: prev.extractedElements.filter(e => e.id !== elementId),
      };
    });
  }, [setProject]);

  // Upload custom image for element
  const handleUploadElement = useCallback((elementId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      if (!dataUrl) return;
      const img = new Image();
      img.onload = () => {
        setProject(prev => {
          if (!prev) return null;
          return {
            ...prev,
            extractedElements: prev.extractedElements.map(el =>
              el.id === elementId
                ? { ...el, dataUrl, nativeWidth: img.naturalWidth, nativeHeight: img.naturalHeight }
                : el
            ),
          };
        });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }, [setProject]);

  // AI Edit element (image-to-image with prompt) — preserves transparency after edit
  const handleEditElement = useCallback(async () => {
    if (!editingElement || !editPrompt.trim() || !project) return;
    setIsEditing(true);
    try {
      // Use editMode: true for proper image-to-image editing
      const edited = await modifyImage(editingElement.dataUrl, editPrompt, '1:1', [], true);
      if (edited) {
        // Re-apply white-to-alpha to restore transparency (AI edit outputs opaque images)
        const transparent = await whiteToAlpha(edited, 25);
        const trimmed = await autoTrimTransparent(transparent, 2);
        const finalUrl = trimmed.dataUrl;

        const img = new Image();
        img.onload = () => {
          const oldDataUrl = editingElement.dataUrl;
          setProject(prev => {
            if (!prev) return null;
            return {
              ...prev,
              extractedElements: prev.extractedElements.map(el =>
                el.id === editingElement.id
                  ? { ...el, dataUrl: finalUrl, nativeWidth: img.naturalWidth, nativeHeight: img.naturalHeight }
                  : el
              ),
            };
          });

          // Auto-update all compositions that use this element
          if (project.compositions.length > 0) {
            for (const comp of project.compositions) {
              const layerToUpdate = comp.layers.find(l =>
                l.src === oldDataUrl || l.name === editingElement.label
              );
              if (layerToUpdate) {
                const scaleAdj = (layerToUpdate.nativeWidth * layerToUpdate.scaleX) / img.naturalWidth;
                updateComposition(comp.id, {
                  layers: comp.layers.map(l =>
                    l.id === layerToUpdate.id
                      ? { ...l, src: finalUrl, nativeWidth: img.naturalWidth, nativeHeight: img.naturalHeight, scaleX: scaleAdj, scaleY: scaleAdj }
                      : l
                  ),
                  sparkleDataUrl: undefined,
                });
              }
            }
          }

          setEditingElement(null);
          setEditPrompt('');
          toast(`Edited "${editingElement.label}"`, { type: 'success' });
        };
        img.src = finalUrl;
      }
    } catch (err: any) {
      setError(`Edit failed: ${err.message}`);
      toast(`Edit failed`, { type: 'error' });
    } finally {
      setIsEditing(false);
    }
  }, [editingElement, editPrompt, setProject, project, updateComposition]);

  /**
   * Recrop: user adjusted the bounding box manually, re-extract with new crop.
   */
  const handleRecrop = useCallback(async (elementId: string, newBbox: { x: number; y: number; w: number; h: number }) => {
    if (!project?.sourceImage) return;
    const existing = project.extractedElements.find(e => e.id === elementId);
    if (!existing) return;

    setIsRecropping(true);
    setRetryingElementIds(prev => new Set(prev).add(elementId));
    try {
      const detectedEl: DetectedElement = {
        label: existing.label,
        role: existing.role,
        bbox: newBbox,
        detectedText: existing.detectedText,
      };
      const newExtracted = await extractSingleElement(project.sourceImage, detectedEl, 1, detected);
      // Update the element with new extraction + new bbox
      setProject(prev => {
        if (!prev) return null;
        return {
          ...prev,
          extractedElements: prev.extractedElements.map(e =>
            e.id === elementId ? { ...newExtracted, id: elementId, sourceBbox: newBbox } : e
          ),
        };
      });
      saveToAssets({ ...newExtracted, id: elementId });
      setRecropElement(null); // Close modal on success
      toast(`Recropped "${existing.label}"`, { type: 'success' });
    } catch (err: any) {
      setError(`Recrop failed for "${existing.label}": ${err.message}`);
      toast(`Recrop failed for "${existing.label}"`, { type: 'error' });
    } finally {
      setIsRecropping(false);
      setRetryingElementIds(prev => {
        const next = new Set(prev);
        next.delete(elementId);
        return next;
      });
    }
  }, [project?.sourceImage, project?.extractedElements, setProject, extractSingleElement, saveToAssets]);

  if (!project) return null;

  const isExtracting = project.isExtracting;
  const extractedElements = project.extractedElements;
  const hasResults = extractedElements.length > 0;
  const failCount = failedIds.size;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-5xl mx-auto flex flex-col gap-6">

          {/* Source banner with interactive detected overlays */}
          <div className="flex gap-6 items-start">
            <div
              className={`relative flex-1 rounded-xl overflow-hidden border bg-zinc-900 self-start ${isDrawingMode ? 'border-cyan-500 cursor-crosshair' : 'border-zinc-700'}`}
              onPointerMove={handleBboxPointerMove}
              onPointerUp={handleBboxPointerUp}
              onPointerDown={isDrawingMode ? (e) => {
                const p = getImgPercent(e.clientX, e.clientY);
                drawStartRef.current = { px: p.px, py: p.py };
                setDrawingBbox({ x: p.px, y: p.py, w: 0, h: 0 });
              } : undefined}
              onClick={isDrawingMode ? undefined : () => setSelectedBboxIdx(null)}
            >
              <img ref={sourceImgRef} src={showOriginal && project.originalImage ? project.originalImage : project.sourceImage} alt="Source banner" className="w-full h-auto block select-none" draggable={false} />

              {/* Before/After toggle for reskinned banners */}
              {project.originalImage && (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowOriginal(!showOriginal); }}
                  className="absolute top-2 right-2 z-20 px-2.5 py-1.5 rounded-lg bg-black/70 hover:bg-black/90 text-[10px] font-bold text-white backdrop-blur-sm transition-colors flex items-center gap-1.5"
                >
                  <i className={`fa-solid ${showOriginal ? 'fa-eye' : 'fa-eye-slash'}`} />
                  {showOriginal ? 'Original' : 'Reskinned'}
                </button>
              )}

              {/* Bbox overlays — clickable for editing */}
              {detected.map((el, i) => {
                const isSelected = selectedBboxIdx === i;
                const color = ROLE_COLORS[el.role];
                return (
                  <div
                    key={i}
                    className={`absolute border-2 transition-opacity ${isSelected ? 'z-10' : ''}`}
                    style={{
                      left: `${el.bbox.x}%`, top: `${el.bbox.y}%`,
                      width: `${el.bbox.w}%`, height: `${el.bbox.h}%`,
                      borderColor: color,
                      opacity: isSelected ? 1 : extractingIds.has(i) ? 1 : 0.6,
                      cursor: isDrawingMode ? 'crosshair' : 'pointer',
                    }}
                    onClick={(e) => { if (!isDrawingMode) { e.stopPropagation(); setSelectedBboxIdx(i); } }}
                    onPointerDown={isSelected && !isDrawingMode ? (e) => handleBboxPointerDown(e, i, 'move') : undefined}
                  >
                    <span
                      className="absolute -top-5 left-0 text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap pointer-events-none"
                      style={{ backgroundColor: color, color: 'white' }}
                    >
                      {el.label}
                    </span>
                    {/* Resize handles when selected */}
                    {isSelected && !isDrawingMode && (
                      <>
                        {(['nw','n','ne','w','e','sw','s','se'] as const).map(h => {
                          const pos: Record<string, React.CSSProperties> = {
                            nw: { top: -4, left: -4, cursor: 'nwse-resize' },
                            n: { top: -4, left: '50%', marginLeft: -4, cursor: 'ns-resize' },
                            ne: { top: -4, right: -4, cursor: 'nesw-resize' },
                            w: { top: '50%', left: -4, marginTop: -4, cursor: 'ew-resize' },
                            e: { top: '50%', right: -4, marginTop: -4, cursor: 'ew-resize' },
                            sw: { bottom: -4, left: -4, cursor: 'nesw-resize' },
                            s: { bottom: -4, left: '50%', marginLeft: -4, cursor: 'ns-resize' },
                            se: { bottom: -4, right: -4, cursor: 'nwse-resize' },
                          };
                          return (
                            <div key={h}
                              className="absolute w-2 h-2 bg-white border border-zinc-900 rounded-sm z-20"
                              style={{ ...pos[h], position: 'absolute' }}
                              onPointerDown={(e) => handleBboxPointerDown(e, i, h)}
                            />
                          );
                        })}
                        {/* Delete button for this detected element */}
                        <button
                          className="absolute -top-5 -right-1 w-4 h-4 bg-red-600 text-white rounded-full text-[8px] flex items-center justify-center hover:bg-red-500 z-20"
                          onClick={(e) => {
                            e.stopPropagation();
                            setProject(prev => prev ? { ...prev, detectedElements: prev.detectedElements.filter((_, idx) => idx !== i) } : null);
                            setSelectedBboxIdx(null);
                          }}
                          title="Remove element"
                        >
                          <i className="fa-solid fa-times" />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}

              {/* Drawing preview rectangle */}
              {isDrawingMode && drawingBbox && drawingBbox.w > 0 && (
                <div className="absolute border-2 border-dashed border-cyan-400 bg-cyan-400/10 pointer-events-none z-20"
                  style={{ left: `${drawingBbox.x}%`, top: `${drawingBbox.y}%`, width: `${drawingBbox.w}%`, height: `${drawingBbox.h}%` }}
                />
              )}

              {isAnalyzing && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                  <div className="flex items-center gap-3 text-cyan-400">
                    <i className="fa-solid fa-spinner fa-spin text-lg" />
                    <span className="text-sm font-medium">Analyzing banner elements...</span>
                  </div>
                </div>
              )}
            </div>

            {/* Detected elements sidebar — grouped by category */}
            {detected.length > 0 && (
              <div className="w-64 shrink-0 flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-zinc-300 mb-1">
                  Detected Elements ({detected.length})
                </h3>
                <div className="flex flex-col gap-3 overflow-auto max-h-[400px] pr-1">
                  {(['text', 'ui', 'images'] as ElementCategory[]).map(cat => {
                    const catMeta = CATEGORY_META[cat];
                    const catElements = detected.map((el, i) => ({ el, i })).filter(({ el }) => ROLE_TO_CATEGORY[el.role] === cat);
                    if (catElements.length === 0) return null;
                    return (
                      <div key={cat}>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <i className={`fa-solid ${catMeta.icon} text-[10px]`} style={{ color: catMeta.color }} />
                          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: catMeta.color }}>{catMeta.label}</span>
                          <span className="text-[9px] text-zinc-400 ml-auto">{catElements.length}</span>
                        </div>
                        <div className="flex flex-col gap-1.5">
                  {catElements.map(({ el, i }) => {
                    const isCurrentlyExtracting = extractingIds.has(i);
                    const hasFailed = failedIds.has(i);
                    const isDone = !hasFailed && !isCurrentlyExtracting && project?.extractedElements.some(e => e.label === el.label);
                    return (
                      <div key={i} className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-xs transition-all ${
                        isCurrentlyExtracting
                          ? 'bg-cyan-600/10 border-cyan-600/30'
                          : isDone
                            ? 'bg-zinc-800/60 border-zinc-700/30'
                            : 'bg-zinc-800/80 border-zinc-700/50'
                      }`}>
                        <i className={`fa-solid ${ROLE_ICONS[el.role]} text-[10px]`} style={{ color: ROLE_COLORS[el.role] }} />
                        <span className="text-zinc-300 flex-1 truncate">{el.label}</span>
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase"
                          style={{ backgroundColor: ROLE_COLORS[el.role] + '20', color: ROLE_COLORS[el.role] }}
                        >{el.role}</span>
                        {isCurrentlyExtracting && (
                          <i className="fa-solid fa-spinner fa-spin text-cyan-400 text-[10px]" />
                        )}
                        {hasFailed && (
                          <i className="fa-solid fa-triangle-exclamation text-amber-500 text-[10px]" title="AI extraction failed — used canvas crop fallback" />
                        )}
                        {isDone && !hasFailed && (
                          <i className="fa-solid fa-check text-emerald-500 text-[10px]" />
                        )}
                      </div>
                    );
                  })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Extract button */}
                {!isExtracting && !hasResults && (
                  <button onClick={runExtraction}
                    className="mt-2 px-4 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium rounded-lg transition-colors shadow-lg shadow-cyan-600/20">
                    <i className="fa-solid fa-puzzle-piece mr-2" />Extract All Elements
                  </button>
                )}

                {/* Re-extract all */}
                {!isExtracting && hasResults && (
                  <button onClick={runExtraction}
                    className="mt-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5">
                    <i className="fa-solid fa-sync-alt" />Re-extract All
                  </button>
                )}

                {/* Retry failed */}
                {!isExtracting && failCount > 0 && (
                  <button onClick={runExtraction}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium rounded-lg transition-colors">
                    <i className="fa-solid fa-rotate-right mr-1.5" />Retry Failed ({failCount})
                  </button>
                )}

                {/* Re-analyze */}
                {!isExtracting && !isAnalyzing && (
                  <button onClick={() => { hasStarted.current = false; runAnalysis(); }}
                    className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-300 border border-zinc-700 rounded-lg transition-colors">
                    <i className="fa-solid fa-rotate mr-1" />Re-analyze
                  </button>
                )}

                {/* Add new element */}
                {!isExtracting && !isAnalyzing && (
                  <button
                    onClick={() => { setIsDrawingMode(!isDrawingMode); setSelectedBboxIdx(null); }}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
                      isDrawingMode
                        ? 'bg-cyan-600 text-white'
                        : 'text-zinc-400 hover:text-zinc-300 border border-zinc-700'
                    }`}
                  >
                    <i className={`fa-solid ${isDrawingMode ? 'fa-times' : 'fa-plus'}`} />
                    {isDrawingMode ? 'Cancel Drawing' : 'Add Element'}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* New element form (after drawing a bbox) */}
          {newElementForm && (
            <div className="px-4 py-3 bg-zinc-800/80 rounded-lg border border-cyan-600/50 flex items-center gap-3">
              <span className="text-xs text-zinc-400">New element:</span>
              <input
                className="text-xs bg-zinc-900 border border-zinc-600 rounded px-2 py-1.5 text-zinc-200 outline-none focus:border-cyan-500 flex-1 min-w-0"
                placeholder="Element name..."
                value={newElementForm.label}
                autoFocus
                onChange={(e) => setNewElementForm(prev => prev ? { ...prev, label: e.target.value } : null)}
              />
              <select
                className="text-xs bg-zinc-900 border border-zinc-600 rounded px-2 py-1.5 text-zinc-200 outline-none"
                value={newElementForm.role}
                onChange={(e) => setNewElementForm(prev => prev ? { ...prev, role: e.target.value as BannerLayer['role'] } : null)}
              >
                <option value="text">Text</option>
                <option value="cta">CTA</option>
                <option value="logo">Logo</option>
                <option value="character">Character</option>
                <option value="decoration">Decoration</option>
                <option value="other">Other</option>
              </select>
              <button
                disabled={!newElementForm.label.trim()}
                onClick={() => {
                  if (!newElementForm.label.trim()) return;
                  setProject(prev => prev ? {
                    ...prev,
                    detectedElements: [...prev.detectedElements, {
                      label: newElementForm.label.trim(),
                      role: newElementForm.role,
                      bbox: newElementForm.bbox,
                    }],
                  } : null);
                  toast(`Added "${newElementForm.label.trim()}"`, { type: 'success' });
                  setNewElementForm(null);
                }}
                className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-xs font-medium rounded transition-colors"
              >
                <i className="fa-solid fa-check mr-1" />Add
              </button>
              <button
                onClick={() => setNewElementForm(null)}
                className="px-2 py-1.5 text-zinc-400 hover:text-zinc-300 text-xs transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Extraction progress */}
          {isExtracting && (
            <div className="px-4 py-3 bg-zinc-800/60 rounded-lg border border-zinc-700/50 flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <i className="fa-solid fa-wand-magic-sparkles fa-spin text-cyan-400" />
                <div className="flex-1">
                  <div className="flex justify-between text-xs text-zinc-400 mb-1">
                    <span>AI extracting elements with transparency...</span>
                    <span className="font-mono">{processedInRun} / {totalElements}</span>
                  </div>
                  <div className="h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                    <div className="h-full bg-cyan-500 rounded-full transition-all duration-500"
                      style={{ width: `${totalElements > 0 ? (processedInRun / totalElements) * 100 : 0}%` }} />
                  </div>
                </div>
              </div>
              {/* Currently processing elements */}
              {extractingIds.size > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {Array.from(extractingIds).map(idx => {
                    const el = detected[idx];
                    if (!el) return null;
                    return (
                      <span key={idx} className="flex items-center gap-1 px-2 py-1 bg-cyan-600/10 border border-cyan-600/30 rounded text-[10px] text-cyan-400">
                        <i className="fa-solid fa-spinner fa-spin text-[8px]" />
                        {el.label}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Extracted elements grid with per-element actions */}
          {extractedElements.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-zinc-300 mb-3">
                Extracted Elements ({extractedElements.length})
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {extractedElements.map((el) => {
                  const isRetrying = retryingElementIds.has(el.id);
                  return (
                    <div key={el.id} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden flex flex-col group">
                      {/* Image area — checkerboard shows transparency */}
                      <div className="aspect-square relative flex items-center justify-center border-b border-zinc-700"
                        style={{
                          backgroundImage: 'linear-gradient(45deg, #1a1a2e 25%, transparent 25%), linear-gradient(-45deg, #1a1a2e 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1a1a2e 75%), linear-gradient(-45deg, transparent 75%, #1a1a2e 75%)',
                          backgroundSize: '16px 16px',
                          backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
                          backgroundColor: '#0f0f23',
                        }}>
                        <img src={el.dataUrl} alt={el.label} className="max-w-full max-h-full object-contain p-2 pointer-events-none" />

                        {/* Processing overlay */}
                        {isRetrying ? (
                          <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
                            <i className="fa-solid fa-spinner fa-spin text-cyan-400 text-lg" />
                          </div>
                        ) : (
                          /* Hover actions */
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                            <button onClick={() => setPreviewElement(el)}
                              className="bg-zinc-500 hover:bg-zinc-400 text-white px-3 py-1.5 rounded text-[10px] font-bold uppercase shadow-lg flex items-center gap-1 transition-all transform hover:scale-105">
                              <i className="fa-solid fa-expand" /> View
                            </button>
                            <button onClick={() => retrySingleElement(el.id)}
                              className="bg-white hover:bg-zinc-200 text-black px-3 py-1.5 rounded text-[10px] font-bold uppercase shadow-lg flex items-center gap-1 transition-all transform hover:scale-105"
                              title={retryCountMap[el.id] ? `Attempt ${retryCountMap[el.id] + 1} — stronger prompt each time` : 'Re-extract with AI'}>
                              <i className="fa-solid fa-sync-alt" /> Retry{retryCountMap[el.id] ? ` (${retryCountMap[el.id]})` : ''}
                            </button>
                            {el.role === 'character' && (
                              <button onClick={() => handleFullBodyExtract(el.id)}
                                className="bg-purple-600 hover:bg-purple-500 text-white px-3 py-1.5 rounded text-[10px] font-bold uppercase shadow-lg flex items-center gap-1 transition-all transform hover:scale-105"
                                title="Uses the proven Character Studio method — removes background and generates complete full body">
                                <i className="fa-solid fa-person" /> Full Body
                              </button>
                            )}
                            <button onClick={() => setRecropElement(el)}
                              className="bg-cyan-700 hover:bg-cyan-600 text-white px-3 py-1.5 rounded text-[10px] font-bold uppercase shadow-lg flex items-center gap-1 transition-all transform hover:scale-105">
                              <i className="fa-solid fa-crop" /> Recrop
                            </button>
                            <button onClick={() => { setEditingElement(el); setEditPrompt(''); }}
                              className="bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded text-[10px] font-bold uppercase shadow-lg flex items-center gap-1 transition-all transform hover:scale-105">
                              <i className="fa-solid fa-wand-magic-sparkles" /> Edit
                            </button>
                            <label className="bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1.5 rounded text-[10px] font-bold uppercase shadow-lg flex items-center gap-1 transition-all transform hover:scale-105 cursor-pointer">
                              <i className="fa-solid fa-upload" /> Upload
                              <input type="file" accept="image/*" className="hidden" onChange={(e) => handleUploadElement(el.id, e)} />
                            </label>
                            <button onClick={() => clearElement(el.id)}
                              className="bg-red-600/80 hover:bg-red-500 text-white px-3 py-1.5 rounded text-[10px] font-bold uppercase shadow-lg flex items-center gap-1 transition-all transform hover:scale-105">
                              <i className="fa-solid fa-trash" /> Clear
                            </button>
                          </div>
                        )}

                        {/* Role badge */}
                        <div className="absolute top-1 left-1">
                          <div className="text-[8px] font-black px-1.5 py-0.5 rounded shadow uppercase"
                            style={{ backgroundColor: ROLE_COLORS[el.role], color: 'white' }}>
                            {el.role}
                          </div>
                        </div>
                      </div>

                      {/* Info bar */}
                      <div className="p-2 bg-zinc-900/50">
                        <div className="flex items-center gap-1.5">
                          <i className={`fa-solid ${ROLE_ICONS[el.role]} text-[9px]`} style={{ color: ROLE_COLORS[el.role] }} />
                          {editingLabelId === el.id ? (
                            <input
                              className="text-xs font-bold text-zinc-100 bg-zinc-800 border border-cyan-500 rounded px-1 py-0.5 flex-1 min-w-0 outline-none"
                              value={editLabelValue}
                              autoFocus
                              onChange={(e) => setEditLabelValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  const newLabel = editLabelValue.trim();
                                  if (newLabel) setProject(prev => prev ? { ...prev, extractedElements: prev.extractedElements.map(x => x.id === el.id ? { ...x, label: newLabel } : x) } : null);
                                  setEditingLabelId(null);
                                } else if (e.key === 'Escape') {
                                  setEditingLabelId(null);
                                }
                              }}
                              onBlur={() => {
                                const newLabel = editLabelValue.trim();
                                if (newLabel) setProject(prev => prev ? { ...prev, extractedElements: prev.extractedElements.map(x => x.id === el.id ? { ...x, label: newLabel } : x) } : null);
                                setEditingLabelId(null);
                              }}
                            />
                          ) : (
                            <span
                              className="text-xs font-bold text-zinc-300 truncate flex-1 cursor-pointer hover:text-cyan-400 transition-colors"
                              onDoubleClick={() => { setEditingLabelId(el.id); setEditLabelValue(el.label); }}
                              title="Double-click to rename"
                            >{el.label}</span>
                          )}
                        </div>
                        <div className="text-[9px] text-zinc-400 mt-0.5">
                          {el.nativeWidth} x {el.nativeHeight}
                          {el.detectedText && <span className="ml-2 text-zinc-400">"{el.detectedText}"</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Edit modal */}
          {editingElement && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
              onClick={() => { setEditingElement(null); setEditPrompt(''); }}>
              <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 max-w-md w-full shadow-2xl"
                onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <i className="fa-solid fa-wand-magic-sparkles text-amber-400" />
                    Edit: {editingElement.label}
                  </h3>
                  <button onClick={() => { setEditingElement(null); setEditPrompt(''); }}
                    className="text-zinc-400 hover:text-white transition-colors">
                    <i className="fa-solid fa-xmark" />
                  </button>
                </div>
                <div className="flex gap-4 mb-4">
                  <div className="w-24 h-24 rounded-lg overflow-hidden bg-zinc-800 flex items-center justify-center shrink-0">
                    <img src={editingElement.dataUrl} alt="" className="max-w-full max-h-full object-contain" />
                  </div>
                  <div className="flex-1 flex flex-col gap-2">
                    <input
                      type="text"
                      value={editPrompt}
                      onChange={e => setEditPrompt(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleEditElement()}
                      placeholder="Describe changes (e.g., 'remove shadow', 'make text red')"
                      className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder:text-zinc-400 focus:outline-none focus:border-cyan-600"
                      autoFocus
                    />
                    <p className="text-[10px] text-zinc-400">Uses AI to modify the extracted element</p>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => { setEditingElement(null); setEditPrompt(''); }}
                    className="px-4 py-2 text-xs text-zinc-400 hover:text-white border border-zinc-700 rounded-lg transition-colors">
                    Cancel
                  </button>
                  <button onClick={handleEditElement}
                    disabled={isEditing || !editPrompt.trim()}
                    className="px-4 py-2 text-xs bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5">
                    {isEditing ? <><i className="fa-solid fa-spinner fa-spin" /> Editing...</> : <><i className="fa-solid fa-wand-magic-sparkles" /> Apply</>}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Recrop modal */}
          {recropElement && project?.sourceImage && (
            <RecropModal
              sourceImage={project.sourceImage}
              element={recropElement}
              onApply={handleRecrop}
              onClose={() => setRecropElement(null)}
              isBusy={isRecropping}
            />
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-4 py-3 bg-red-900/20 border border-red-800/40 rounded-lg text-sm text-red-400">
              <i className="fa-solid fa-circle-exclamation" />
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)} className="text-red-500 hover:text-red-300">
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
          )}

          {/* Partial failure warning */}
          {!isExtracting && failCount > 0 && (
            <div className="flex items-center gap-2 px-4 py-3 bg-amber-900/20 border border-amber-700/40 rounded-lg text-sm text-amber-400">
              <i className="fa-solid fa-triangle-exclamation" />
              {failCount} element{failCount > 1 ? 's' : ''} failed. You can retry or continue with what was extracted.
            </div>
          )}

          {/* Continue button — always show when there are extracted elements */}
          {hasResults && !isExtracting && (
            <div className="flex justify-end">
              <button onClick={() => setStage('presets')}
                className="px-6 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium rounded-lg transition-colors shadow-lg shadow-cyan-600/20">
                Select Sizes <i className="fa-solid fa-arrow-right ml-2" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Enlarge preview lightbox */}
      {previewElement && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-8 cursor-pointer"
          onClick={() => setPreviewElement(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center gap-3" onClick={e => e.stopPropagation()}>
            <div
              className="flex items-center justify-center"
              style={{
                backgroundImage: 'linear-gradient(45deg, #1a1a2e 25%, transparent 25%), linear-gradient(-45deg, #1a1a2e 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1a1a2e 75%), linear-gradient(-45deg, transparent 75%, #1a1a2e 75%)',
                backgroundSize: '24px 24px',
                backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0px',
                backgroundColor: '#0f0f23',
                borderRadius: '12px',
                overflow: 'hidden',
              }}
            >
              <img
                src={previewElement.dataUrl}
                alt={previewElement.label}
                className="max-w-[85vw] max-h-[80vh] object-contain"
              />
            </div>
            <div className="flex items-center gap-3 text-zinc-300">
              <span className="text-sm font-bold">{previewElement.label}</span>
              <span className="text-xs text-zinc-400">{previewElement.nativeWidth} × {previewElement.nativeHeight}</span>
              <span className="text-[10px] px-2 py-0.5 rounded uppercase font-bold" style={{ backgroundColor: ROLE_COLORS[previewElement.role], color: 'white' }}>
                {previewElement.role}
              </span>
            </div>
            <button
              onClick={() => setPreviewElement(null)}
              className="absolute -top-2 -right-2 w-8 h-8 bg-zinc-800 hover:bg-zinc-700 text-white rounded-full flex items-center justify-center border border-zinc-600 transition-colors"
            >
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
