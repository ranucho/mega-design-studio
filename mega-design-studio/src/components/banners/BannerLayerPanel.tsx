import React, { useCallback, useState } from 'react';
import { useBanner } from '@/contexts/BannerContext';
import { BannerComposition, BannerLayer } from '@/types';

const ROLE_COLORS: Record<BannerLayer['role'], string> = {
  background: '#92400e',
  character: '#1d4ed8',
  text: '#15803d',
  cta: '#ea580c',
  logo: '#7c3aed',
  decoration: '#ca8a04',
  other: '#64748b',
};

interface BannerLayerPanelProps {
  composition: BannerComposition;
}

export const BannerLayerPanel: React.FC<BannerLayerPanelProps> = ({ composition }) => {
  const { updateComposition, updateLayer } = useBanner();
  const { layers, selectedLayerId, selectedLayerIds = [] } = composition;
  const [expandedOpacity, setExpandedOpacity] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const selectLayer = useCallback((id: string, shiftKey = false) => {
    if (shiftKey) {
      // Multi-select: toggle this layer in the selection set
      const currentIds = new Set(selectedLayerIds);
      if (currentIds.has(id)) {
        currentIds.delete(id);
        // If we removed the primary, pick another or null
        const newPrimary = currentIds.size > 0 ? [...currentIds][currentIds.size - 1] : null;
        updateComposition(composition.id, {
          selectedLayerId: selectedLayerId === id ? newPrimary : selectedLayerId,
          selectedLayerIds: [...currentIds],
        });
      } else {
        currentIds.add(id);
        updateComposition(composition.id, {
          selectedLayerId: id,
          selectedLayerIds: [...currentIds],
        });
      }
    } else {
      // Single-select: clear multi-selection
      if (selectedLayerId === id && selectedLayerIds.length <= 1) {
        updateComposition(composition.id, { selectedLayerId: null, selectedLayerIds: [] });
      } else {
        updateComposition(composition.id, { selectedLayerId: id, selectedLayerIds: [id] });
      }
    }
  }, [composition.id, selectedLayerId, selectedLayerIds, updateComposition]);

  const deleteLayer = useCallback((id: string) => {
    updateComposition(composition.id, {
      layers: layers.filter(l => l.id !== id),
      selectedLayerId: selectedLayerId === id ? null : selectedLayerId,
    });
  }, [layers, composition.id, selectedLayerId, updateComposition]);

  const duplicateLayer = useCallback((id: string) => {
    const layer = layers.find(l => l.id === id);
    if (!layer) return;
    const newLayer = {
      ...layer,
      id: `${layer.id}_dup_${Date.now()}`,
      name: `${layer.name} (copy)`,
      x: layer.x + 10,
      y: layer.y + 10,
    };
    const idx = layers.findIndex(l => l.id === id);
    const newLayers = [...layers];
    newLayers.splice(idx + 1, 0, newLayer);
    updateComposition(composition.id, { layers: newLayers, selectedLayerId: newLayer.id });
  }, [layers, composition.id, updateComposition]);

  // Reversed: top of list = top layer (last in array).
  // Dragging is done in this display order.
  const displayLayers = [...layers].reverse();

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', id); } catch {/* noop */}
  };

  const handleDragOver = (e: React.DragEvent, overId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverId !== overId) setDragOverId(overId);
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDragOverId(null);
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = draggingId;
    setDraggingId(null);
    setDragOverId(null);
    if (!sourceId || sourceId === targetId) return;

    // Work in displayLayers (top=top). Move sourceId before targetId in display order.
    const displayOrder = displayLayers.map(l => l.id);
    const srcIdx = displayOrder.indexOf(sourceId);
    const tgtIdx = displayOrder.indexOf(targetId);
    if (srcIdx === -1 || tgtIdx === -1) return;
    displayOrder.splice(srcIdx, 1);
    const insertIdx = displayOrder.indexOf(targetId);
    displayOrder.splice(insertIdx, 0, sourceId);

    // Convert back to stored order (reverse of display).
    const newStoredOrder = [...displayOrder].reverse();
    const layerMap = new Map(layers.map(l => [l.id, l]));
    const newLayers = newStoredOrder
      .map(id => layerMap.get(id))
      .filter((l): l is BannerLayer => !!l);
    updateComposition(composition.id, { layers: newLayers });
  };

  // --- Alignment helpers ---
  const selectedLayers = layers.filter(l => selectedLayerIds.includes(l.id));
  const hasSelection = selectedLayers.length > 0;
  const isMulti = selectedLayers.length > 1;

  type AlignAxis = 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom';
  const [alignMode, setAlignMode] = useState<'canvas' | 'selection'>('canvas');

  const alignLayers = useCallback((axis: AlignAxis, toCanvas: boolean) => {
    if (selectedLayers.length === 0) return;
    const cw = composition.width;
    const ch = composition.height;

    // Compute bounding box of selection (for align-to-each-other)
    const getBounds = (l: typeof layers[0]) => ({
      left: l.x,
      top: l.y,
      right: l.x + l.nativeWidth * l.scaleX,
      bottom: l.y + l.nativeHeight * l.scaleY,
      w: l.nativeWidth * l.scaleX,
      h: l.nativeHeight * l.scaleY,
    });

    let refLeft = 0, refTop = 0, refRight = cw, refBottom = ch;
    if (!toCanvas && isMulti) {
      const allBounds = selectedLayers.map(getBounds);
      refLeft = Math.min(...allBounds.map(b => b.left));
      refTop = Math.min(...allBounds.map(b => b.top));
      refRight = Math.max(...allBounds.map(b => b.right));
      refBottom = Math.max(...allBounds.map(b => b.bottom));
    }
    const refCx = (refLeft + refRight) / 2;
    const refCy = (refTop + refBottom) / 2;

    for (const layer of selectedLayers) {
      const b = getBounds(layer);
      let newX = layer.x;
      let newY = layer.y;

      switch (axis) {
        case 'left':    newX = refLeft; break;
        case 'centerH': newX = refCx - b.w / 2; break;
        case 'right':   newX = refRight - b.w; break;
        case 'top':     newY = refTop; break;
        case 'centerV': newY = refCy - b.h / 2; break;
        case 'bottom':  newY = refBottom - b.h; break;
      }
      updateLayer(composition.id, layer.id, {
        x: Math.round(newX),
        y: Math.round(newY),
      });
    }
  }, [selectedLayers, composition, isMulti, updateLayer]);

  return (
    <div className="flex flex-col h-full bg-zinc-900/60">
      <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Layers</h3>
        <span className="text-[9px] text-zinc-400">{layers.length} — drag to reorder</span>
      </div>

      {/* Alignment toolbar — shows when 1+ layers selected */}
      {hasSelection && (
        <div className="px-2 py-2 border-b border-zinc-800 bg-zinc-800/40">
          <div className="flex items-center justify-between mb-2">
            {isMulti ? (
              <select
                value={alignMode}
                onChange={e => setAlignMode(e.target.value as 'canvas' | 'selection')}
                className="bg-zinc-700 border border-zinc-600 text-zinc-200 text-[11px] font-medium rounded px-2 py-1 outline-none focus:border-cyan-500 cursor-pointer"
              >
                <option value="canvas">Align to Canvas</option>
                <option value="selection">Align to Selection</option>
              </select>
            ) : (
              <span className="text-[11px] text-zinc-300 font-medium">Align to Canvas</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* Illustrator-style alignment icons using SVG */}
            {([
              { axis: 'left' as AlignAxis, title: 'Align Left', svg: <svg width="16" height="16" viewBox="0 0 16 16"><rect x="1" y="1" width="1.5" height="14" fill="currentColor" rx="0.5"/><rect x="4" y="3" width="10" height="4" fill="currentColor" rx="0.8"/><rect x="4" y="9" width="6" height="4" fill="currentColor" rx="0.8"/></svg> },
              { axis: 'centerH' as AlignAxis, title: 'Align Center Horizontal', svg: <svg width="16" height="16" viewBox="0 0 16 16"><rect x="7.25" y="1" width="1.5" height="14" fill="currentColor" rx="0.5"/><rect x="2" y="3" width="12" height="4" fill="currentColor" rx="0.8" opacity="0.7"/><rect x="4" y="9" width="8" height="4" fill="currentColor" rx="0.8" opacity="0.7"/></svg> },
              { axis: 'right' as AlignAxis, title: 'Align Right', svg: <svg width="16" height="16" viewBox="0 0 16 16"><rect x="13.5" y="1" width="1.5" height="14" fill="currentColor" rx="0.5"/><rect x="2" y="3" width="10" height="4" fill="currentColor" rx="0.8"/><rect x="6" y="9" width="6" height="4" fill="currentColor" rx="0.8"/></svg> },
              { axis: 'top' as AlignAxis, title: 'Align Top', svg: <svg width="16" height="16" viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="1.5" fill="currentColor" rx="0.5"/><rect x="2" y="4" width="4" height="10" fill="currentColor" rx="0.8"/><rect x="8" y="4" width="4" height="6" fill="currentColor" rx="0.8"/></svg> },
              { axis: 'centerV' as AlignAxis, title: 'Align Center Vertical', svg: <svg width="16" height="16" viewBox="0 0 16 16"><rect x="1" y="7.25" width="14" height="1.5" fill="currentColor" rx="0.5"/><rect x="2" y="2" width="4" height="12" fill="currentColor" rx="0.8" opacity="0.7"/><rect x="8" y="4" width="4" height="8" fill="currentColor" rx="0.8" opacity="0.7"/></svg> },
              { axis: 'bottom' as AlignAxis, title: 'Align Bottom', svg: <svg width="16" height="16" viewBox="0 0 16 16"><rect x="1" y="13.5" width="14" height="1.5" fill="currentColor" rx="0.5"/><rect x="2" y="2" width="4" height="10" fill="currentColor" rx="0.8"/><rect x="8" y="6" width="4" height="6" fill="currentColor" rx="0.8"/></svg> },
            ]).map(({ axis, title, svg }) => (
              <button
                key={axis}
                onClick={() => alignLayers(axis, isMulti ? alignMode === 'canvas' : true)}
                className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-cyan-300 hover:bg-zinc-700/60 rounded transition-colors"
                title={title}
              >
                {svg}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex-1 overflow-auto banner-layers-scroll">
        {displayLayers.map((layer) => {
          const isSelected = selectedLayerIds.includes(layer.id) || layer.id === selectedLayerId;
          const showOpacity = expandedOpacity === layer.id;
          const isDragging = draggingId === layer.id;
          const isDragOver = dragOverId === layer.id && draggingId && draggingId !== layer.id;
          return (
            <div key={layer.id}>
              <div
                draggable
                onDragStart={(e) => handleDragStart(e, layer.id)}
                onDragOver={(e) => handleDragOver(e, layer.id)}
                onDragEnd={handleDragEnd}
                onDrop={(e) => handleDrop(e, layer.id)}
                onClick={(e) => selectLayer(layer.id, e.shiftKey)}
                className={`flex items-center gap-2 px-2 py-1.5 cursor-grab active:cursor-grabbing border-b border-zinc-800/50 transition-colors ${
                  isSelected ? 'bg-cyan-600/25 ring-1 ring-inset ring-cyan-500/40' : 'hover:bg-zinc-800/50'
                } ${isDragging ? 'opacity-40' : ''} ${isDragOver ? 'border-t-2 border-t-cyan-400' : ''}`}
              >
                {/* Drag handle indicator */}
                <i className="fa-solid fa-grip-vertical text-[10px] text-zinc-600 shrink-0" />

                {/* Thumbnail */}
                <div
                  className="w-8 h-8 rounded shrink-0 flex items-center justify-center border overflow-hidden"
                  style={{ borderColor: ROLE_COLORS[layer.role] + '60' }}
                >
                  {layer.type === 'image' && layer.src ? (
                    <img src={layer.src} alt="" className="w-full h-full object-cover rounded" />
                  ) : layer.type === 'text' ? (
                    <span className="text-sm text-zinc-400 font-bold">Aa</span>
                  ) : (
                    <i className="fa-solid fa-shapes text-sm text-zinc-400" />
                  )}
                </div>

                {/* Name + role */}
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-medium truncate ${isSelected ? 'text-cyan-300' : layer.visible ? 'text-zinc-200' : 'text-zinc-500 line-through'}`}>
                    {layer.name}
                  </div>
                  <span
                    className="text-[10px] font-bold uppercase"
                    style={{ color: ROLE_COLORS[layer.role] }}
                  >
                    {layer.role}
                  </span>
                </div>

                {/* Always-visible controls */}
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); updateLayer(composition.id, layer.id, { visible: !layer.visible }); }}
                    className={`w-7 h-7 flex items-center justify-center transition-colors ${layer.visible ? 'text-zinc-400 hover:text-white' : 'text-zinc-600 hover:text-zinc-400'}`}
                    title={layer.visible ? 'Hide' : 'Show'}
                  >
                    <i className={`fa-solid ${layer.visible ? 'fa-eye' : 'fa-eye-slash'} text-sm`} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setExpandedOpacity(showOpacity ? null : layer.id); }}
                    className={`w-7 h-7 flex items-center justify-center transition-colors ${showOpacity ? 'text-cyan-400' : 'text-zinc-400 hover:text-white'}`}
                    title={`Opacity ${Math.round(layer.opacity * 100)}%`}
                  >
                    <i className="fa-solid fa-circle-half-stroke text-sm" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); updateLayer(composition.id, layer.id, { locked: !layer.locked }); }}
                    className={`w-7 h-7 flex items-center justify-center transition-colors ${layer.locked ? 'text-amber-400' : 'text-zinc-400 hover:text-amber-400'}`}
                    title={layer.locked ? 'Unlock' : 'Lock'}
                  >
                    <i className={`fa-solid ${layer.locked ? 'fa-lock' : 'fa-lock-open'} text-sm`} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); duplicateLayer(layer.id); }}
                    title="Duplicate Layer"
                    className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
                  >
                    <i className="fa-solid fa-clone text-sm" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteLayer(layer.id); }}
                    title="Delete Layer"
                    className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-red-400 transition-colors"
                  >
                    <i className="fa-solid fa-trash text-sm" />
                  </button>
                </div>
              </div>

              {/* Inline opacity slider */}
              {showOpacity && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800/60 border-b border-zinc-800/50">
                  <span className="text-[9px] text-zinc-400 w-5 shrink-0">Op</span>
                  <input
                    type="range"
                    min={0} max={1} step={0.01}
                    value={layer.opacity}
                    onChange={e => updateLayer(composition.id, layer.id, { opacity: Number(e.target.value) })}
                    className="flex-1 accent-cyan-500 h-1"
                  />
                  <span className="text-[9px] text-zinc-400 w-7 text-right">{Math.round(layer.opacity * 100)}%</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
};
