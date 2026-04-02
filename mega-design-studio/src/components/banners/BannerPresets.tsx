import React, { useMemo, useCallback } from 'react';
import { useBanner } from '@/contexts/BannerContext';
import { BANNER_PRESETS, BANNER_PRESET_CATEGORIES, BannerPresetCategory } from '@/types';

const QUICK_SELECTS: { label: string; icon: string; filter: (cat: BannerPresetCategory) => boolean }[] = [
  { label: 'All', icon: 'fa-layer-group', filter: () => true },
  { label: 'Social Only', icon: 'fa-share-nodes', filter: c => ['facebook', 'instagram', 'social'].includes(c) },
  { label: 'Performance', icon: 'fa-chart-line', filter: c => ['google-display', 'facebook'].includes(c) },
  { label: 'Display Network', icon: 'fa-rectangle-ad', filter: c => c === 'google-display' },
  { label: 'App Stores', icon: 'fa-mobile-screen', filter: c => c === 'app-stores' },
];

const CATEGORY_ICONS: Record<BannerPresetCategory, string> = {
  'app-stores': 'fa-mobile-screen',
  'facebook': 'fa-square-facebook',
  'instagram': 'fa-instagram',
  'google-display': 'fa-rectangle-ad',
  'social': 'fa-share-nodes',
  'web-email': 'fa-globe',
  'print': 'fa-print',
};

export const BannerPresets: React.FC = () => {
  const { project, togglePreset, setSelectedPresets, setStage, generateCompositions } = useBanner();

  const selectedKeys = useMemo(() => new Set(project?.selectedPresets ?? []), [project?.selectedPresets]);
  const existingKeys = useMemo(() => new Set(
    (project?.compositions ?? []).map(c => c.presetKey).filter(Boolean)
  ), [project?.compositions]);

  const grouped = useMemo(() => {
    const map = new Map<BannerPresetCategory, typeof BANNER_PRESETS>();
    for (const cat of BANNER_PRESET_CATEGORIES) {
      map.set(cat.key, BANNER_PRESETS.filter(p => p.category === cat.key));
    }
    return map;
  }, []);

  const handleQuickSelect = useCallback((filter: (cat: BannerPresetCategory) => boolean) => {
    const keys = BANNER_PRESETS
      .filter(p => filter(p.category))
      .map(p => p.key);

    // If all matching are already selected, deselect them. Otherwise select them.
    const allSelected = keys.every(k => selectedKeys.has(k));
    if (allSelected) {
      setSelectedPresets(
        (project?.selectedPresets ?? []).filter(k => !keys.includes(k))
      );
    } else {
      const merged = new Set([...(project?.selectedPresets ?? []), ...keys]);
      setSelectedPresets(Array.from(merged));
    }
  }, [selectedKeys, project?.selectedPresets, setSelectedPresets]);

  const selectedCount = selectedKeys.size;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto flex flex-col gap-6">

          <div className="text-center">
            <h2 className="text-xl font-bold text-white mb-1">Select Target Sizes</h2>
            <p className="text-zinc-400 text-sm">
              Choose which banner sizes to generate. AI will redesign your banner for each size — not just crop or stretch.
            </p>
          </div>

          {/* Quick selects */}
          <div className="flex flex-wrap justify-center gap-2">
            {QUICK_SELECTS.map((qs) => {
              const matchingKeys = BANNER_PRESETS.filter(p => qs.filter(p.category)).map(p => p.key);
              const allSelected = matchingKeys.every(k => selectedKeys.has(k));
              return (
                <button
                  key={qs.label}
                  onClick={() => handleQuickSelect(qs.filter)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                    allSelected
                      ? 'bg-cyan-600/20 text-cyan-400 border-cyan-600/40'
                      : 'text-zinc-400 border-zinc-700 hover:border-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <i className={`fa-solid ${qs.icon} mr-1.5`} />
                  {qs.label}
                </button>
              );
            })}
          </div>

          {/* Grouped presets */}
          {BANNER_PRESET_CATEGORIES.map(cat => {
            const presets = grouped.get(cat.key) ?? [];
            const catSelected = presets.filter(p => selectedKeys.has(p.key)).length;
            const allCatSelected = catSelected === presets.length;

            return (
              <div key={cat.key} className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <i className={`fa-brands ${CATEGORY_ICONS[cat.key]} text-zinc-400 text-sm`} />
                    <h3 className="text-sm font-semibold text-zinc-300">{cat.label}</h3>
                    <span className="text-[10px] text-zinc-400">({catSelected}/{presets.length})</span>
                  </div>
                  <button
                    onClick={() => {
                      if (allCatSelected) {
                        setSelectedPresets(
                          (project?.selectedPresets ?? []).filter(k => !presets.some(p => p.key === k))
                        );
                      } else {
                        const merged = new Set([...(project?.selectedPresets ?? []), ...presets.map(p => p.key)]);
                        setSelectedPresets(Array.from(merged));
                      }
                    }}
                    className="text-[10px] text-zinc-400 hover:text-cyan-400 transition-colors uppercase tracking-wider"
                  >
                    {allCatSelected ? 'Deselect all' : 'Select all'}
                  </button>
                </div>

                <div className="flex flex-wrap gap-2">
                  {presets.map(preset => {
                    const isSelected = selectedKeys.has(preset.key);
                    const hasComposition = existingKeys.has(preset.key);
                    const isLandscape = preset.width > preset.height;
                    const isSquare = preset.width === preset.height;

                    return (
                      <button
                        key={preset.key}
                        onClick={() => togglePreset(preset.key)}
                        className={`group relative flex items-center gap-2 px-3 py-2 rounded-lg text-xs border transition-all ${
                          hasComposition
                            ? 'bg-emerald-600/15 text-emerald-300 border-emerald-600/40 shadow-sm shadow-emerald-600/10'
                            : isSelected
                              ? 'bg-cyan-600/15 text-cyan-300 border-cyan-600/40 shadow-sm shadow-cyan-600/10'
                              : 'bg-zinc-800/60 text-zinc-400 border-zinc-700/50 hover:border-zinc-600 hover:text-zinc-300'
                        }`}
                      >
                        {/* Generated badge */}
                        {hasComposition && (
                          <i className="fa-solid fa-check-circle text-emerald-400 text-[9px] absolute -top-1 -right-1" />
                        )}
                        {/* Aspect ratio indicator */}
                        <div
                          className={`shrink-0 border rounded-sm ${
                            hasComposition ? 'border-emerald-500/60' : isSelected ? 'border-cyan-500/60' : 'border-zinc-600'
                          }`}
                          style={{
                            width: isSquare ? 12 : isLandscape ? 16 : 10,
                            height: isSquare ? 12 : isLandscape ? 10 : 16,
                          }}
                        />
                        <div className="text-left">
                          <div className="font-medium">{preset.name}</div>
                          <div className={`text-[10px] ${hasComposition ? 'text-emerald-500/70' : isSelected ? 'text-cyan-500/70' : 'text-zinc-400'}`}>
                            {preset.width} x {preset.height}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="shrink-0 flex items-center justify-between px-6 py-3 bg-zinc-900/80 border-t border-zinc-800">
        <button
          onClick={() => setStage('extract')}
          className="px-4 py-2 text-sm text-zinc-400 hover:text-white border border-zinc-700 rounded-lg transition-colors"
        >
          <i className="fa-solid fa-arrow-left mr-2" />
          Back
        </button>
        <div className="flex items-center gap-4">
          {(() => {
            const newCount = [...selectedKeys].filter(k => !existingKeys.has(k)).length;
            const existCount = existingKeys.size;
            return (
              <span className="text-sm text-zinc-400 flex items-center gap-3">
                {existCount > 0 && (
                  <span>
                    <span className="font-bold text-emerald-400">{existCount}</span> existing
                  </span>
                )}
                {newCount > 0 && (
                  <span>
                    <span className="font-bold text-cyan-400">{newCount}</span> new
                  </span>
                )}
                {existCount === 0 && newCount === 0 && (
                  <span><span className="font-bold text-zinc-400">0</span> selected</span>
                )}
              </span>
            );
          })()}
          <button
            disabled={selectedCount === 0 || project?.isGenerating}
            onClick={() => generateCompositions()}
            className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-all shadow-lg ${
              selectedCount > 0 && !project?.isGenerating
                ? 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-cyan-600/20'
                : 'bg-zinc-700 text-zinc-400 cursor-not-allowed shadow-none'
            }`}
          >
            {project?.isGenerating ? (
              <>
                <i className="fa-solid fa-spinner fa-spin mr-2" />
                Generating...
              </>
            ) : (
              <>
                {[...selectedKeys].filter(k => !existingKeys.has(k)).length > 0
                  ? `Generate ${[...selectedKeys].filter(k => !existingKeys.has(k)).length} New`
                  : 'Continue'}
                <i className="fa-solid fa-arrow-right ml-2" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
