import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useBanner } from '@/contexts/BannerContext';
import { BannerLayer, BannerComposition } from '@/types';

interface BannerCanvasProps {
  composition: BannerComposition;
}

// ---- Undo/Redo ----
const MAX_UNDO = 50;

export const BannerCanvas: React.FC<BannerCanvasProps> = ({ composition }) => {
  const { updateComposition, updateLayer } = useBanner();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const animFrameRef = useRef(0);
  const [dragState, setDragState] = useState<{
    layerId: string; startX: number; startY: number;
    startLX: number; startLY: number; mode: 'move' | 'scale' | 'rotate';
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
      const s = Math.min(width / composition.width, height / composition.height, 1);
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

  // ---- Render loop ----
  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear
    ctx.clearRect(0, 0, composition.width, composition.height);
    ctx.fillStyle = composition.backgroundColor || '#000';
    ctx.fillRect(0, 0, composition.width, composition.height);

    // Draw layers bottom to top
    for (const layer of layers) {
      if (!layer.visible) continue;

      ctx.save();
      ctx.globalAlpha = layer.opacity;

      const cx = layer.x + (layer.nativeWidth * layer.scaleX) / 2;
      const cy = layer.y + (layer.nativeHeight * layer.scaleY) / 2;

      // Rotation and flip
      ctx.translate(cx, cy);
      if (layer.rotation) ctx.rotate((layer.rotation * Math.PI) / 180);
      if (layer.flipX) ctx.scale(-1, 1);
      if (layer.flipY) ctx.scale(1, -1);
      ctx.translate(-cx, -cy);

      if (layer.type === 'text') {
        // Text rendering
        const fontSize = layer.fontSize || 24;
        const fontWeight = layer.fontWeight || 700;
        const fontFamily = layer.fontFamily || 'sans-serif';
        ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
        ctx.textAlign = (layer.textAlign || 'left') as CanvasTextAlign;
        ctx.textBaseline = 'top';

        // Text shadow
        if (layer.textShadow) {
          ctx.shadowColor = 'rgba(0,0,0,0.5)';
          ctx.shadowBlur = 4;
          ctx.shadowOffsetX = 2;
          ctx.shadowOffsetY = 2;
        }

        // Text stroke
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
          const dw = layer.nativeWidth * layer.scaleX;
          const dh = layer.nativeHeight * layer.scaleY;
          ctx.drawImage(img, layer.x, layer.y, dw, dh);
        }
      }

      ctx.restore();
    }

    // Selection handles
    if (selectedLayer && selectedLayer.visible) {
      const sl = selectedLayer;
      const dw = sl.nativeWidth * sl.scaleX;
      const dh = sl.nativeHeight * sl.scaleY;

      ctx.save();
      const cx = sl.x + dw / 2;
      const cy = sl.y + dh / 2;
      ctx.translate(cx, cy);
      if (sl.rotation) ctx.rotate((sl.rotation * Math.PI) / 180);
      ctx.translate(-cx, -cy);

      // Bounding box
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = 2 / viewScale;
      ctx.setLineDash([6 / viewScale, 4 / viewScale]);
      ctx.strokeRect(sl.x, sl.y, dw, dh);
      ctx.setLineDash([]);

      // Corner handles
      const hs = 8 / viewScale;
      ctx.fillStyle = '#06b6d4';
      const corners = [
        [sl.x, sl.y], [sl.x + dw, sl.y],
        [sl.x, sl.y + dh], [sl.x + dw, sl.y + dh],
      ];
      for (const [hx, hy] of corners) {
        ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
      }

      // Rotation handle
      const rotY = sl.y - 30 / viewScale;
      ctx.beginPath();
      ctx.arc(sl.x + dw / 2, rotY, 6 / viewScale, 0, Math.PI * 2);
      ctx.fillStyle = '#06b6d4';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(sl.x + dw / 2, rotY + 6 / viewScale);
      ctx.lineTo(sl.x + dw / 2, sl.y);
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = 1.5 / viewScale;
      ctx.stroke();

      ctx.restore();
    }

    // Safe zone overlay
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

    animFrameRef.current = requestAnimationFrame(renderFrame);
  }, [layers, selectedLayer, composition.width, composition.height, composition.backgroundColor, viewScale, showSafeZone]);

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
      if (wx >= l.x && wx <= l.x + dw && wy >= l.y && wy <= l.y + dh) {
        return l;
      }
    }
    return null;
  }, [layers]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const { wx, wy } = canvasToWorld(e.clientX, e.clientY);

    // Check scale handle (bottom-right corner of selected)
    if (selectedLayer && !selectedLayer.locked) {
      const dw = selectedLayer.nativeWidth * selectedLayer.scaleX;
      const dh = selectedLayer.nativeHeight * selectedLayer.scaleY;
      const hs = 14 / viewScale;

      // Bottom-right scale handle
      if (Math.abs(wx - (selectedLayer.x + dw)) < hs && Math.abs(wy - (selectedLayer.y + dh)) < hs) {
        pushUndo();
        setDragState({ layerId: selectedLayer.id, startX: e.clientX, startY: e.clientY, startLX: selectedLayer.scaleX, startLY: selectedLayer.scaleY, mode: 'scale' });
        return;
      }

      // Rotation handle
      const rotY = selectedLayer.y - 30 / viewScale;
      if (Math.abs(wx - (selectedLayer.x + dw / 2)) < 12 / viewScale && Math.abs(wy - rotY) < 12 / viewScale) {
        pushUndo();
        setDragState({ layerId: selectedLayer.id, startX: e.clientX, startY: e.clientY, startLX: selectedLayer.x, startLY: selectedLayer.y, mode: 'rotate', startRotation: selectedLayer.rotation });
        return;
      }
    }

    const hit = hitTest(wx, wy);
    if (hit) {
      updateComposition(composition.id, { selectedLayerId: hit.id });
      pushUndo();
      setDragState({ layerId: hit.id, startX: e.clientX, startY: e.clientY, startLX: hit.x, startLY: hit.y, mode: 'move' });
    } else {
      updateComposition(composition.id, { selectedLayerId: null });
    }
  }, [canvasToWorld, hitTest, selectedLayer, viewScale, pushUndo, updateComposition, composition.id]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragState) return;
      const dx = (e.clientX - dragState.startX) / viewScale;
      const dy = (e.clientY - dragState.startY) / viewScale;

      if (dragState.mode === 'move') {
        updateLayer(composition.id, dragState.layerId, {
          x: dragState.startLX + dx,
          y: dragState.startLY + dy,
        });
      } else if (dragState.mode === 'scale') {
        const layer = layers.find(l => l.id === dragState.layerId);
        if (!layer) return;
        const startW = layer.nativeWidth * dragState.startLX;
        const newW = startW + dx;
        const ratio = Math.max(0.05, newW / layer.nativeWidth);
        updateLayer(composition.id, dragState.layerId, { scaleX: ratio, scaleY: ratio });
      } else if (dragState.mode === 'rotate') {
        const layer = layers.find(l => l.id === dragState.layerId);
        if (!layer) return;
        const dw = layer.nativeWidth * layer.scaleX;
        const dh = layer.nativeHeight * layer.scaleY;
        const cx = layer.x + dw / 2;
        const cy = layer.y + dh / 2;
        const { wx, wy } = canvasToWorld(e.clientX, e.clientY);
        const angle = Math.atan2(wy - cy, wx - cx) * (180 / Math.PI) + 90;
        updateLayer(composition.id, dragState.layerId, { rotation: Math.round(angle) });
      }
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
  }, [dragState, viewScale, layers, composition.id, updateLayer, canvasToWorld]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
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

      // Arrow nudge
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

        {/* Alignment buttons */}
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

      {/* Canvas area */}
      <div ref={containerRef} className="flex-1 flex items-center justify-center overflow-hidden bg-zinc-950 p-4">
        <canvas
          ref={canvasRef}
          width={composition.width}
          height={composition.height}
          onMouseDown={handleMouseDown}
          className="shadow-2xl cursor-crosshair"
          style={{
            width: composition.width * viewScale,
            height: composition.height * viewScale,
          }}
        />
      </div>
    </div>
  );
};
