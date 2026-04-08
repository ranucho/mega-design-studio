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
  pending: 'bg-zinc-600',
  generating: 'bg-yellow-500 animate-pulse',
  ready: 'bg-cyan-500',
  edited: 'bg-green-500',
  approved: 'bg-emerald-500',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  generating: 'Generating...',
  ready: 'Ready',
  edited: 'Edited',
  approved: 'Approved',
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
  if (compositions.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-zinc-400 text-xs">
        No compositions generated yet
      </div>
    );
  }

  const readyCount = compositions.filter(c => c.status === 'ready' || c.status === 'edited' || c.status === 'approved').length;
  const generatingCount = compositions.filter(c => c.status === 'generating').length;

  return (
    <div className="flex flex-col">
      {generatingCount > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-yellow-400 bg-yellow-500/5 border-b border-zinc-800">
          <i className="fa-solid fa-spinner fa-spin text-[10px]" />
          Generating layouts... {readyCount}/{compositions.length} ready
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
                    <i className="fa-solid fa-spinner fa-spin text-yellow-500 text-[9px]" />
                  )}
                </div>
              )}
              <div className="flex items-center gap-1">
                <div className={`w-1.5 h-1.5 rounded-full ${STATUS_COLORS[comp.status]}`} />
                <span className="text-[9px] text-zinc-400">{comp.width}x{comp.height}</span>
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
  const { project, removeComposition } = useBanner();
  const [zoom, setZoom] = useState(50); // 10-100 slider value → controls thumb size

  if (!project) return null;
  const compositions = project.compositions;

  // Zoom maps to a base thumbnail height: 10→60px, 50→180px, 100→400px
  const thumbBaseH = Math.round(60 + (zoom / 100) * 340);

  // Sort: generating first, then by dimensions
  const sorted = useMemo(() =>
    [...compositions].sort((a, b) => {
      if (a.status === 'generating' && b.status !== 'generating') return -1;
      if (b.status === 'generating' && a.status !== 'generating') return 1;
      return (b.width * b.height) - (a.width * a.height);
    }),
    [compositions],
  );

  const readyCount = compositions.filter(c => c.status !== 'pending' && c.status !== 'generating').length;
  const generatingCount = compositions.filter(c => c.status === 'generating').length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-4 px-4 py-2 bg-zinc-900/60 border-b border-zinc-800">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <i className="fa-solid fa-grid-2 text-zinc-400" />
          <span className="font-medium text-zinc-300">{compositions.length} Banners</span>
          {generatingCount > 0 && (
            <span className="text-yellow-400 flex items-center gap-1">
              <i className="fa-solid fa-spinner fa-spin text-[10px]" />
              {generatingCount} generating...
            </span>
          )}
          {readyCount > 0 && (
            <span className="text-cyan-400">{readyCount} ready</span>
          )}
        </div>

        <div className="flex-1" />

        {/* Zoom slider */}
        <div className="flex items-center gap-2">
          <i className="fa-solid fa-image text-zinc-400 text-[10px]" />
          <input
            type="range"
            min={10}
            max={100}
            value={zoom}
            onChange={e => setZoom(Number(e.target.value))}
            className="w-28 accent-cyan-500"
            title={`Thumbnail size: ${thumbBaseH}px`}
          />
          <i className="fa-solid fa-image text-zinc-400 text-sm" />
        </div>
      </div>

      {/* Gallery grid — Adobe Bridge style: show full images at natural aspect ratio */}
      <div className="flex-1 overflow-auto p-4">
        {compositions.length === 0 ? (
          <div className="flex items-center justify-center h-full text-zinc-400 text-sm">
            No compositions generated yet
          </div>
        ) : (
          <div className="flex flex-wrap gap-3 content-start">
            {sorted.map(comp => {
              // Each card has a fixed-size area; the thumbnail renders inside using object-contain
              const cardSize = thumbBaseH;

              return (
                <button
                  key={comp.id}
                  onClick={() => onSelect(comp.id)}
                  className="group flex flex-col shrink-0 rounded-xl border border-zinc-700/50 bg-zinc-800/40 hover:border-cyan-600/50 hover:bg-cyan-600/5 transition-all overflow-hidden"
                  style={{ width: cardSize + 16 }}
                >
                  {/* Thumbnail container — fixed square, image fits inside with contain */}
                  <div
                    className="relative flex items-center justify-center bg-zinc-950/50 p-1"
                    style={{ width: cardSize + 16, height: cardSize }}
                  >
                    {comp.layers.length > 0 ? (
                      <CompThumbnail
                        composition={comp}
                        width={cardSize + 14}
                        height={cardSize - 2}
                        contain
                      />
                    ) : (
                      <div className="flex items-center justify-center w-full h-full">
                        {comp.status === 'generating' ? (
                          <i className="fa-solid fa-spinner fa-spin text-yellow-500" />
                        ) : (
                          <i className="fa-solid fa-image text-zinc-700" />
                        )}
                      </div>
                    )}
                    {/* Hover overlay */}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="text-white text-xs font-medium bg-cyan-600 px-3 py-1.5 rounded-lg shadow-lg">
                        <i className="fa-solid fa-pen-ruler mr-1.5" />
                        Edit
                      </span>
                    </div>
                    {/* Delete button */}
                    <button
                      onClick={(e) => { e.stopPropagation(); removeComposition(comp.id); }}
                      className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-600/80 hover:bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                      title="Remove this size"
                    >
                      <i className="fa-solid fa-trash text-[9px]" />
                    </button>
                  </div>

                  {/* Info bar */}
                  <div className="px-2 py-1.5 flex items-center gap-1.5 min-w-0">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${STATUS_COLORS[comp.status]}`} />
                    <span className="text-[10px] text-zinc-400 font-medium truncate">{comp.width}×{comp.height}</span>
                    <span className="text-[9px] text-zinc-400 truncate ml-auto">{STATUS_LABELS[comp.status] || comp.status}</span>
                  </div>
                </button>
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
