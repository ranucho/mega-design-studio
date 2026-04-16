import React, { useRef, useEffect, useState, useMemo } from 'react';
import { useBanner } from '@/contexts/BannerContext';
import { BannerComposition } from '@/types';

interface BannerCompositionGridProps {
  onSelect: (id: string) => void;
  selectedId: string | null;
  /** Gallery mode: shows all banners in a zoomable grid. Click opens compositor. */
  galleryMode?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-zinc-500',
  generating: 'bg-amber-400 animate-pulse',
  ready: 'bg-cyan-400',
  edited: 'bg-green-400',
  approved: 'bg-emerald-400',
  error: 'bg-red-500',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Queued',
  generating: 'Generating…',
  ready: 'Ready',
  edited: 'Edited',
  approved: 'Approved',
  error: 'Failed',
};

// Mini canvas thumbnail renderer
const CompThumbnail: React.FC<{ composition: BannerComposition; width: number; height: number; contain?: boolean }> = ({ composition, width, height, contain }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scale = Math.min(width / composition.width, height / composition.height);

    let pending = 0;
    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      if (contain) {
        ctx.fillStyle = '#18181b';
        ctx.fillRect(0, 0, width, height);
        const renderW = composition.width * scale;
        const renderH = composition.height * scale;
        const offsetX = (width - renderW) / 2;
        const offsetY = (height - renderH) / 2;
        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);
      } else {
        ctx.save();
        ctx.scale(scale, scale);
      }

      ctx.fillStyle = composition.backgroundColor || '#000';
      ctx.fillRect(0, 0, composition.width, composition.height);
      // Clip to composition bounds so layers don't bleed outside
      ctx.beginPath();
      ctx.rect(0, 0, composition.width, composition.height);
      ctx.clip();

      for (const layer of composition.layers) {
        if (!layer.visible) continue;
        ctx.save();
        ctx.globalAlpha = layer.opacity;

        if (layer.type === 'image' && layer.src) {
          let img = imageCacheRef.current.get(layer.id);
          if (!img || img.src !== layer.src) {
            img = new Image();
            img.src = layer.src;
            imageCacheRef.current.set(layer.id, img);
            pending++;
            img.onload = () => {
              pending--;
              if (pending === 0) draw();
            };
          }
          if (img.complete && img.naturalWidth > 0) {
            const dw = layer.nativeWidth * layer.scaleX;
            const dh = layer.nativeHeight * layer.scaleY;
            ctx.drawImage(img, layer.x, layer.y, dw, dh);
          }
        } else if (layer.type === 'text') {
          const fontSize = layer.fontSize || 24;
          ctx.font = `${layer.fontWeight || 700} ${fontSize}px ${layer.fontFamily || 'sans-serif'}`;
          ctx.fillStyle = layer.fontColor || '#ffffff';
          ctx.textBaseline = 'top';
          ctx.fillText(layer.text || '', layer.x, layer.y);
        }

        ctx.restore();
      }
      ctx.restore();
    };

    draw();
  }, [composition, width, height]);

  return <canvas ref={canvasRef} width={width} height={height} className="rounded" />;
};

// ── Strip mode (bottom bar, horizontal scroll) ──

const StripView: React.FC<BannerCompositionGridProps> = ({ onSelect, selectedId }) => {
  const { project } = useBanner();
  if (!project) return null;

  const compositions = project.compositions;
  if (compositions.length === 0) return null;

  const readyCount = compositions.filter(c => c.status === 'ready' || c.status === 'edited' || c.status === 'approved').length;
  const generatingCount = compositions.filter(c => c.status === 'generating').length;

  return (
    <div className="flex flex-col">
      {generatingCount > 0 && (
        <div
          className="flex items-center gap-2 px-3 py-1.5 text-xs text-amber-300 bg-amber-500/5 border-b border-zinc-800 tabular-nums"
          role="status"
          aria-live="polite"
        >
          <i className="fa-solid fa-spinner fa-spin text-xs" />
          Generating {readyCount} of {compositions.length}
        </div>
      )}
      <div className="flex gap-2 overflow-x-auto p-2">
        {compositions.map(comp => {
          const isActive = comp.id === selectedId;
          const aspect = comp.width / comp.height;
          const thumbH = 60;
          const thumbW = Math.round(thumbH * aspect);

          return (
            <button
              key={comp.id}
              onClick={() => onSelect(comp.id)}
              className={`shrink-0 flex flex-col items-center gap-1 p-1.5 rounded-lg border transition-all ${
                isActive
                  ? 'border-cyan-600/60 bg-cyan-600/10'
                  : 'border-zinc-700/50 hover:border-zinc-600 bg-zinc-800/40'
              }`}
            >
              {comp.layers.length > 0 ? (
                <CompThumbnail
                  composition={comp}
                  width={Math.max(thumbW, 30)}
                  height={thumbH}
                />
              ) : (
                <div
                  className="rounded bg-zinc-900 border border-zinc-700/30 flex items-center justify-center"
                  style={{ width: Math.max(thumbW, 30), height: thumbH }}
                >
                  {comp.status === 'generating' && (
                    <i className="fa-solid fa-spinner fa-spin text-amber-400 text-xs" />
                  )}
                  {comp.status === 'error' && (
                    <i className="fa-solid fa-triangle-exclamation text-red-400 text-xs" title={comp.errorMessage || 'Generation failed'} />
                  )}
                </div>
              )}
              <div className="flex items-center gap-1">
                <div className={`w-1.5 h-1.5 rounded-full ${STATUS_COLORS[comp.status]}`} />
                <span className="text-xs text-zinc-400 tabular-nums">{comp.width}×{comp.height}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ── Gallery mode (full screen, zoomable, like Adobe Bridge) ──

const GalleryView: React.FC<BannerCompositionGridProps> = ({ onSelect }) => {
  const { project, removeComposition, updateComposition, generateCompositions } = useBanner();
  const [zoom, setZoom] = useState(50);

  const compositions = project?.compositions ?? [];

  // Zoom maps to a base row height: 10→80px, 50→180px, 100→340px.
  const rowH = Math.round(80 + (zoom / 100) * 260);

  // Sort: errors first, then generating, then by area desc
  const sorted = useMemo(() =>
    [...compositions].sort((a, b) => {
      const order: Record<string, number> = { error: 0, generating: 1 };
      const ao = order[a.status] ?? 2;
      const bo = order[b.status] ?? 2;
      if (ao !== bo) return ao - bo;
      return (b.width * b.height) - (a.width * a.height);
    }),
    [compositions],
  );

  if (!project) return null;

  const readyCount = compositions.filter(c => c.status !== 'pending' && c.status !== 'generating' && c.status !== 'error').length;
  const generatingCount = compositions.filter(c => c.status === 'generating').length;
  const errorCount = compositions.filter(c => c.status === 'error').length;

  const handleRetry = (presetKey: string, compId: string) => {
    if (!presetKey) return;
    removeComposition(compId);
    generateCompositions({ onlyKeys: [presetKey] });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-4 px-4 py-2 bg-zinc-900/60 border-b border-zinc-800">
        <div
          className="flex items-center gap-3 text-xs text-zinc-300 tabular-nums"
          role="status"
          aria-live="polite"
        >
          <i className="fa-solid fa-grid-2 text-zinc-400" />
          <span className="font-medium">{compositions.length} banners</span>
          {generatingCount > 0 && (
            <span className="text-amber-300 flex items-center gap-1">
              <i className="fa-solid fa-spinner fa-spin text-xs" />
              {generatingCount} generating
            </span>
          )}
          {readyCount > 0 && (
            <span className="text-cyan-300">{readyCount} ready</span>
          )}
          {errorCount > 0 && (
            <span className="text-red-400">{errorCount} failed</span>
          )}
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-2">
          <i className="fa-solid fa-image text-zinc-400 text-xs" />
          <input
            type="range"
            min={10}
            max={100}
            value={zoom}
            onChange={e => setZoom(Number(e.target.value))}
            className="w-28 accent-cyan-500"
            aria-label="Thumbnail size"
            title={`Row height: ${rowH}px`}
          />
          <i className="fa-solid fa-image text-zinc-400 text-sm" />
        </div>
      </div>

      {/* Gallery grid — tiles render at natural aspect ratio, shared row height */}
      <div className="flex-1 overflow-auto p-4">
        {compositions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-400 text-sm gap-2">
            <i className="fa-solid fa-image text-3xl text-zinc-600" />
            <p>Nothing generated yet.</p>
            <p className="text-xs">Pick sizes and hit Generate.</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3 content-start">
            {sorted.map(comp => {
              const aspect = comp.width / comp.height;
              // Clamp aspect so extreme sizes (e.g. 728×90) don't explode row width
              const clampedAspect = Math.max(0.4, Math.min(3.5, aspect));
              const tileW = Math.round(rowH * clampedAspect);
              const isError = comp.status === 'error';
              const isGenerating = comp.status === 'generating';
              const isLocked = !!comp.locked;

              return (
                <div
                  key={comp.id}
                  className="flex flex-col shrink-0"
                  style={{ width: Math.max(tileW, 120) }}
                >
                  <button
                    onClick={() => !isError && !isGenerating && onSelect(comp.id)}
                    disabled={isGenerating}
                    className={`group relative flex items-center justify-center rounded-xl border overflow-hidden transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 ${
                      isError
                        ? 'border-red-600/50 bg-red-900/10'
                        : 'border-zinc-700/50 bg-zinc-800/40 hover:border-cyan-600/50 hover:bg-cyan-600/5'
                    }`}
                    style={{ width: Math.max(tileW, 120), height: rowH }}
                    title={isError ? comp.errorMessage : `${comp.name} · ${comp.width}×${comp.height}`}
                  >
                    {comp.layers.length > 0 ? (
                      <CompThumbnail
                        composition={comp}
                        width={Math.max(tileW, 120)}
                        height={rowH}
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center w-full h-full gap-2 px-2 text-center">
                        {isGenerating && <i className="fa-solid fa-spinner fa-spin text-amber-400 text-xl" />}
                        {isError && (
                          <>
                            <i className="fa-solid fa-triangle-exclamation text-red-400 text-xl" />
                            <span className="text-xs text-red-300">Generation failed</span>
                          </>
                        )}
                        {!isGenerating && !isError && <i className="fa-solid fa-image text-zinc-600 text-xl" />}
                      </div>
                    )}

                    {/* Hover overlay — only when viewable */}
                    {!isError && !isGenerating && (
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="text-white text-xs font-semibold bg-cyan-600 px-3 py-1.5 rounded-lg shadow-lg">
                          <i className="fa-solid fa-pen-ruler mr-1.5" />
                          Edit
                        </span>
                      </div>
                    )}

                    {/* Lock badge */}
                    {isLocked && !isError && (
                      <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded-md bg-zinc-900/80 text-zinc-300 text-xs flex items-center gap-1" title="Locked — won't be replaced by Match Layout">
                        <i className="fa-solid fa-lock text-xs" />
                      </div>
                    )}

                    {/* Per-tile actions — always accessible */}
                    <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                      {!isError && !isGenerating && (
                        <button
                          onClick={(e) => { e.stopPropagation(); updateComposition(comp.id, { locked: !comp.locked }); }}
                          className="w-6 h-6 rounded-full bg-zinc-900/90 hover:bg-zinc-800 text-zinc-300 hover:text-white flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                          title={isLocked ? 'Unlock' : 'Lock — protect from Match Layout'}
                        >
                          <i className={`fa-solid ${isLocked ? 'fa-lock' : 'fa-lock-open'} text-xs`} />
                        </button>
                      )}
                      {(isError || (!isGenerating && comp.presetKey)) && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRetry(comp.presetKey, comp.id); }}
                          className="w-6 h-6 rounded-full bg-cyan-600 hover:bg-cyan-500 text-white flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                          title="Regenerate this size"
                        >
                          <i className="fa-solid fa-arrows-rotate text-xs" />
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); removeComposition(comp.id); }}
                        className="w-6 h-6 rounded-full bg-red-600/90 hover:bg-red-500 text-white flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                        title="Remove this size"
                      >
                        <i className="fa-solid fa-trash text-xs" />
                      </button>
                    </div>
                  </button>

                  {/* Info bar */}
                  <div className="px-1 pt-1.5 flex items-center gap-1.5 min-w-0">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${STATUS_COLORS[comp.status]}`} />
                    <span className="text-xs text-zinc-300 font-medium truncate tabular-nums">{comp.width}×{comp.height}</span>
                    <span className="text-xs text-zinc-400 truncate ml-auto">{STATUS_LABELS[comp.status] || comp.status}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export const BannerCompositionGrid: React.FC<BannerCompositionGridProps> = (props) => {
  if (props.galleryMode) {
    return <GalleryView {...props} />;
  }
  return <StripView {...props} />;
};
