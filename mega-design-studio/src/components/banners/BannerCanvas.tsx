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
  const [viewScale, setViewScale] = useState(1);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      // Leave some padding so handles outside canvas are visible
      const padded = { w: width - 40, h: height - 40 };
      const s = Math.min(padded.w / composition.width, padded.h / composition.height, 1);
      setViewScale(s);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [composition.width, composition.height]);

  // Preload images
  useEffect(() => {
    for (const layer of layers) {
      if (layer.type === 'image' && layer.src && !imageCache.current.has(layer.id)) {
        const img = new Image();
        img.src = layer.src;
        imageCache.current.set(layer.id, img);
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

  const hitTest = useCallback((wx: number, wy: number): BannerLayer | null => {
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (!l.visible || l.locked) continue;
      const dw = l.nativeWidth * l.scaleX;
      const dh = l.nativeHeight * l.scaleY;
      if (wx >= l.x && wx <= l.x + dw && wy >= l.y && wy <= l.y + dh) return l;
    }
    return null;
  }, [layers]);

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
    const hit = hitTest(wx, wy);
    if (hit) {
      updateComposition(composition.id, { selectedLayerId: hit.id });
      pushUndo();
      const dw = hit.nativeWidth * hit.scaleX;
      const dh = hit.nativeHeight * hit.scaleY;
      setDragState({
        layerId: hit.id,
        startX: e.clientX, startY: e.clientY,
        startLX: hit.x, startLY: hit.y,
        startScaleX: hit.scaleX, startScaleY: hit.scaleY,
        startW: dw, startH: dh,
        mode: 'move',
      });
    } else {
      updateComposition(composition.id, { selectedLayerId: null });
    }
  }, [canvasToWorld, hitTest, pushUndo, updateComposition, composition.id]);

  // Global pointer move/up for dragging
  useEffect(() => {
    if (!dragState) return;

    const onMove = (e: PointerEvent) => {
      const dx = (e.clientX - dragState.startX) / viewScale;
      const dy = (e.clientY - dragState.startY) / viewScale;
      const layer = layers.find(l => l.id === dragState.layerId);
      if (!layer) return;

      if (dragState.mode === 'move') {
        updateLayer(composition.id, dragState.layerId, {
          x: dragState.startLX + dx,
          y: dragState.startLY + dy,
        });
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

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedLayer && !selectedLayer.locked) {
          pushUndo();
          updateComposition(composition.id, {
            layers: layers.filter(l => l.id !== selectedLayer.id),
            selectedLayerId: null,
          });
        }
        return;
      }

      if (selectedLayer && !selectedLayer.locked) {
        const step = e.shiftKey ? 10 : 1;
        const updates: Partial<BannerLayer> = {};
        if (e.key === 'ArrowLeft') updates.x = selectedLayer.x - step;
        if (e.key === 'ArrowRight') updates.x = selectedLayer.x + step;
        if (e.key === 'ArrowUp') updates.y = selectedLayer.y - step;
        if (e.key === 'ArrowDown') updates.y = selectedLayer.y + step;
        if (Object.keys(updates).length) {
          e.preventDefault();
          pushUndo();
          updateLayer(composition.id, selectedLayer.id, updates);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedLayer, layers, composition.id, undo, redo, pushUndo, updateComposition, updateLayer]);

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

  const HANDLE_SIZE = 12;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-zinc-900/60 border-b border-zinc-800">
        <button onClick={undo} title="Undo (Ctrl+Z)" className="p-1.5 text-zinc-500 hover:text-white rounded transition-colors">
          <i className="fa-solid fa-rotate-left text-xs" />
        </button>
        <button onClick={redo} title="Redo (Ctrl+Shift+Z)" className="p-1.5 text-zinc-500 hover:text-white rounded transition-colors">
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
              <button key={btn.icon} onClick={btn.fn} title={btn.title} className="p-1.5 text-zinc-500 hover:text-white rounded transition-colors">
                <i className={`fa-solid ${btn.icon} text-xs`} />
              </button>
            ))}
            <div className="w-px h-4 bg-zinc-700 mx-1" />
            <button onClick={() => { pushUndo(); updateLayer(composition.id, selectedLayer.id, { flipX: !selectedLayer.flipX }); }} title="Flip H" className="p-1.5 text-zinc-500 hover:text-white rounded transition-colors">
              <i className="fa-solid fa-left-right text-xs" />
            </button>
            <button onClick={() => { pushUndo(); updateLayer(composition.id, selectedLayer.id, { flipY: !selectedLayer.flipY }); }} title="Flip V" className="p-1.5 text-zinc-500 hover:text-white rounded transition-colors">
              <i className="fa-solid fa-up-down text-xs" />
            </button>
          </>
        )}

        <div className="flex-1" />
        <button
          onClick={() => setShowSafeZone(v => !v)}
          className={`px-2 py-1 text-[10px] rounded border transition-colors ${showSafeZone ? 'border-yellow-600/40 text-yellow-400 bg-yellow-600/10' : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'}`}
        >
          Safe Zone
        </button>
        <span className="text-[10px] text-zinc-600">{composition.width}x{composition.height}</span>
      </div>

      {/* Canvas area — relative container so DOM selection overlay can extend outside */}
      <div ref={containerRef} className="flex-1 flex items-center justify-center overflow-visible bg-zinc-950 p-6 relative">
        <div className="relative" style={{ width: composition.width * viewScale, height: composition.height * viewScale }}>
          {/* The actual canvas */}
          <canvas
            ref={canvasRef}
            width={composition.width}
            height={composition.height}
            onMouseDown={handleCanvasDown}
            className="shadow-2xl cursor-crosshair block"
            style={{ width: composition.width * viewScale, height: composition.height * viewScale }}
          />

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
