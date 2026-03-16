import React, { useRef, useEffect, useState } from 'react';

interface ClipTrimmerProps {
  duration: number;
  trimStart: number;
  trimEnd: number;
  onTrimChange: (start: number, end: number) => void;
  onScrub: (time: number) => void;
  currentTime: number;
}

export const ClipTrimmer: React.FC<ClipTrimmerProps> = ({
  duration, trimStart, trimEnd, onTrimChange, onScrub, currentTime,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'start' | 'end' | 'playhead' | null>(null);

  const getPercentage = (time: number) => Math.min(100, Math.max(0, (time / duration) * 100));

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging || !containerRef.current || duration === 0) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const newTime = (x / rect.width) * duration;

      if (dragging === 'start') {
        const newStart = Math.min(newTime, trimEnd - 0.5);
        onTrimChange(newStart, trimEnd);
        onScrub(newStart);
      } else if (dragging === 'end') {
        const newEnd = Math.max(newTime, trimStart + 0.5);
        onTrimChange(trimStart, newEnd);
        onScrub(newEnd);
      } else if (dragging === 'playhead') {
        const clampedTime = Math.max(trimStart, Math.min(newTime, trimEnd));
        onScrub(clampedTime);
      }
    };
    const handleMouseUp = () => setDragging(null);
    if (dragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, duration, trimStart, trimEnd, onTrimChange, onScrub]);

  const leftPos = getPercentage(trimStart);
  const rightPos = getPercentage(trimEnd);
  const playheadPos = getPercentage(currentTime);

  return (
    <div className="flex flex-col gap-2 w-full select-none">
      <div className="flex justify-between text-[10px] font-mono text-zinc-500 uppercase font-bold">
        <span>In: {trimStart.toFixed(2)}s</span>
        <span>Dur: {(trimEnd - trimStart).toFixed(2)}s</span>
        <span>Out: {trimEnd.toFixed(2)}s</span>
      </div>

      <div
        ref={containerRef}
        className="relative h-12 bg-zinc-900 rounded-md border border-zinc-800 overflow-hidden cursor-pointer"
        onMouseDown={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const t = (x / rect.width) * duration;
          onScrub(Math.max(trimStart, Math.min(t, trimEnd)));
          setDragging('playhead');
        }}
      >
        {/* Waveform simulation */}
        <div className="absolute inset-0 flex items-center gap-0.5 opacity-20 px-1">
          {Array.from({ length: 40 }).map((_, i) => (
            <div key={i} className="flex-1 bg-zinc-500 rounded-full" style={{ height: `${20 + Math.sin(i * 0.7) * 30 + 20}%` }} />
          ))}
        </div>

        {/* Dimmed areas */}
        <div className="absolute top-0 bottom-0 left-0 bg-black/60 backdrop-blur-[1px] z-10" style={{ width: `${leftPos}%` }} />
        <div className="absolute top-0 bottom-0 right-0 bg-black/60 backdrop-blur-[1px] z-10" style={{ left: `${rightPos}%` }} />

        {/* Active area border */}
        <div
          className="absolute top-0 bottom-0 border-t-2 border-b-2 border-indigo-500 z-10 pointer-events-none"
          style={{ left: `${leftPos}%`, width: `${rightPos - leftPos}%` }}
        />

        {/* Playhead */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-white z-20 shadow-[0_0_10px_rgba(255,255,255,0.5)]"
          style={{ left: `${playheadPos}%` }}
        >
          <div className="absolute -top-1 -left-1.5 w-3 h-3 bg-white rotate-45 transform" />
        </div>

        {/* Left Handle */}
        <div
          className="absolute top-0 bottom-0 w-4 bg-indigo-600 hover:bg-indigo-500 cursor-ew-resize z-30 flex items-center justify-center rounded-l-sm group transition-colors"
          style={{ left: `${leftPos}%`, transform: 'translateX(-100%)' }}
          onMouseDown={(e) => { e.stopPropagation(); setDragging('start'); }}
        >
          <div className="w-0.5 h-4 bg-white/50 group-hover:bg-white rounded-full" />
          <div className="absolute -top-8 bg-zinc-800 text-white text-[9px] px-2 py-1 rounded font-mono opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap border border-zinc-700">
            {trimStart.toFixed(2)}s
          </div>
        </div>

        {/* Right Handle */}
        <div
          className="absolute top-0 bottom-0 w-4 bg-indigo-600 hover:bg-indigo-500 cursor-ew-resize z-30 flex items-center justify-center rounded-r-sm group transition-colors"
          style={{ left: `${rightPos}%` }}
          onMouseDown={(e) => { e.stopPropagation(); setDragging('end'); }}
        >
          <div className="w-0.5 h-4 bg-white/50 group-hover:bg-white rounded-full" />
          <div className="absolute -top-8 bg-zinc-800 text-white text-[9px] px-2 py-1 rounded font-mono opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap border border-zinc-700">
            {trimEnd.toFixed(2)}s
          </div>
        </div>
      </div>
      <p className="text-[10px] text-zinc-600 text-center">Drag purple handles to trim start/end points</p>
    </div>
  );
};
