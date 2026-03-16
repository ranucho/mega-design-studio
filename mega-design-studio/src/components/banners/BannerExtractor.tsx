import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useBanner } from '@/contexts/BannerContext';
import { useApp } from '@/contexts/AppContext';
import { analyzeBanner, canvasCropElement, extractElement, cropImageToRegion, modifyImage, whiteToAlpha, autoTrimTransparent } from '@/services/gemini';
import { parallelBatch } from '@/services/parallelBatch';
import { ExtractedElement, BannerLayer, DetectedElement } from '@/types';
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
            <span className="text-[10px] text-zinc-500">Drag to move • Handles to resize</span>
            <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
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
          <div className="text-[10px] text-zinc-500 font-mono">
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
  const { project, setProject, addExtractedElement, setStage } = useBanner();
  const { addAsset } = useApp();
  const { toast } = useToast();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [extractingIds, setExtractingIds] = useState<Set<number>>(new Set());
  const [retryingElementIds, setRetryingElementIds] = useState<Set<string>>(new Set());
  const [extractedCount, setExtractedCount] = useState(0);
  const [failedIds, setFailedIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const hasStarted = useRef(false);

  // Edit modal state
  const [editingElement, setEditingElement] = useState<ExtractedElement | null>(null);
  const [editPrompt, setEditPrompt] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  // Recrop modal state
  const [recropElement, setRecropElement] = useState<ExtractedElement | null>(null);
  const [isRecropping, setIsRecropping] = useState(false);

  // Use detected elements from project context (persisted across tab switches)
  const detected = project?.detectedElements || [];
  const totalElements = detected.length;

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
    setExtractedCount(0);
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
  ): Promise<ExtractedElement> => {
    try {
      // Crop region for non-background elements (tight, element-relative padding)
      let croppedImg: string | undefined;
      if (el.role !== 'background') {
        try {
          croppedImg = await cropImageToRegion(sourceImage, el.bbox, 15);
        } catch { /* fallback to full image */ }
      }

      // AI extraction with attempt number for temperature variation on retries
      const dataUrl = await extractElement(sourceImage, el, croppedImg, attempt);
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
  const runExtraction = useCallback(async () => {
    if (!project?.sourceImage || detected.length === 0) return;

    setProject(prev => prev ? { ...prev, isExtracting: true, extractedElements: [] } : null);
    setExtractedCount(0);
    setFailedIds(new Set());
    setExtractingIds(new Set());
    setError(null);

    try {
      await parallelBatch(
        detected,
        async (el, idx) => {
          setExtractingIds(prev => new Set(prev).add(idx));
          return await extractSingleElement(project.sourceImage, el);
        },
        (result, _item, idx) => {
          addExtractedElement(result);
          saveToAssets(result);
          setExtractedCount(prev => prev + 1);
          setExtractingIds(prev => {
            const next = new Set(prev);
            next.delete(idx);
            return next;
          });
        },
        2, // 2 concurrent AI calls (rate limit friendly)
        1500, // 1.5s delay between batches
        (_err, _item, idx) => {
          setFailedIds(prev => new Set(prev).add(idx));
          setExtractedCount(prev => prev + 1);
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
      // Toast with result summary
      const failedCount = failedIds.size;
      if (failedCount > 0) {
        toast(`Extracted ${detected.length - failedCount}/${detected.length} elements (${failedCount} failed)`, { type: 'error' });
      } else {
        toast(`Extracted ${detected.length} elements`, { type: 'success' });
      }
    }
  }, [project?.sourceImage, detected, setProject, addExtractedElement, extractSingleElement, saveToAssets, toast, failedIds]);

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

    setRetryingElementIds(prev => new Set(prev).add(elementId));
    try {
      const newExtracted = await extractSingleElement(project.sourceImage, detectedEl, 1);
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
      toast(`Re-extracted "${existing.label}"`, { type: 'success' });
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
  }, [project?.sourceImage, project?.extractedElements, setProject, extractSingleElement, saveToAssets]);

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

  // AI Edit element (inpaint with prompt) — preserves transparency after edit
  const handleEditElement = useCallback(async () => {
    if (!editingElement || !editPrompt.trim()) return;
    setIsEditing(true);
    try {
      const edited = await modifyImage(editingElement.dataUrl, editPrompt);
      if (edited) {
        // Re-apply white-to-alpha to restore transparency (AI edit outputs opaque images)
        const transparent = await whiteToAlpha(edited, 25);
        const trimmed = await autoTrimTransparent(transparent, 2);
        const finalUrl = trimmed.dataUrl;

        const img = new Image();
        img.onload = () => {
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
  }, [editingElement, editPrompt, setProject]);

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
      const newExtracted = await extractSingleElement(project.sourceImage, detectedEl, 1);
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
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-5xl mx-auto flex flex-col gap-6">

          {/* Source banner with detected overlays */}
          <div className="flex gap-6 items-start">
            <div className="relative flex-1 rounded-xl overflow-hidden border border-zinc-700 bg-zinc-900 self-start">
              <img src={project.sourceImage} alt="Source banner" className="w-full h-auto block" />
              {detected.map((el, i) => (
                <div
                  key={i}
                  className="absolute border-2 pointer-events-none transition-opacity"
                  style={{
                    left: `${el.bbox.x}%`, top: `${el.bbox.y}%`,
                    width: `${el.bbox.w}%`, height: `${el.bbox.h}%`,
                    borderColor: ROLE_COLORS[el.role],
                    opacity: extractingIds.has(i) ? 1 : 0.6,
                  }}
                >
                  <span
                    className="absolute -top-5 left-0 text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap"
                    style={{ backgroundColor: ROLE_COLORS[el.role], color: 'white' }}
                  >
                    {el.label}
                  </span>
                </div>
              ))}
              {isAnalyzing && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                  <div className="flex items-center gap-3 text-cyan-400">
                    <i className="fa-solid fa-spinner fa-spin text-lg" />
                    <span className="text-sm font-medium">Analyzing banner elements...</span>
                  </div>
                </div>
              )}
            </div>

            {/* Detected elements sidebar */}
            {detected.length > 0 && (
              <div className="w-64 shrink-0 flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-zinc-300 mb-1">
                  Detected Elements ({detected.length})
                </h3>
                <div className="flex flex-col gap-1.5 overflow-auto max-h-[400px] pr-1">
                  {detected.map((el, i) => {
                    const isCurrentlyExtracting = extractingIds.has(i);
                    const hasFailed = failedIds.has(i);
                    const isDone = extractedCount > i && !hasFailed && !isCurrentlyExtracting;
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
                    className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-700 rounded-lg transition-colors">
                    <i className="fa-solid fa-rotate mr-1" />Re-analyze
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Extraction progress */}
          {isExtracting && (
            <div className="px-4 py-3 bg-zinc-800/60 rounded-lg border border-zinc-700/50 flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <i className="fa-solid fa-wand-magic-sparkles fa-spin text-cyan-400" />
                <div className="flex-1">
                  <div className="flex justify-between text-xs text-zinc-400 mb-1">
                    <span>AI extracting elements with transparency...</span>
                    <span className="font-mono">{extractedCount} / {totalElements}</span>
                  </div>
                  <div className="h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                    <div className="h-full bg-cyan-500 rounded-full transition-all duration-500"
                      style={{ width: `${totalElements > 0 ? (extractedCount / totalElements) * 100 : 0}%` }} />
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
                            <button onClick={() => retrySingleElement(el.id)}
                              className="bg-white hover:bg-zinc-200 text-black px-3 py-1.5 rounded text-[10px] font-bold uppercase shadow-lg flex items-center gap-1 transition-all transform hover:scale-105">
                              <i className="fa-solid fa-sync-alt" /> Retry
                            </button>
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
                          <span className="text-xs font-bold text-zinc-300 truncate flex-1">{el.label}</span>
                        </div>
                        <div className="text-[9px] text-zinc-600 mt-0.5">
                          {el.nativeWidth} x {el.nativeHeight}
                          {el.detectedText && <span className="ml-2 text-zinc-500">"{el.detectedText}"</span>}
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
                    className="text-zinc-500 hover:text-white transition-colors">
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
                      className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-cyan-600"
                      autoFocus
                    />
                    <p className="text-[10px] text-zinc-600">Uses AI to modify the extracted element</p>
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
    </div>
  );
};
