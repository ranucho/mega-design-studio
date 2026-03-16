import React from 'react';
import { Crop } from '@/types';

interface CropOverlayProps {
  crop: Crop;
  onMouseDown: (e: React.MouseEvent, mode: string) => void;
}

const handles: { position: string; cursor: string; mode: string; style: React.CSSProperties }[] = [
  { position: 'nw', cursor: 'nwse-resize', mode: 'nw', style: { top: '-4px', left: '-4px' } },
  { position: 'n', cursor: 'ns-resize', mode: 'n', style: { top: '-4px', left: '50%', transform: 'translateX(-50%)' } },
  { position: 'ne', cursor: 'nesw-resize', mode: 'ne', style: { top: '-4px', right: '-4px' } },
  { position: 'e', cursor: 'ew-resize', mode: 'e', style: { top: '50%', right: '-4px', transform: 'translateY(-50%)' } },
  { position: 'se', cursor: 'nwse-resize', mode: 'se', style: { bottom: '-4px', right: '-4px' } },
  { position: 's', cursor: 'ns-resize', mode: 's', style: { bottom: '-4px', left: '50%', transform: 'translateX(-50%)' } },
  { position: 'sw', cursor: 'nesw-resize', mode: 'sw', style: { bottom: '-4px', left: '-4px' } },
  { position: 'w', cursor: 'ew-resize', mode: 'w', style: { top: '50%', left: '-4px', transform: 'translateY(-50%)' } },
];

export const CropOverlay: React.FC<CropOverlayProps> = ({ crop, onMouseDown }) => {
  return (
    <>
      {/* Darkened overlay outside crop */}
      <div className="absolute inset-0 pointer-events-none" style={{ clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 ${crop.y}%, ${crop.x}% ${crop.y}%, ${crop.x}% ${crop.y + crop.h}%, ${crop.x + crop.w}% ${crop.y + crop.h}%, ${crop.x + crop.w}% ${crop.y}%, 100% ${crop.y}%, 100% 100%, 0 100%)`, backgroundColor: 'rgba(0,0,0,0.6)' }} />

      {/* Crop border */}
      <div
        className="absolute border-2 border-white cursor-move z-10"
        style={{ left: `${crop.x}%`, top: `${crop.y}%`, width: `${crop.w}%`, height: `${crop.h}%` }}
        onMouseDown={(e) => { e.stopPropagation(); onMouseDown(e, 'move'); }}
      >
        {/* Grid lines */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/3 left-0 right-0 h-px bg-white/30" />
          <div className="absolute top-2/3 left-0 right-0 h-px bg-white/30" />
          <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/30" />
          <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/30" />
        </div>

        {/* Size display */}
        <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] bg-black/80 text-white px-2 py-0.5 rounded whitespace-nowrap">
          {crop.w.toFixed(0)}% x {crop.h.toFixed(0)}%
        </div>

        {/* Resize handles */}
        {handles.map(h => (
          <div
            key={h.position}
            className="absolute w-3 h-3 bg-white border border-zinc-400 rounded-sm z-20"
            style={{ ...h.style, cursor: h.cursor }}
            onMouseDown={(e) => { e.stopPropagation(); onMouseDown(e, h.mode); }}
          />
        ))}
      </div>
    </>
  );
};
