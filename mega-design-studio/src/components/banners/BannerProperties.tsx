import React from 'react';
import { useBanner } from '@/contexts/BannerContext';
import { BannerComposition, BannerLayer } from '@/types';

interface BannerPropertiesProps {
  composition: BannerComposition;
}

const NumInput: React.FC<{
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number;
}> = ({ label, value, onChange, min, max, step = 1 }) => (
  <label className="flex items-center gap-2">
    <span className="text-[10px] text-zinc-400 w-5 text-right shrink-0">{label}</span>
    <input
      type="number"
      value={Math.round(value * 100) / 100}
      onChange={e => onChange(Number(e.target.value))}
      min={min} max={max} step={step}
      className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 focus:border-cyan-600 focus:outline-none"
    />
  </label>
);

export const BannerProperties: React.FC<BannerPropertiesProps> = ({ composition }) => {
  const { updateLayer } = useBanner();
  const layer = composition.layers.find(l => l.id === composition.selectedLayerId);

  if (!layer) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-400 text-xs">
        Select a layer
      </div>
    );
  }

  const update = (updates: Partial<BannerLayer>) => {
    updateLayer(composition.id, layer.id, updates);
  };

  return (
    <div className="flex flex-col h-full bg-zinc-900/60 border-l border-zinc-800 overflow-auto">
      <div className="px-3 py-2 border-b border-zinc-800">
        <h3 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Properties</h3>
      </div>

      <div className="flex flex-col gap-3 p-3 text-xs">
        {/* Name */}
        <div>
          <label className="text-[10px] text-zinc-400 uppercase tracking-wider mb-1 block">Name</label>
          <input
            value={layer.name}
            onChange={e => update({ name: e.target.value })}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 focus:border-cyan-600 focus:outline-none"
          />
        </div>

        {/* Position */}
        <div>
          <label className="text-[10px] text-zinc-400 uppercase tracking-wider mb-1 block">Position</label>
          <div className="grid grid-cols-2 gap-1.5">
            <NumInput label="X" value={layer.x} onChange={v => update({ x: v })} />
            <NumInput label="Y" value={layer.y} onChange={v => update({ y: v })} />
          </div>
        </div>

        {/* Scale */}
        <div>
          <label className="text-[10px] text-zinc-400 uppercase tracking-wider mb-1 block">Scale</label>
          <div className="grid grid-cols-2 gap-1.5">
            <NumInput label="W" value={layer.nativeWidth * layer.scaleX} onChange={v => update({ scaleX: v / layer.nativeWidth })} min={1} />
            <NumInput label="H" value={layer.nativeHeight * layer.scaleY} onChange={v => update({ scaleY: v / layer.nativeHeight })} min={1} />
          </div>
        </div>

        {/* Rotation */}
        <div>
          <label className="text-[10px] text-zinc-400 uppercase tracking-wider mb-1 block">Rotation</label>
          <NumInput label="°" value={layer.rotation} onChange={v => update({ rotation: v })} min={-360} max={360} />
        </div>

        {/* Opacity — controlled from layer panel inline slider, no duplicate here */}

        {/* Text properties */}
        {layer.type === 'text' && (
          <>
            <div className="h-px bg-zinc-800 my-1" />
            <div>
              <label className="text-[10px] text-zinc-400 uppercase tracking-wider mb-1 block">Text</label>
              <textarea
                value={layer.text || ''}
                onChange={e => update({ text: e.target.value })}
                rows={2}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 focus:border-cyan-600 focus:outline-none resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="text-[10px] text-zinc-400 mb-0.5 block">Font</label>
                <select
                  value={layer.fontFamily || 'sans-serif'}
                  onChange={e => update({ fontFamily: e.target.value })}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-1.5 py-1 text-[10px] text-zinc-300"
                >
                  <option value="sans-serif">Sans-serif</option>
                  <option value="serif">Serif</option>
                  <option value="monospace">Monospace</option>
                  <option value="Impact">Impact</option>
                  <option value="Georgia">Georgia</option>
                  <option value="Arial Black">Arial Black</option>
                </select>
              </div>
              <NumInput label="Sz" value={layer.fontSize || 24} onChange={v => update({ fontSize: v })} min={8} max={200} />
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="text-[10px] text-zinc-400 mb-0.5 block">Color</label>
                <input
                  type="color"
                  value={layer.fontColor || '#ffffff'}
                  onChange={e => update({ fontColor: e.target.value })}
                  className="w-full h-7 rounded border border-zinc-700 bg-zinc-800 cursor-pointer"
                />
              </div>
              <div>
                <label className="text-[10px] text-zinc-400 mb-0.5 block">Weight</label>
                <select
                  value={layer.fontWeight || 700}
                  onChange={e => update({ fontWeight: Number(e.target.value) })}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-1.5 py-1 text-[10px] text-zinc-300"
                >
                  <option value={400}>Regular</option>
                  <option value={600}>Semi-bold</option>
                  <option value={700}>Bold</option>
                  <option value={900}>Black</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-[10px] text-zinc-400 mb-0.5 block">Align</label>
              <div className="flex gap-1">
                {(['left', 'center', 'right'] as const).map(a => (
                  <button
                    key={a}
                    onClick={() => update({ textAlign: a })}
                    className={`flex-1 py-1 rounded text-[10px] border transition-colors ${
                      (layer.textAlign || 'left') === a
                        ? 'border-cyan-600/40 text-cyan-400 bg-cyan-600/10'
                        : 'border-zinc-700 text-zinc-400 hover:text-zinc-300'
                    }`}
                  >
                    <i className={`fa-solid fa-align-${a}`} />
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
