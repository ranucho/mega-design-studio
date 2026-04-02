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
  const { layers, selectedLayerId } = composition;
  const [expandedOpacity, setExpandedOpacity] = useState<string | null>(null);

  const selectLayer = useCallback((id: string) => {
    updateComposition(composition.id, { selectedLayerId: selectedLayerId === id ? null : id });
  }, [composition.id, selectedLayerId, updateComposition]);

  const moveLayer = useCallback((id: string, direction: 'up' | 'down') => {
    const idx = layers.findIndex(l => l.id === id);
    if (idx === -1) return;
    const target = direction === 'up' ? idx + 1 : idx - 1;
    if (target < 0 || target >= layers.length) return;
    const newLayers = [...layers];
    [newLayers[idx], newLayers[target]] = [newLayers[target], newLayers[idx]];
    updateComposition(composition.id, { layers: newLayers });
  }, [layers, composition.id, updateComposition]);

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

  // Reversed: top of list = top layer (last in array)
  const displayLayers = [...layers].reverse();

  return (
    <div className="flex flex-col h-full bg-zinc-900/60">
      <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Layers</h3>
        <span className="text-[9px] text-zinc-400">{layers.length} — top to bottom</span>
      </div>
      <div className="flex-1 overflow-auto">
        {displayLayers.map((layer) => {
          const isSelected = layer.id === selectedLayerId;
          const showOpacity = expandedOpacity === layer.id;
          return (
            <div key={layer.id}>
              <div
                onClick={() => selectLayer(layer.id)}
                className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer border-b border-zinc-800/50 transition-colors ${
                  isSelected ? 'bg-cyan-600/15' : 'hover:bg-zinc-800/50'
                }`}
              >
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
                    onClick={(e) => { e.stopPropagation(); moveLayer(layer.id, 'up'); }}
                    title="Move Up (front)"
                    className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
                  >
                    <i className="fa-solid fa-chevron-up text-sm" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); moveLayer(layer.id, 'down'); }}
                    title="Move Down (back)"
                    className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
                  >
                    <i className="fa-solid fa-chevron-down text-sm" />
                  </button>
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
