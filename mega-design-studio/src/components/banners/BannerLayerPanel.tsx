import React, { useCallback } from 'react';
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

  const selectLayer = useCallback((id: string) => {
    updateComposition(composition.id, { selectedLayerId: id });
  }, [composition.id, updateComposition]);

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

  // Reversed: top of list = top layer (last in array)
  const displayLayers = [...layers].reverse();

  return (
    <div className="flex flex-col h-full bg-zinc-900/60 border-r border-zinc-800">
      <div className="px-3 py-2 border-b border-zinc-800">
        <h3 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Layers</h3>
      </div>
      <div className="flex-1 overflow-auto">
        {displayLayers.map((layer) => {
          const isSelected = layer.id === selectedLayerId;
          return (
            <div
              key={layer.id}
              onClick={() => selectLayer(layer.id)}
              className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer border-b border-zinc-800/50 transition-colors ${
                isSelected ? 'bg-cyan-600/15' : 'hover:bg-zinc-800/50'
              }`}
            >
              {/* Thumbnail */}
              <div
                className="w-8 h-8 rounded shrink-0 flex items-center justify-center border"
                style={{ borderColor: ROLE_COLORS[layer.role] + '60' }}
              >
                {layer.type === 'image' && layer.src ? (
                  <img src={layer.src} alt="" className="w-full h-full object-cover rounded" />
                ) : layer.type === 'text' ? (
                  <span className="text-[8px] text-zinc-400 font-bold">Aa</span>
                ) : (
                  <i className="fa-solid fa-shapes text-[8px] text-zinc-500" />
                )}
              </div>

              {/* Name + role */}
              <div className="flex-1 min-w-0">
                <div className={`text-[11px] truncate ${isSelected ? 'text-cyan-300' : 'text-zinc-300'}`}>
                  {layer.name}
                </div>
                <div
                  className="text-[8px] font-bold uppercase"
                  style={{ color: ROLE_COLORS[layer.role] }}
                >
                  {layer.role}
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  onClick={(e) => { e.stopPropagation(); updateLayer(composition.id, layer.id, { visible: !layer.visible }); }}
                  className={`p-1 rounded transition-colors ${layer.visible ? 'text-zinc-400 hover:text-white' : 'text-zinc-700'}`}
                  title={layer.visible ? 'Hide' : 'Show'}
                >
                  <i className={`fa-solid ${layer.visible ? 'fa-eye' : 'fa-eye-slash'} text-[9px]`} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); updateLayer(composition.id, layer.id, { locked: !layer.locked }); }}
                  className={`p-1 rounded transition-colors ${layer.locked ? 'text-yellow-500' : 'text-zinc-600 hover:text-zinc-400'}`}
                  title={layer.locked ? 'Unlock' : 'Lock'}
                >
                  <i className={`fa-solid ${layer.locked ? 'fa-lock' : 'fa-lock-open'} text-[9px]`} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Layer actions */}
      {selectedLayerId && (
        <div className="shrink-0 flex items-center gap-1 px-2 py-2 border-t border-zinc-800">
          <button
            onClick={() => moveLayer(selectedLayerId, 'up')}
            title="Move Up"
            className="p-1.5 text-zinc-500 hover:text-white rounded transition-colors"
          >
            <i className="fa-solid fa-arrow-up text-[10px]" />
          </button>
          <button
            onClick={() => moveLayer(selectedLayerId, 'down')}
            title="Move Down"
            className="p-1.5 text-zinc-500 hover:text-white rounded transition-colors"
          >
            <i className="fa-solid fa-arrow-down text-[10px]" />
          </button>
          <div className="flex-1" />
          <button
            onClick={() => deleteLayer(selectedLayerId)}
            title="Delete Layer"
            className="p-1.5 text-red-500/60 hover:text-red-400 rounded transition-colors"
          >
            <i className="fa-solid fa-trash text-[10px]" />
          </button>
        </div>
      )}
    </div>
  );
};
