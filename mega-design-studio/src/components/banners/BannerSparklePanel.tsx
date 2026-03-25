import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useBanner } from '@/contexts/BannerContext';
import { sparkleBanner, DEFAULT_FINE_TUNE, type FineTuneOptions } from '@/services/gemini';
import { BannerComposition, BannerLayer } from '@/types';

/** Render a composition to a data URL for sparkle processing */
const renderCompositionToDataUrl = async (comp: BannerComposition): Promise<string> => {
  const canvas = document.createElement('canvas');
  canvas.width = comp.width;
  canvas.height = comp.height;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = comp.backgroundColor || '#000';
  ctx.fillRect(0, 0, comp.width, comp.height);

  const imageMap = new Map<string, HTMLImageElement>();
  await Promise.all(
    comp.layers
      .filter(l => l.type === 'image' && l.src)
      .map(l => new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => { imageMap.set(l.id, img); resolve(); };
        img.onerror = () => resolve();
        img.src = l.src!;
      }))
  );

  for (const layer of comp.layers) {
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
      if (layer.textStroke) { ctx.strokeStyle = layer.textStroke; ctx.lineWidth = Math.max(1, fontSize / 12); ctx.strokeText(layer.text || '', layer.x, layer.y); }
      ctx.fillStyle = layer.fontColor || '#ffffff';
      ctx.fillText(layer.text || '', layer.x, layer.y);
    } else if (layer.type === 'image' && layer.src) {
      const img = imageMap.get(layer.id);
      if (img) ctx.drawImage(img, layer.x, layer.y, layer.nativeWidth * layer.scaleX, layer.nativeHeight * layer.scaleY);
    }
    ctx.restore();
  }

  return canvas.toDataURL('image/png');
};

const ROLE_ICONS: Record<string, string> = {
  background: 'fa-image',
  character: 'fa-person',
  text: 'fa-font',
  cta: 'fa-hand-pointer',
  logo: 'fa-stamp',
  decoration: 'fa-sparkles',
  other: 'fa-puzzle-piece',
};

// ── Fine Tune Config Popup — layer-based ──
const FineTuneConfigPopup: React.FC<{
  layers: BannerLayer[];
  options: FineTuneOptions;
  onChange: (opts: FineTuneOptions) => void;
  onApply: () => void;
  onCancel: () => void;
  targetLabel: string;
}> = ({ layers, options, onChange, onApply, onCancel, targetLabel }) => {
  const visibleLayers = layers.filter(l => l.visible);

  const isEnhanced = (name: string) => options.enhanceLayers.includes(name);

  const toggleLayer = (name: string) => {
    if (isEnhanced(name)) {
      onChange({
        ...options,
        enhanceLayers: options.enhanceLayers.filter(n => n !== name),
        protectLayers: [...options.protectLayers.filter(n => n !== name), name],
      });
    } else {
      onChange({
        ...options,
        enhanceLayers: [...options.enhanceLayers.filter(n => n !== name), name],
        protectLayers: options.protectLayers.filter(n => n !== name),
      });
    }
  };

  const allChecked = visibleLayers.every(l => isEnhanced(l.name));
  const toggleAll = () => {
    const names = visibleLayers.map(l => l.name);
    if (allChecked) {
      onChange({ ...options, enhanceLayers: [], protectLayers: names });
    } else {
      onChange({ ...options, enhanceLayers: names, protectLayers: [] });
    }
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/80 flex items-center justify-center p-6" onClick={onCancel}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl max-w-lg w-full flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-800">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <i className="fa-solid fa-wand-magic-sparkles text-amber-400" />
            Fine Tune Settings
          </h3>
          <p className="text-[10px] text-zinc-500 mt-0.5">
            {targetLabel} — Check elements to enhance, uncheck to keep exactly as-is
          </p>
        </div>

        {/* Layer checkboxes */}
        <div className="px-5 py-4 flex flex-col gap-1.5 max-h-[50vh] overflow-auto">
          {/* Select all */}
          <label className="flex items-center gap-3 px-2 py-1.5 cursor-pointer text-zinc-400 hover:text-white transition-colors">
            <input type="checkbox" checked={allChecked} onChange={toggleAll} className="accent-amber-500" />
            <span className="text-[10px] font-bold uppercase">Select All</span>
          </label>
          <div className="h-px bg-zinc-800 my-1" />

          {visibleLayers.map(layer => {
            const checked = isEnhanced(layer.name);
            const icon = ROLE_ICONS[layer.role] || 'fa-puzzle-piece';
            return (
              <label
                key={layer.id}
                className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-all ${
                  checked
                    ? 'border-amber-600/40 bg-amber-600/5'
                    : 'border-zinc-800 bg-zinc-800/20 hover:border-zinc-700'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleLayer(layer.name)}
                  className="accent-amber-500"
                />
                <i className={`fa-solid ${icon} text-xs w-4 text-center ${checked ? 'text-amber-400' : 'text-zinc-600'}`} />
                <div className="flex-1 min-w-0">
                  <span className={`text-xs font-medium ${checked ? 'text-white' : 'text-zinc-400'}`}>{layer.name}</span>
                  <span className="text-[9px] text-zinc-600 ml-2">{layer.role}</span>
                </div>
                {!checked && (
                  <span className="text-[8px] text-zinc-600 bg-zinc-800 px-1.5 py-0.5 rounded uppercase font-bold">protected</span>
                )}
              </label>
            );
          })}

          {/* Custom instructions */}
          <div className="mt-3 pt-3 border-t border-zinc-800">
            <label className="text-[10px] font-bold text-zinc-400 uppercase block mb-1.5">
              <i className="fa-solid fa-pen mr-1 text-zinc-500" />
              Custom Instructions (optional)
            </label>
            <textarea
              value={options.customInstructions}
              onChange={e => onChange({ ...options, customInstructions: e.target.value })}
              placeholder='e.g. "Keep the background 2D cartoon style", "Do not change colors", "Make the CTA more shiny"...'
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 focus:border-amber-500 focus:outline-none resize-none h-16"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-between">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs text-zinc-500 hover:text-white border border-zinc-700 rounded-lg transition-colors">
            Cancel
          </button>
          <button
            onClick={onApply}
            className="px-5 py-2 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/20"
          >
            <i className="fa-solid fa-wand-magic-sparkles" />
            Apply Fine Tune
          </button>
        </div>
      </div>
    </div>
  );
};

export const BannerSparklePanel: React.FC = () => {
  const { project, setStage, updateComposition } = useBanner();
  const [sparklingId, setSparklingId] = useState<string | null>(null);
  const [sparklingAll, setSparklingAll] = useState(false);
  const [sparkleProgress, setSparkleProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [beforeImages, setBeforeImages] = useState<Record<string, string>>({});
  const [lightboxId, setLightboxId] = useState<string | null>(null);

  // Fine tune options — persisted across uses in this session
  const [fineTuneOptions, setFineTuneOptions] = useState<FineTuneOptions>({ ...DEFAULT_FINE_TUNE });
  // Which action triggered the config popup: null (closed), 'all', or a comp ID
  const [configTarget, setConfigTarget] = useState<string | null>(null);

  const compositions = project?.compositions.filter(c => c.status !== 'pending' && c.layers.length > 0) ?? [];

  // Open config and auto-populate layers from the target composition
  const openConfig = useCallback((target: string) => {
    // Get layers from target comp (or first comp for "all")
    const comp = target === 'all'
      ? compositions[0]
      : compositions.find(c => c.id === target);
    if (comp) {
      const layerNames = comp.layers.filter(l => l.visible).map(l => l.name);
      setFineTuneOptions(prev => ({
        ...prev,
        enhanceLayers: layerNames,
        protectLayers: [],
      }));
    }
    setConfigTarget(target);
  }, [compositions]);

  // Get layers for the config popup
  const configLayers = useMemo(() => {
    if (!configTarget) return [];
    const comp = configTarget === 'all'
      ? compositions[0]
      : compositions.find(c => c.id === configTarget);
    return comp?.layers ?? [];
  }, [configTarget, compositions]);

  // Render "before" images
  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      for (const comp of compositions) {
        if (beforeImages[comp.id]) continue;
        try {
          const dataUrl = await renderCompositionToDataUrl(comp);
          if (cancelled) return;
          setBeforeImages(prev => ({ ...prev, [comp.id]: dataUrl }));
        } catch { /* skip */ }
      }
    };
    render();
    return () => { cancelled = true; };
  }, [compositions.map(c => c.id).join(',')]); // eslint-disable-line

  // Apply fine tune to a single composition
  const beforeImagesRef = useRef(beforeImages);
  beforeImagesRef.current = beforeImages;

  const doFineTuneSingle = useCallback(async (comp: BannerComposition, opts: FineTuneOptions) => {
    setSparklingId(comp.id);
    setError(null);
    try {
      // Always use the original "before" image (not the sparkled one)
      let before = beforeImagesRef.current[comp.id];
      if (!before) {
        before = await renderCompositionToDataUrl(comp);
        setBeforeImages(prev => ({ ...prev, [comp.id]: before }));
      }
      const sparkled = await sparkleBanner(before, opts);
      updateComposition(comp.id, { sparkleDataUrl: sparkled });
    } catch (err: any) {
      console.error('Fine tune failed:', err);
      setError(`Fine tune failed for ${comp.name}: ${err.message}`);
    } finally {
      setSparklingId(null);
    }
  }, [updateComposition]);

  // Apply fine tune to all compositions
  const doFineTuneAll = useCallback(async (opts: FineTuneOptions) => {
    setSparklingAll(true);
    setSparkleProgress(0);
    setError(null);

    for (let i = 0; i < compositions.length; i++) {
      const comp = compositions[i];
      setSparklingId(comp.id);
      try {
        let before = beforeImagesRef.current[comp.id];
        if (!before) {
          before = await renderCompositionToDataUrl(comp);
          setBeforeImages(prev => ({ ...prev, [comp.id]: before }));
        }
        const sparkled = await sparkleBanner(before, opts);
        updateComposition(comp.id, { sparkleDataUrl: sparkled });
      } catch (err: any) {
        console.error(`Fine tune failed for ${comp.name}:`, err);
      }
      setSparkleProgress(((i + 1) / compositions.length) * 100);
    }

    setSparklingId(null);
    setSparklingAll(false);
  }, [compositions, updateComposition, beforeImages]);

  // Config popup confirmed → run the action
  const handleConfigApply = useCallback(() => {
    const target = configTarget;
    setConfigTarget(null);
    if (!target) return;

    if (target === 'all') {
      doFineTuneAll(fineTuneOptions);
    } else {
      const comp = compositions.find(c => c.id === target);
      if (comp) doFineTuneSingle(comp, fineTuneOptions);
    }
  }, [configTarget, fineTuneOptions, compositions, doFineTuneAll, doFineTuneSingle]);

  const handleClearSparkle = useCallback((compId: string) => {
    updateComposition(compId, { sparkleDataUrl: undefined });
  }, [updateComposition]);

  const sparkledCount = compositions.filter(c => c.sparkleDataUrl).length;
  const lightboxComp = lightboxId ? compositions.find(c => c.id === lightboxId) : null;
  const configTargetLabel = configTarget === 'all'
    ? `All ${compositions.length} banners`
    : compositions.find(c => c.id === configTarget)?.name || '';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-5xl mx-auto flex flex-col gap-6">

          {/* Header */}
          <div className="text-center">
            <h2 className="text-xl font-bold text-white mb-1">
              <i className="fa-solid fa-wand-magic-sparkles text-amber-400 mr-2" />
              Fine Tune — Final Polish
            </h2>
            <p className="text-zinc-400 text-sm">
              AI enhances your banners with professional rendering. Choose which enhancements to apply.
              <br />
              <span className="text-zinc-500 text-xs">Click any banner to see it enlarged.</span>
            </p>
          </div>

          {/* Fine Tune All button */}
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => openConfig('all')}
              disabled={sparklingAll || sparklingId !== null}
              className={`px-6 py-3 text-sm font-medium rounded-xl transition-all shadow-lg flex items-center gap-2 ${
                !sparklingAll && sparklingId === null
                  ? 'bg-gradient-to-r from-amber-600 to-orange-500 hover:from-amber-500 hover:to-orange-400 text-white shadow-amber-600/20'
                  : 'bg-zinc-700 text-zinc-500 cursor-not-allowed shadow-none'
              }`}
            >
              {sparklingAll ? (
                <><i className="fa-solid fa-spinner fa-spin" /> Fine tuning all... {Math.round(sparkleProgress)}%</>
              ) : (
                <><i className="fa-solid fa-wand-magic-sparkles" /> Fine Tune All ({compositions.length})</>
              )}
            </button>
            {sparkledCount > 0 && (
              <span className="text-xs text-emerald-400">
                <i className="fa-solid fa-check mr-1" />
                {sparkledCount}/{compositions.length} done
              </span>
            )}
          </div>

          {/* Progress bar */}
          {sparklingAll && (
            <div className="flex items-center gap-3 px-4 py-3 bg-zinc-800/60 rounded-lg border border-zinc-700/50">
              <i className="fa-solid fa-spinner fa-spin text-amber-400" />
              <div className="flex-1">
                <div className="flex justify-between text-xs text-zinc-400 mb-1">
                  <span>Fine tuning...</span>
                  <span>{Math.round(sparkleProgress)}%</span>
                </div>
                <div className="h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-amber-500 to-orange-400 rounded-full transition-all duration-300" style={{ width: `${sparkleProgress}%` }} />
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-4 py-3 bg-red-900/20 border border-red-800/40 rounded-lg text-sm text-red-400">
              <i className="fa-solid fa-circle-exclamation" />
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)} className="text-red-500 hover:text-red-300"><i className="fa-solid fa-xmark" /></button>
            </div>
          )}

          {/* Composition grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {compositions.map(comp => {
              const isProcessing = sparklingId === comp.id;
              const hasSparkle = !!comp.sparkleDataUrl;
              const beforeUrl = beforeImages[comp.id];

              return (
                <div key={comp.id} className={`bg-zinc-900/50 rounded-xl border overflow-hidden transition-all ${
                  isProcessing ? 'border-amber-600/40' : hasSparkle ? 'border-emerald-600/30' : 'border-zinc-800'
                }`}>
                  <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-zinc-300">{comp.name}</span>
                      <span className="text-[9px] text-zinc-600">{comp.width}×{comp.height}</span>
                    </div>
                    {hasSparkle && (
                      <span className="text-[9px] px-2 py-0.5 rounded-full bg-emerald-600/20 text-emerald-400 font-medium">
                        <i className="fa-solid fa-sparkles mr-1" />Fine Tuned
                      </span>
                    )}
                  </div>

                  <button className="w-full flex items-center justify-center gap-2 p-3 bg-zinc-950/50 cursor-pointer hover:bg-zinc-900/50 transition-colors" onClick={() => setLightboxId(comp.id)} title="Click to enlarge">
                    {hasSparkle && beforeUrl ? (
                      <>
                        <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
                          <span className="text-[9px] text-zinc-600 uppercase">Before</span>
                          <img src={beforeUrl} alt="Before" className="w-full rounded border border-zinc-700/30 opacity-70" style={{ maxHeight: 120, objectFit: 'contain' }} />
                        </div>
                        <i className="fa-solid fa-arrow-right text-zinc-700 text-[10px] shrink-0" />
                        <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
                          <span className="text-[9px] text-amber-400 uppercase font-medium">After</span>
                          <img src={comp.sparkleDataUrl!} alt="After" className="w-full rounded border border-amber-600/20" style={{ maxHeight: 120, objectFit: 'contain' }} />
                        </div>
                      </>
                    ) : beforeUrl ? (
                      <img src={beforeUrl} alt="Preview" className="rounded border border-zinc-700/30" style={{ maxHeight: 140, maxWidth: '100%', objectFit: 'contain' }} />
                    ) : (
                      <div className="flex items-center justify-center h-28 w-full">
                        <span className="text-zinc-700 text-xs">
                          {isProcessing ? <><i className="fa-solid fa-spinner fa-spin text-amber-400 mr-2" />Processing...</> : 'Rendering preview...'}
                        </span>
                      </div>
                    )}
                  </button>

                  <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-zinc-800">
                    {hasSparkle && (
                      <button onClick={() => handleClearSparkle(comp.id)} className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">
                        <i className="fa-solid fa-trash mr-1" />Clear
                      </button>
                    )}
                    <button
                      onClick={() => openConfig(comp.id)}
                      disabled={isProcessing || sparklingAll}
                      className={`px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg transition-all flex items-center gap-1 ${
                        !isProcessing && !sparklingAll
                          ? 'bg-amber-600 hover:bg-amber-500 text-white'
                          : 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
                      }`}
                    >
                      {isProcessing ? (
                        <><i className="fa-solid fa-spinner fa-spin" /> Processing...</>
                      ) : hasSparkle ? (
                        <><i className="fa-solid fa-redo" /> Re-tune</>
                      ) : (
                        <><i className="fa-solid fa-wand-magic-sparkles" /> Fine Tune</>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Config popup */}
      {configTarget && (
        <FineTuneConfigPopup
          layers={configLayers}
          options={fineTuneOptions}
          onChange={setFineTuneOptions}
          onApply={handleConfigApply}
          onCancel={() => setConfigTarget(null)}
          targetLabel={configTargetLabel}
        />
      )}

      {/* Lightbox */}
      {lightboxComp && (
        <div className="fixed inset-0 z-[90] bg-black/90 flex items-center justify-center p-8 cursor-pointer" onClick={() => setLightboxId(null)}>
          <div className="relative max-w-[90vw] max-h-[85vh] flex flex-col items-center gap-4" onClick={e => e.stopPropagation()}>
            <button onClick={() => setLightboxId(null)} className="absolute -top-2 -right-2 z-10 w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white flex items-center justify-center">
              <i className="fa-solid fa-xmark" />
            </button>
            <div className="text-center text-sm text-zinc-400 mb-1">
              <span className="font-medium text-white">{lightboxComp.name}</span>
              <span className="text-zinc-600 ml-2">{lightboxComp.width}×{lightboxComp.height}</span>
            </div>
            {lightboxComp.sparkleDataUrl && beforeImages[lightboxComp.id] ? (
              <div className="flex items-start gap-6 overflow-auto">
                <div className="flex flex-col items-center gap-2">
                  <span className="text-xs text-zinc-500 uppercase tracking-wider">Before</span>
                  <img src={beforeImages[lightboxComp.id]} alt="Before" className="rounded-lg border border-zinc-700/50 shadow-2xl" style={{ maxHeight: '70vh', maxWidth: '42vw', objectFit: 'contain' }} />
                </div>
                <div className="flex flex-col items-center gap-2">
                  <span className="text-xs text-amber-400 uppercase tracking-wider font-medium">After — Fine Tuned</span>
                  <img src={lightboxComp.sparkleDataUrl} alt="After" className="rounded-lg border border-amber-600/30 shadow-2xl" style={{ maxHeight: '70vh', maxWidth: '42vw', objectFit: 'contain' }} />
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <span className="text-xs text-zinc-500 uppercase tracking-wider">Preview</span>
                <img src={beforeImages[lightboxComp.id] || ''} alt="Preview" className="rounded-lg border border-zinc-700/50 shadow-2xl" style={{ maxHeight: '75vh', maxWidth: '85vw', objectFit: 'contain' }} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bottom bar */}
      <div className="shrink-0 flex items-center justify-between px-6 py-3 bg-zinc-900/80 border-t border-zinc-800">
        <button onClick={() => setStage('edit')} className="px-4 py-2 text-sm text-zinc-400 hover:text-white border border-zinc-700 rounded-lg transition-colors">
          <i className="fa-solid fa-arrow-left mr-2" />Back to Editor
        </button>
        <button onClick={() => setStage('export')} className="px-6 py-2.5 text-sm font-medium bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-all shadow-lg shadow-cyan-600/20">
          Continue to Export<i className="fa-solid fa-arrow-right ml-2" />
        </button>
      </div>
    </div>
  );
};
