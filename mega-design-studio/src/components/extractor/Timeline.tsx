import React, { useRef, useState, useEffect } from 'react';
import { VideoSegment, TimeFormat } from '@/types';

interface TimelineProps {
  duration: number;
  currentTime: number;
  segments: VideoSegment[];
  onSeek: (time: number) => void;
  onAddSegment: (start: number, end: number) => void;
  onUpdateSegment: (id: string, start: number, end: number) => void;
  onSelectSegment: (id: string) => void;
  activeSegmentId: string | null;
  isPlaying: boolean;
  onTogglePlay: () => void;
  keyframes?: number[];
  timeFormat?: TimeFormat;
}

const MIN_SEGMENT_DURATION = 0.5;

const Timeline: React.FC<TimelineProps> = ({
  duration, currentTime, segments, onSeek, onUpdateSegment, onSelectSegment,
  activeSegmentId, isPlaying, onTogglePlay, keyframes, timeFormat
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [interaction, setInteraction] = useState<{
    type: 'scrub' | 'move' | 'resizeStart' | 'resizeEnd';
    segmentId?: string;
    startX: number;
    initialStart?: number;
    initialEnd?: number;
  } | null>(null);

  const getTimeFromX = (clientX: number) => {
    if (!containerRef.current) return 0;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    return (x / rect.width) * duration;
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!interaction || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const deltaPixels = e.clientX - interaction.startX;
      const deltaSeconds = (deltaPixels / rect.width) * duration;

      if (interaction.type === 'scrub') {
        onSeek(getTimeFromX(e.clientX));
      } else if (interaction.segmentId) {
        const segment = segments.find(s => s.id === interaction.segmentId);
        if (!segment) return;

        if (interaction.type === 'move') {
          let newStart = (interaction.initialStart || 0) + deltaSeconds;
          let newEnd = (interaction.initialEnd || 0) + deltaSeconds;
          const dur = newEnd - newStart;
          if (newStart < 0) { newStart = 0; newEnd = dur; }
          if (newEnd > duration) { newEnd = duration; newStart = newEnd - dur; }
          onUpdateSegment(segment.id, newStart, newEnd);
        } else if (interaction.type === 'resizeStart') {
          let newStart = (interaction.initialStart || 0) + deltaSeconds;
          newStart = Math.max(0, Math.min(newStart, segment.end - MIN_SEGMENT_DURATION));
          onUpdateSegment(segment.id, newStart, segment.end);
        } else if (interaction.type === 'resizeEnd') {
          let newEnd = (interaction.initialEnd || 0) + deltaSeconds;
          newEnd = Math.min(duration, Math.max(newEnd, segment.start + MIN_SEGMENT_DURATION));
          onUpdateSegment(segment.id, segment.start, newEnd);
        }
      }
    };
    const handleMouseUp = () => setInteraction(null);

    if (interaction) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [interaction, duration, segments, onSeek, onUpdateSegment]);

  const handleMouseDown = (e: React.MouseEvent, type: 'scrub' | 'move' | 'resizeStart' | 'resizeEnd', segmentId?: string) => {
    if (segmentId) onSelectSegment(segmentId);
    if (type === 'scrub') onSeek(getTimeFromX(e.clientX));
    const segment = segmentId ? segments.find(s => s.id === segmentId) : undefined;
    setInteraction({ type, segmentId, startX: e.clientX, initialStart: segment?.start, initialEnd: segment?.end });
    e.stopPropagation();
  };

  const formatTime = (time: number) => {
    if (timeFormat === 'frames') {
      return `${Math.round(time * 30)}f`;
    }
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    const cs = Math.floor((time % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
  };

  const ticks = [];
  const tickCount = 10;
  for (let i = 0; i <= tickCount; i++) ticks.push((duration / tickCount) * i);

  return (
    <div className="flex flex-col gap-2 select-none">
      <div className="flex justify-between items-center px-1 mb-2">
        <div className="flex items-center gap-3">
          <button onClick={onTogglePlay} className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-white hover:text-black flex items-center justify-center transition-colors shadow-lg" title={isPlaying ? "Pause" : "Play"}>
            <i className={`fas fa-${isPlaying ? 'pause' : 'play'} text-xs`}></i>
          </button>
          <div className="text-xs font-mono text-zinc-400">
            <span className="text-indigo-400 font-bold">{formatTime(currentTime)}</span>
            <span className="opacity-50 mx-1">/</span>
            {formatTime(duration)}
          </div>
        </div>
      </div>

      <div className="relative h-24" ref={containerRef}>
        {/* Time Ruler */}
        <div className="h-6 w-full bg-zinc-800/50 border-b border-zinc-700 relative cursor-pointer hover:bg-zinc-800 transition-colors" onMouseDown={(e) => handleMouseDown(e, 'scrub')}>
          {ticks.map((t, i) => (
            <div key={i} className="absolute bottom-0 h-2 w-px bg-zinc-500" style={{ left: `${(t / duration) * 100}%` }}>
              <span className="absolute -top-4 -left-3 text-[9px] text-zinc-500 font-mono">{formatTime(t)}</span>
            </div>
          ))}
          {keyframes?.map((t, i) => (
            <div key={i} className="absolute top-2.5 w-2 h-2 bg-yellow-400 rounded-full z-30 transform -translate-x-1/2 border border-black shadow-sm pointer-events-none" style={{ left: `${(t / duration) * 100}%` }} />
          ))}
        </div>

        {/* Track Area */}
        <div className="absolute top-6 bottom-0 left-0 right-0 bg-zinc-900 overflow-hidden cursor-crosshair" onMouseDown={(e) => handleMouseDown(e, 'scrub')}>
          {ticks.map((t, i) => (
            <div key={i} className="absolute top-0 bottom-0 w-px bg-white/5" style={{ left: `${(t / duration) * 100}%` }} />
          ))}
          {segments.map(seg => {
            const isActive = activeSegmentId === seg.id;
            const width = ((seg.end - seg.start) / duration) * 100;
            const left = (seg.start / duration) * 100;
            return (
              <div key={seg.id} className={`absolute top-2 bottom-2 rounded-md overflow-visible group transition-colors ${isActive ? 'bg-indigo-600 z-10' : 'bg-zinc-700 hover:bg-zinc-600'}`} style={{ left: `${left}%`, width: `${width}%` }} onMouseDown={(e) => handleMouseDown(e, 'move', seg.id)}>
                <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white/80 pointer-events-none truncate px-2">{seg.description || "CLIP"}</div>
                <div className={`absolute inset-y-0 -left-1 w-3 cursor-ew-resize hover:bg-white/20 z-20 flex items-center justify-center ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} onMouseDown={(e) => handleMouseDown(e, 'resizeStart', seg.id)}>
                  <div className="w-1 h-4 bg-white/50 rounded-full" />
                </div>
                <div className={`absolute inset-y-0 -right-1 w-3 cursor-ew-resize hover:bg-white/20 z-20 flex items-center justify-center ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} onMouseDown={(e) => handleMouseDown(e, 'resizeEnd', seg.id)}>
                  <div className="w-1 h-4 bg-white/50 rounded-full" />
                </div>
                {isActive && <div className="absolute inset-0 border border-white/50 rounded-md pointer-events-none" />}
              </div>
            );
          })}
        </div>

        {/* Playhead */}
        <div className="absolute top-0 bottom-0 w-px bg-red-500 z-50 pointer-events-none" style={{ left: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}>
          <div className="absolute -top-1 -left-1.5 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[8px] border-t-red-500" />
          <div className="absolute top-0 bottom-0 w-px bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
        </div>
      </div>
    </div>
  );
};

export default Timeline;
