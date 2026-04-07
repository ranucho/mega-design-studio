import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useBanner } from '@/contexts/BannerContext';
import { BannerLayer, BannerComposition } from '@/types';

interface BannerCanvasProps {
  composition: BannerComposition;
}

type HandleType = 'nw' | 'ne' | 'sw' | 'se' | 'move' | 'rotate';

const HANDLE_CURSORS: Record<string, string> = {
  nw: 'nwse-resize', ne: 'nesw-resize',
  sw: 'nesw-resize', se: 'nwse-resize',
  move: 'move', rotate: 'grab',
};

const MAX_UNDO = 50;

export const BannerCanvas: React.FC<BannerCanvasProps> = ({ composition }) => {
  const { updateComposition, updateLayer } = useBanner();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const animFrameRef = useRef(0);
  const [dragState, setDragState] = useState<{
    layerId: string; startX: number; startY: number;
    startLX: number; startLY: number;
    startScaleX: number; startScaleY: number;
    startW: number; startH: number;
    mode: HandleType;
    startRotation?: number;
    /** Start positions of all multi-selected layers (for group move) */
    multiStarts?: Array<{ id: string; x: number; y: number }>;
  } | null>(null);
  const [showSafeZone, setShowSafeZone] = useState(false);

  // Undo/redo
  const undoStack = useRef<BannerLayer[][]>([]);
  const redoStack = useRef<BannerLayer[][]>([]);

  const pushUndo = useCallback(() => {
    undoStack.current.push(JSON.parse(JSON.stringify(composition.layers)));
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
    redoStack.current = [];
  }, [composition.layers]);

  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return;
    redoStack.current.push(JSON.parse(JSON.stringify(composition.layers)));
    const prev = undoStack.current.pop()!;
    updateComposition(composition.id, { layers: prev });
  }, [composition.id, composition.layers, updateComposition]);

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    undoStack.current.push(JSON.parse(JSON.stringify(composition.layers)));
    const next = redoStack.current.pop()!;
    updateComposition(composition.id, { layers: next });
  }, [composition.id, composition.layers, updateComposition]);

  const { layers, selectedLayerId } = composition;
  const selectedLayer = useMemo(() => layers.find(l => l.id === selectedLayerId) ?? null, [layers, selectedLayerId]);

  // viewScale: fit composition into the canvas container
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewScale, setViewScale] = useState(0);

  // Compute scale immediately when composition size changes (no animation delay)
  const computeScale = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const padded = { w: width - 40, h: height - 40 };
    const s = Math.min(padded.w / composition.width, padded.h / composition.height, 1);
    setViewScale(s);
  }, [composition.width, composition.height]);

  // Recompute immediately on composition change
  useEffect(() => { computeScale(); }, [computeScale]);

  // Also track container resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => computeScale());
    ro.observe(el);
    return () => ro.disconnect();
  }, [computeScale]);

  // Preload images (re-load when src changes, e.g. after skin switch)
  useEffect(() => {
    for (const layer of layers) {
      if (layer.type === 'image' && layer.src) {
        const cached = imageCache.current.get(layer.id);
        if (!cached || cached.src !== layer.src) {
          const img = new Image();
          img.src = layer.src;
          imageCache.current.set(layer.id, img);
        }
      }
    }
  }, [layers]);

  // ---- Render loop (canvas only draws layers, NOT selection handles) ----
  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, composition.width, composition.height);
    ctx.fillStyle = composition.backgroundColor || '#000';
    ctx.fillRect(0, 0, composition.width, composition.height);

    for (const layer of layers) {
      if (!layer.visible) continue;
      ctx.save();
      ctx.globalAlpha = layer.opacity;
      const cx = layer.x + (layer.nativeWidth * layer.scaleX) / 2;
      const cy = layer.y + (layer.nativeHeight * layer.scaleY) / 2;
      ctx.translate(cx, cy);
      if (layer.rotation) ctx.rotate((layer.rotation * Math.PI) / 180);
      if (layer.flipX) ctx.scale(-1, 1);
      if (layer.flipY) ctx.scale(1, -1);
      ctx.translate(-cx, -cy);

      if (layer.type === 'text') {
        const fontSize = layer.fontSize || 24;
        ctx.font = `${layer.fontWeight || 700} ${fontSize}px ${layer.fontFamily || 'sans-serif'}`;
        ctx.textAlign = (layer.textAlign || 'left') as CanvasTextAlign;
        ctx.textBaseline = 'top';
        if (layer.textStroke) {
          ctx.strokeStyle = layer.textStroke;
          ctx.lineWidth = Math.max(1, fontSize / 12);
          ctx.strokeText(layer.text || '', layer.x, layer.y);
        }
        ctx.fillStyle = layer.fontColor || '#ffffff';
        ctx.fillText(layer.text || '', layer.x, layer.y);
      } else if (layer.type === 'image' && layer.src) {
        const img = imageCache.current.get(layer.id);
        if (img && img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, layer.x, layer.y, layer.nativeWidth * layer.scaleX, layer.nativeHeight * layer.scaleY);
        }
      }
      ctx.restore();
    }

    // Safe zone
    if (showSafeZone) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 200, 0, 0.5)';
      ctx.lineWidth = 1 / viewScale;
      ctx.setLineDash([4 / viewScale, 4 / viewScale]);
      const margin = Math.min(composition.width, composition.height) * 0.05;
      ctx.strokeRect(margin, margin, composition.width - margin * 2, composition.height - margin * 2);
      ctx.setLineDash([]);
      ctx.restore();
    }

  }, [layers, composition.width, composition.height, composition.backgroundColor, viewScale, showSafeZone]);

  // Render once whenever renderFrame identity changes (i.e. when its deps change).
  // No perpetual rAF loop — we only paint when inputs actually change.
  useEffect(() => {
    animFrameRef.current = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [renderFrame]);

  // ---- Mouse interactions ----
  const canvasToWorld = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { wx: 0, wy: 0 };
    const rect = canvas.getBoundingClientRect();
    return { wx: (clientX - rect.left) / viewScale, wy: (clientY - rect.top) / viewScale };
  }, [viewScale]);

  /** Return ALL layers under the point, topmost first */
  const hitTestAll = useCallback((wx: number, wy: number): BannerLayer[] => {
    const hits: BannerLayer[] = [];
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (!l.visible || l.locked) continue;
      const dw = l.nativeWidth * l.scaleX;
      const dh = l.nativeHeight * l.scaleY;
      if (wx >= l.x && wx <= l.x + dw && wy >= l.y && wy <= l.y + dh) hits.push(l);
    }
    return hits;
  }, [layers]);

  const hitTest = useCallback((wx: number, wy: number): BannerLayer | null => {
    return hitTestAll(wx, wy)[0] ?? null;
  }, [hitTestAll]);

  // Handle start from DOM overlay (handles) or canvas (move/select)
  const handleOverlayDown = useCallback((e: React.PointerEvent, mode: HandleType) => {
    if (!selectedLayer || selectedLayer.locked) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    pushUndo();

    const dw = selectedLayer.nativeWidth * selectedLayer.scaleX;
    const dh = selectedLayer.nativeHeight * selectedLayer.scaleY;

    setDragState({
      layerId: selectedLayer.id,
      startX: e.clientX,
      startY: e.clientY,
      startLX: selectedLayer.x,
      startLY: selectedLayer.y,
      startScaleX: selectedLayer.scaleX,
      startScaleY: selectedLayer.scaleY,
      startW: dw,
      startH: dh,
      mode,
      startRotation: selectedLayer.rotation,
    });
  }, [selectedLayer, pushUndo]);

  const handleCanvasDown = useCallback((e: React.MouseEvent) => {
    const { wx, wy } = canvasToWorld(e.clientX, e.clientY);
    const allHits = hitTestAll(wx, wy);

    if (allHits.length === 0) {
      updateComposition(composition.id, { selectedLayerId: null, selectedLayerIds: [] });
      return;
    }

    const currentIds = composition.selectedLayerIds ?? [];

    if (e.shiftKey) {
      // Shift+click: cycle through overlapping layers to find the next un-selected one.
      // If all overlapping are already selected, deselect the topmost.
      const unselected = allHits.find(h => !currentIds.includes(h.id));
      if (unselected) {
        // Add unselected layer to multi-selection
        updateComposition(composition.id, {
          selectedLayerId: unselected.id,
          selectedLayerIds: [...currentIds, unselected.id],
        });
      } else {
        // All overlapping are selected — deselect the topmost one
        const topHit = allHits[0];
        const newIds = currentIds.filter(id => id !== topHit.id);
        updateComposition(composition.id, {
          selectedLayerId: newIds.length > 0 ? newIds[newIds.length - 1] : null,
          selectedLayerIds: newIds,
        });
      }
      return; // Don't start a drag on shift+click
    }

    // Normal click — select topmost hit
    const hit = allHits[0];
    const isAlreadyMultiSelected = currentIds.includes(hit.id) && currentIds.length > 1;

    if (!isAlreadyMultiSelected) {
      updateComposition(composition.id, { selectedLayerId: hit.id, selectedLayerIds: [hit.id] });
    }
    pushUndo();

    const dw = hit.nativeWidth * hit.scaleX;
    const dh = hit.nativeHeight * hit.scaleY;

    // Capture start positions of all selected layers for group move
    const idsToMove = isAlreadyMultiSelected ? currentIds : [hit.id];
    const multiStarts = idsToMove
      .map(id => { const l = layers.find(la => la.id === id); return l ? { id: l.id, x: l.x, y: l.y } : null; })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    setDragState({
      layerId: hit.id,
      startX: e.clientX, startY: e.clientY,
      startLX: hit.x, startLY: hit.y,
      startScaleX: hit.scaleX, startScaleY: hit.scaleY,
      startW: dw, startH: dh,
      mode: 'move',
      multiStarts,
    });
  }, [canvasToWorld, hitTestAll, pushUndo, updateComposition, composition.id, composition.selectedLayerIds, layers]);

  // Global pointer move/up for dragging
  useEffect(() => {
    if (!dragState) return;

    const onMove = (e: PointerEvent) => {
      const dx = (e.clientX - dragState.startX) / viewScale;
      const dy = (e.clientY - dragState.startY) / viewScale;
      const layer = layers.find(l => l.id === dragState.layerId);
      if (!layer) return;

      if (dragState.mode === 'move') {
        // Move all multi-selected layers together
        if (dragState.multiStarts && dragState.multiStarts.length > 1) {
          for (const s of dragState.multiStarts) {
            updateLayer(composition.id, s.id, { x: s.x + dx, y: s.y + dy });
          }
        } else {
          updateLayer(composition.id, dragState.layerId, {
            x: dragState.startLX + dx,
            y: dragState.startLY + dy,
          });
        }
      } else if (dragState.mode === 'rotate') {
        const dw = layer.nativeWidth * layer.scaleX;
        const dh = layer.nativeHeight * layer.scaleY;
        const cx = layer.x + dw / 2;
        const cy = layer.y + dh / 2;
        const { wx, wy } = canvasToWorld(e.clientX, e.clientY);
        const angle = Math.atan2(wy - cy, wx - cx) * (180 / Math.PI) + 90;
        updateLayer(composition.id, dragState.layerId, { rotation: Math.round(angle) });
      } else {
        // Corner resize — all 4 corners
        const handle = dragState.mode;
        const aspectRatio = dragState.startW / dragState.startH;

        let newW = dragState.startW;
        let newH = dragState.startH;
        let newX = dragState.startLX;
        let newY = dragState.startLY;

        if (handle === 'se') {
          newW = Math.max(10, dragState.startW + dx);
          newH = newW / aspectRatio;
        } else if (handle === 'sw') {
          newW = Math.max(10, dragState.startW - dx);
          newH = newW / aspectRatio;
          newX = dragState.startLX + (dragState.startW - newW);
        } else if (handle === 'ne') {
          newW = Math.max(10, dragState.startW + dx);
          newH = newW / aspectRatio;
          newY = dragState.startLY + (dragState.startH - newH);
        } else if (handle === 'nw') {
          newW = Math.max(10, dragState.startW - dx);
          newH = newW / aspectRatio;
          newX = dragState.startLX + (dragState.startW - newW);
          newY = dragState.startLY + (dragState.startH - newH);
        }

        const newScale = newW / layer.nativeWidth;
        updateLayer(composition.id, dragState.layerId, {
          x: newX, y: newY,
          scaleX: Math.max(0.02, newScale),
          scaleY: Math.max(0.02, newScale),
        });
      }
    };

    const onUp = () => setDragState(null);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragState, viewScale, layers, composition.id, updateLayer, canvasToWorld]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }

      const multiIds = composition.selectedLayerIds ?? [];
      const multiLayers = multiIds.length > 0
        ? layers.filter(l => multiIds.includes(l.id) && !l.locked)
        : selectedLayer && !selectedLayer.locked ? [selectedLayer] : [];

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (multiLayers.length > 0) {
          pushUndo();
          const idsToDelete = new Set(multiLayers.map(l => l.id));
          updateComposition(composition.id, {
            layers: layers.filter(l => !idsToDelete.has(l.id)),
            selectedLayerId: null,
            selectedLayerIds: [],
          });
        }
        return;
      }

      if (multiLayers.length > 0) {
        const step = e.shiftKey ? 10 : 1;
        let dx = 0, dy = 0;
        if (e.key === 'ArrowLeft') dx = -step;
        if (e.key === 'ArrowRight') dx = step;
        if (e.key === 'ArrowUp') dy = -step;
        if (e.key === 'ArrowDown') dy = step;
        if (dx || dy) {
          e.preventDefault();
          pushUndo();
          for (const l of multiLayers) {
            updateLayer(composition.id, l.id, { x: l.x + dx, y: l.y + dy });
          }
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedLayer, layers, composition.id, composition.selectedLayerIds, undo, redo, pushUndo, updateComposition, updateLayer]);

  // ---- Compute selection overlay position ----
  const selectionOverlay = useMemo(() => {
    if (!selectedLayer || !selectedLayer.visible) return null;
    const sl = selectedLayer;
    const dw = sl.nativeWidth * sl.scaleX;
    const dh = sl.nativeHeight * sl.scaleY;
    return {
      left: sl.x * viewScale,
      top: sl.y * viewScale,
      width: dw * viewScale,
      height: dh * viewScale,
      rotation: sl.rotation || 0,
    };
  }, [selectedLayer, viewScale]);

  // Secondary selection highlights for multi-selected layers (no handles, just outlines)
  const secondaryOverlays = useMemo(() => {
    const ids = composition.selectedLayerIds ?? [];
    if (ids.length <= 1) return [];
    return ids
      .filter(id => id !== selectedLayerId) // primary already has full handles
      .map(id => {
        const l = layers.find(la => la.id === id);
        if (!l || !l.visible) return null;
        const dw = l.nativeWidth * l.scaleX;
        const dh = l.nativeHeight * l.scaleY;
        return {
          id: l.id,
          left: l.x * viewScale,
          top: l.y * viewScale,
          width: dw * viewScale,
          height: dh * viewScale,
          rotation: l.rotation || 0,
        };
      })
      .filter((o): o is NonNullable<typeof o> => o !== null);
  }, [composition.selectedLayerIds, selectedLayerId, layers, viewScale]);

  const HANDLE_SIZE = 12;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-zinc-900/60 border-b border-zinc-800">
        <button onClick={undo} title="Undo (Ctrl+Z)" className="p-1.5 text-zinc-400 hover:text-white rounded transition-colors">
          <i className="fa-solid fa-rotate-left text-xs" />
        </button>
        <button onClick={redo} title="Redo (Ctrl+Shift+Z)" className="p-1.5 text-zinc-400 hover:text-white rounded transition-colors">
          <i className="fa-solid fa-rotate-right text-xs" />
        </button>
        <div className="w-px h-4 bg-zinc-700 mx-1" />

        {selectedLayer && !selectedLayer.locked && (
          <>
            {[
              { icon: 'fa-align-left', title: 'Align Left', fn: () => { pushUndo(); updateLayer(composition.id, selectedLayer.id, { x: 0 }); } },
              { icon: 'fa-arrows-left-right', title: 'Center H', fn: () => { pushUndo(); updateLayer(composition.id, selectedLayer.id, { x: (composition.width - selectedLayer.nativeWidth * selectedLayer.scaleX) / 2 }); } },
              { icon: 'fa-align-right', title: 'Align Right', fn: () => { pushUndo(); updateLayer(composition.id, selectedLayer.id, { x: composition.width - selectedLayer.nativeWidth * selectedLayer.scaleX }); } },
              { icon: 'fa-arrows-up-down', title: 'Center V', fn: () => { pushUndo(); updateLayer(composition.id, selectedLayer.id, { y: (composition.height - selectedLayer.nativeHeight * selectedLayer.scaleY) / 2 }); } },
            ].map(btn => (
              <button key={btn.icon} onClick={btn.fn} title={btn.title} className="p-1.5 text-zinc-400 hover:text-white rounded transition-colors">
                <i className={`fa-solid ${btn.icon} text-xs`} />
              </button>
            ))}
            <div className="w-px h-4 bg-zinc-700 mx-1" />
            <button onClick={() => { pushUndo(); updateLayer(composition.id, selectedLayer.id, { flipX: !selectedLayer.flipX }); }} title="Flip H" className="p-1.5 text-zinc-400 hover:text-white rounded transition-colors">
              <i className="fa-solid fa-left-right text-xs" />
            </button>
            <button onClick={() => { pushUndo(); updateLayer(composition.id, selectedLayer.id, { flipY: !selectedLayer.flipY }); }} title="Flip V" className="p-1.5 text-zinc-400 hover:text-white rounded transition-colors">
              <i className="fa-solid fa-up-down text-xs" />
            </button>
          </>
        )}

        <div className="flex-1" />
        <button
          onClick={() => setShowSafeZone(v => !v)}
          className={`px-2 py-1 text-[10px] rounded border transition-colors ${showSafeZone ? 'border-yellow-600/40 text-yellow-400 bg-yellow-600/10' : 'border-zinc-700 text-zinc-400 hover:text-zinc-300'}`}
        >
          Safe Zone
        </button>
        <span className="text-[10px] text-zinc-400">{composition.width}x{composition.height}</span>
      </div>

      {/* Canvas area — overflow-hidden keeps flex-1 constrained to parent size (scale-to-fit) */}
      <div ref={containerRef} className="flex-1 flex items-center justify-center overflow-hidden bg-zinc-950 p-6 relative">
        <div className="relative" style={{ width: composition.width * viewScale, height: composition.height * viewScale, opacity: viewScale > 0 ? 1 : 0 }}>
          {/* The actual canvas */}
          <canvas
            ref={canvasRef}
            width={composition.width}
            height={composition.height}
            onMouseDown={handleCanvasDown}
            className="shadow-2xl cursor-crosshair block"
            style={{ width: composition.width * viewScale, height: composition.height * viewScale }}
          />

          {/* Secondary selection outlines for multi-selected layers */}
          {secondaryOverlays.map(ov => (
            <div
              key={ov.id}
              className="absolute pointer-events-none"
              style={{
                left: ov.left, top: ov.top, width: ov.width, height: ov.height,
                transform: ov.rotation ? `rotate(${ov.rotation}deg)` : undefined,
                transformOrigin: 'center center', zIndex: 9,
              }}
            >
              <div className="absolute inset-0 border-2 border-cyan-400/50 border-dashed pointer-events-none" style={{ margin: -1 }} />
            </div>
          ))}

          {/* DOM selection overlay — visible OUTSIDE canvas bounds */}
          {selectionOverlay && selectedLayer && !selectedLayer.locked && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: selectionOverlay.left,
                top: selectionOverlay.top,
                width: selectionOverlay.width,
                height: selectionOverlay.height,
                transform: selectionOverlay.rotation ? `rotate(${selectionOverlay.rotation}deg)` : undefined,
                transformOrigin: 'center center',
                zIndex: 10,
              }}
            >
              {/* Selection border */}
              <div className="absolute inset-0 border-2 border-cyan-500 border-dashed pointer-events-none" style={{ margin: -1 }} />

              {/* Move area (entire element) */}
              <div
                className="absolute inset-0 cursor-move pointer-events-auto"
                onPointerDown={e => handleOverlayDown(e, 'move')}
              />

              {/* 4 corner resize handles */}
              {(['nw', 'ne', 'sw', 'se'] as HandleType[]).map(h => {
                const style: React.CSSProperties = { width: HANDLE_SIZE, height: HANDLE_SIZE, position: 'absolute' };
                if (h.includes('n')) style.top = -HANDLE_SIZE / 2;
                if (h.includes('s')) style.bottom = -HANDLE_SIZE / 2;
                if (h.includes('w')) style.left = -HANDLE_SIZE / 2;
                if (h.includes('e')) style.right = -HANDLE_SIZE / 2;
                return (
                  <div
                    key={h}
                    className="bg-cyan-500 border-2 border-white shadow-lg pointer-events-auto"
                    style={{ ...style, cursor: HANDLE_CURSORS[h] }}
                    onPointerDown={e => handleOverlayDown(e, h)}
                  />
                );
              })}

              {/* Rotation handle — above center */}
              <div
                className="absolute pointer-events-auto flex flex-col items-center"
                style={{ left: '50%', top: -36, transform: 'translateX(-50%)' }}
              >
                <div
                  className="w-5 h-5 rounded-full bg-cyan-500 border-2 border-white shadow-lg cursor-grab flex items-center justify-center"
                  onPointerDown={e => handleOverlayDown(e, 'rotate')}
                >
                  <i className="fa-solid fa-rotate text-[7px] text-white" />
                </div>
                <div className="w-px h-3 bg-cyan-500" />
              </div>

              {/* Size label */}
              <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[9px] text-cyan-400 bg-zinc-900/90 px-1.5 py-0.5 rounded whitespace-nowrap">
                {Math.round(selectedLayer.nativeWidth * selectedLayer.scaleX)}×{Math.round(selectedLayer.nativeHeight * selectedLayer.scaleY)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
