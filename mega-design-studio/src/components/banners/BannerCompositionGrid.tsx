import React, { useRef, useEffect } from 'react';
import { useBanner } from '@/contexts/BannerContext';
import { BannerComposition } from '@/types';

interface BannerCompositionGridProps {
  onSelect: (id: string) => void;
  selectedId: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-zinc-600',
  generating: 'bg-yellow-500 animate-pulse',
  ready: 'bg-cyan-500',
  edited: 'bg-green-500',
  approved: 'bg-emerald-500',
};

// Mini canvas thumbnail renderer
const CompThumbnail: React.FC<{ composition: BannerComposition; width: number; height: number }> = ({ composition, width, height }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scale = Math.min(width / composition.width, height / composition.height);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = composition.backgroundColor || '#000';
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.scale(scale, scale);

    // Load and draw image layers
    let pending = 0;
    const draw = () => {
      ctx.clearRect(0, 0, composition.width, composition.height);
      ctx.fillStyle = composition.backgroundColor || '#000';
      ctx.fillRect(0, 0, composition.width, composition.height);

      for (const layer of composition.layers) {
        if (!layer.visible) continue;
        ctx.save();
        ctx.globalAlpha = layer.opacity;

        if (layer.type === 'image' && layer.src) {
          let img = imageCacheRef.current.get(layer.id);
          if (!img) {
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
    };

    draw();
    ctx.restore();
  }, [composition, width, height]);

  return <canvas ref={canvasRef} width={width} height={height} className="rounded" />;
};

export const BannerCompositionGrid: React.FC<BannerCompositionGridProps> = ({ onSelect, selectedId }) => {
  const { project } = useBanner();
  if (!project) return null;

  const compositions = project.compositions;
  if (compositions.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-zinc-600 text-xs">
        No compositions generated yet
      </div>
    );
  }

  // Count ready / total
  const readyCount = compositions.filter(c => c.status === 'ready' || c.status === 'edited' || c.status === 'approved').length;
  const generatingCount = compositions.filter(c => c.status === 'generating').length;

  return (
    <div className="flex flex-col">
      {/* Status bar */}
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
                <span className="text-[9px] text-zinc-500">{comp.width}x{comp.height}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
