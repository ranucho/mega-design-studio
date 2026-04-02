import React, { useState } from 'react';
import { useApp } from '@/contexts/AppContext';
import { ReferenceAsset, AssetType } from '@/types';

const TYPE_LABELS: Record<AssetType, string> = {
  character_primary: 'Primary Character',
  character_secondary: 'Secondary Character',
  background: 'Background',
  style: 'Style Reference',
  object: 'Object / Prop',
  game_symbol: 'Game Symbol',
  long_game_tile: 'Long Tile',
};

interface AssetManagerProps {
  compact?: boolean;
}

export const AssetManager: React.FC<AssetManagerProps> = ({ compact = false }) => {
  const { assetLibrary, removeAsset, setAssetLibrary } = useApp();
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const handleUpdateAsset = (id: string, updates: Partial<ReferenceAsset>) => {
    setAssetLibrary(assetLibrary.map(a => a.id === id ? { ...a, ...updates } : a));
  };

  if (assetLibrary.length === 0) {
    return (
      <div className="text-center py-8 border border-dashed border-zinc-800 rounded-xl bg-zinc-900/20">
        <i className="fas fa-box-open text-2xl text-zinc-700 mb-2" />
        <p className="text-zinc-400 text-xs">No shared assets yet. Generate assets in Toolkit or create character blueprints in Storyboard.</p>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="flex gap-2 flex-wrap">
        {assetLibrary.map(asset => (
          <div key={asset.id} className="relative group">
            <div
              className="w-14 h-14 rounded-lg border border-zinc-700 overflow-hidden cursor-pointer hover:border-indigo-500 transition-colors bg-black"
              onClick={() => setPreviewImage(asset.url)}
              title={asset.name || TYPE_LABELS[asset.type]}
            >
              <img src={asset.url} className="w-full h-full object-contain" />
            </div>
            <button
              onClick={() => removeAsset(asset.id)}
              className="absolute -top-1 -right-1 w-4 h-4 bg-red-600 text-white rounded-full text-[8px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <i className="fas fa-times" />
            </button>
          </div>
        ))}
        {previewImage && (
          <div className="fixed inset-0 z-[200] bg-black/95 flex items-center justify-center p-4" onClick={() => setPreviewImage(null)}>
            <img src={previewImage} className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg" onClick={e => e.stopPropagation()} />
            <button className="absolute top-4 right-4 text-white hover:text-red-500 text-2xl" onClick={() => setPreviewImage(null)}>
              <i className="fas fa-times" />
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {previewImage && (
        <div className="fixed inset-0 z-[200] bg-black/95 flex items-center justify-center p-4" onClick={() => setPreviewImage(null)}>
          <img src={previewImage} className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg" onClick={e => e.stopPropagation()} />
          <button className="absolute top-4 right-4 text-white hover:text-red-500 text-2xl" onClick={() => setPreviewImage(null)}>
            <i className="fas fa-times" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {assetLibrary.map(asset => (
          <div key={asset.id} className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden group hover:border-indigo-500/50 transition-all flex flex-col">
            <div className="aspect-square bg-black relative p-1 flex items-center justify-center overflow-hidden">
              <img src={asset.url} className="w-full h-full object-contain" />
              <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => setPreviewImage(asset.url)} className="bg-black/60 hover:bg-indigo-500 text-white w-6 h-6 rounded flex items-center justify-center transition-colors">
                  <i className="fas fa-eye text-[10px]" />
                </button>
                <button onClick={() => removeAsset(asset.id)} className="bg-black/60 hover:bg-red-500 text-white w-6 h-6 rounded flex items-center justify-center transition-colors">
                  <i className="fas fa-times text-[10px]" />
                </button>
              </div>
            </div>
            <div className="p-2 border-t border-zinc-800 space-y-1">
              <input
                type="text" value={asset.name || ''} onChange={(e) => handleUpdateAsset(asset.id, { name: e.target.value })}
                placeholder="Name..." className="w-full bg-black border border-zinc-700 rounded px-2 py-1 text-[10px] text-indigo-300 font-bold focus:border-indigo-500 outline-none"
              />
              <select
                value={asset.type} onChange={(e) => handleUpdateAsset(asset.id, { type: e.target.value as AssetType })}
                className="w-full bg-black border border-zinc-700 rounded px-2 py-1 text-[10px] text-zinc-300 focus:border-indigo-500 outline-none"
              >
                {Object.entries(TYPE_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
