import React, { useMemo, useCallback, useState } from 'react';
import { useBanner } from '@/contexts/BannerContext';
import { BANNER_PRESETS, BANNER_PRESET_CATEGORIES, BannerPresetCategory } from '@/types';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

const QUICK_SELECTS: { label: string; icon: string; filter: (cat: BannerPresetCategory) => boolean }[] = [
  { label: 'All', icon: 'fa-layer-group', filter: () => true },
  { label: 'Social Only', icon: 'fa-share-nodes', filter: c => ['facebook', 'instagram', 'social'].includes(c) },
  { label: 'Performance', icon: 'fa-chart-line', filter: c => ['google-display', 'facebook'].includes(c) },
  { label: 'Display Network', icon: 'fa-rectangle-ad', filter: c => c === 'google-display' },
  { label: 'App Stores', icon: 'fa-mobile-screen', filter: c => c === 'app-stores' },
];

const BAGELCODE_KEYS = [
  'youtube-thumb', 'fb-feed', 'mobile-landscape-480', 'gdn-large-rect',
  'gdn-medium-rect', 'portrait-hd-720', 'ipad-portrait', 'gdn-half-page',
  'mobile-portrait-320', 'square-480', 'gdn-leaderboard', 'gdn-mobile-large',
  'full-banner-468', 'gdn-mobile-banner', 'small-mobile-300', 'ig-portrait',
  'ig-stories', 'fullhd-landscape',
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
  const { project, togglePreset, setSelectedPresets, setStage, setProject, generateCompositions, applyCtaShorteningToExisting } = useBanner();

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

  const handleBagelcodeSelect = useCallback(() => {
    const allSelected = BAGELCODE_KEYS.every(k => selectedKeys.has(k));
    if (allSelected) {
      setSelectedPresets(
        (project?.selectedPresets ?? []).filter(k => !BAGELCODE_KEYS.includes(k))
      );
    } else {
      const merged = new Set([...(project?.selectedPresets ?? []), ...BAGELCODE_KEYS]);
      setSelectedPresets(Array.from(merged));
    }
  }, [selectedKeys, project?.selectedPresets, setSelectedPresets]);

  const bagelcodeAllSelected = useMemo(
    () => BAGELCODE_KEYS.every(k => selectedKeys.has(k)),
    [selectedKeys]
  );

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
  const [matchConfirm, setMatchConfirm] = useState<{ targetKeys: string[]; touchedCount: number } | null>(null);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 min-h-0 overflow-auto p-6">
        <div className="max-w-4xl mx-auto flex flex-col gap-6">

          <div className="text-center">
            <h2 className="text-xl font-bold text-white mb-1">Pick sizes</h2>
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
            <button
              key="bagelcode"
              onClick={handleBagelcodeSelect}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                bagelcodeAllSelected
                  ? 'bg-amber-600/20 text-amber-300 border-amber-600/40'
                  : 'text-amber-400/80 border-amber-700/40 hover:border-amber-500 hover:text-amber-300'
              }`}
              title="Bagelcode production set"
            >
              <i className="fa-solid fa-star mr-1.5" />
              Bagelcode set
            </button>
          </div>

          {/* Generation options */}
          <div className="flex items-center justify-center gap-3 text-xs">
            <label className="flex items-center gap-2 cursor-pointer select-none text-zinc-300 hover:text-white transition-colors">
              <input
                type="checkbox"
                checked={project?.shortenCTAs !== false}
                onChange={e => applyCtaShorteningToExisting(e.target.checked)}
                className="w-3.5 h-3.5 rounded accent-cyan-500"
              />
              <span>
                <i className="fa-solid fa-scissors mr-1 text-cyan-400/70" />
                Shorten CTAs on narrow banners
              </span>
              <span className="text-xs text-zinc-400" title="SPIN NOW → SPIN, CLAIM NOW! → CLAIM, etc.">
                <i className="fa-solid fa-circle-info" />
              </span>
            </label>
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
                    {catSelected > 0 && (
                      <span className="text-xs text-zinc-400 tabular-nums">· {catSelected}</span>
                    )}
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
                    className="text-xs text-zinc-400 hover:text-cyan-400 transition-colors uppercase tracking-wider"
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
                        aria-pressed={isSelected}
                        className={`group relative flex items-center gap-2 px-3 py-2 rounded-lg text-xs border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 ${
                          hasComposition && isSelected
                            ? 'bg-emerald-600/20 text-emerald-200 border-emerald-400 shadow-md shadow-emerald-500/30 ring-1 ring-emerald-400/50'
                            : hasComposition
                              ? 'bg-emerald-600/10 text-emerald-400 border-emerald-700/40 hover:border-emerald-500/60'
                              : isSelected
                                ? 'bg-cyan-600/15 text-cyan-300 border-cyan-500 shadow-md shadow-cyan-500/20'
                                : 'bg-zinc-800/60 text-zinc-400 border-zinc-700/50 hover:border-zinc-600 hover:text-zinc-300'
                        }`}
                      >
                        {/* Generated badge */}
                        {hasComposition && (
                          <i className="fa-solid fa-check-circle text-emerald-400 text-xs absolute -top-1.5 -right-1.5" />
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
                          <div className={`text-xs tabular-nums ${hasComposition ? 'text-emerald-300/80' : isSelected ? 'text-cyan-300/80' : 'text-zinc-400'}`}>
                            {preset.width} × {preset.height}
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
            const existCount = [...selectedKeys].filter(k => existingKeys.has(k)).length;
            if (newCount === 0 && existCount === 0) return null;
            const parts: string[] = [];
            if (newCount > 0) parts.push(`${newCount} to generate`);
            if (existCount > 0) parts.push(`${existCount} already done`);
            return (
              <span className="text-sm text-zinc-300 tabular-nums">
                {parts.join(' · ')}
              </span>
            );
          })()}
          {(() => {
            const KICKOFFS = ['fb-feed', 'fb-square', 'fb-stories', 'fullhd-landscape'];
            const comps = project?.compositions ?? [];
            const touchedKickoffCount = comps.filter(
              c => KICKOFFS.includes(c.presetKey) &&
                (c.status === 'edited' || c.status === 'approved'),
            ).length;
            const selectedNonKickoffKeys = [...selectedKeys].filter(k => !KICKOFFS.includes(k));
            const canPropagate = touchedKickoffCount > 0 && selectedNonKickoffKeys.length > 0;
            return canPropagate && !project?.isGenerating ? (
              <button
                onClick={() => setMatchConfirm({ targetKeys: selectedNonKickoffKeys, touchedCount: touchedKickoffCount })}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white transition-colors flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
                title={`Match layout of ${selectedNonKickoffKeys.length} banners to your ${touchedKickoffCount} edited primaries`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="1" y="9" width="7" height="6" rx="1.2" />
                  <rect x="16" y="1" width="7" height="5.5" rx="1.2" />
                  <rect x="16" y="9.25" width="7" height="5.5" rx="1.2" />
                  <rect x="16" y="17.5" width="7" height="5.5" rx="1.2" />
                  <path d="M8 12 H12 M12 4 V20 M12 4 H16 M12 12 H16 M12 20 H16" />
                </svg>
                Match layout to {selectedNonKickoffKeys.length} others
              </button>
            ) : null;
          })()}
          {(() => {
            const newKeys = [...selectedKeys].filter(k => !existingKeys.has(k));
            const newCount = newKeys.length;
            const hasAnyExisting = existingKeys.size > 0;
            const isGenerating = !!project?.isGenerating;
            const disabled = (selectedCount === 0 && !hasAnyExisting) || isGenerating;
            const label = isGenerating
              ? `Generating ${newCount || ''}…`.trim()
              : newCount > 0
                ? `Generate ${newCount}`
                : 'Next';
            return (
              <button
                disabled={disabled}
                onClick={() => {
                  if (newCount === 0) {
                    // Nothing new to generate — go to edit stage, never silently regen
                    setStage('edit');
                    return;
                  }
                  const KICKOFFS = ['fb-feed', 'fb-square', 'fb-stories', 'fullhd-landscape'];
                  const nonKickoffNewKeys = newKeys.filter(k => !KICKOFFS.includes(k));
                  if (nonKickoffNewKeys.length > 0 && nonKickoffNewKeys.length !== newKeys.length) {
                    generateCompositions({ onlyKeys: nonKickoffNewKeys });
                  } else {
                    generateCompositions();
                  }
                }}
                className={`px-6 py-2.5 text-sm font-semibold rounded-lg transition-all shadow-lg tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 ${
                  !disabled
                    ? 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-cyan-600/20'
                    : 'bg-zinc-700 text-zinc-400 cursor-not-allowed shadow-none'
                }`}
              >
                {isGenerating ? (
                  <><i className="fa-solid fa-spinner fa-spin mr-2" />{label}</>
                ) : (
                  <>{label}<i className="fa-solid fa-arrow-right ml-2" /></>
                )}
              </button>
            );
          })()}
        </div>
      </div>
      <ConfirmDialog
        isOpen={!!matchConfirm}
        title="Match layout?"
        message={matchConfirm ? (
          <>
            Match <span className="tabular-nums font-semibold text-white">{matchConfirm.targetKeys.length}</span> banners to your <span className="tabular-nums font-semibold text-white">{matchConfirm.touchedCount}</span> edited primaries. Existing layouts on those banners will be replaced.
          </>
        ) : ''}
        confirmLabel="Match layout"
        destructive
        onConfirm={() => {
          if (matchConfirm) generateCompositions({ onlyKeys: matchConfirm.targetKeys });
        }}
        onClose={() => setMatchConfirm(null)}
      />
    </div>
  );
};
