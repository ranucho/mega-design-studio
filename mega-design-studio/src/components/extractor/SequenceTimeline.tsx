import React, { useRef, useState, useEffect } from 'react';
import { GeneratedClip } from '@/types';

interface SequenceTimelineProps {
  clips: GeneratedClip[];
  activeClipId: string | null;
  onSelectClip: (id: string) => void;
  onUpdateClip: (id: string, updates: Partial<GeneratedClip>) => void;
  onDeleteClip: (id: string) => void;
  onReorderClips?: (fromId: string, toId: string) => void;
  onDropFromLibrary?: (clipId: string) => void;
  globalTime: number;
  onSeekGlobal: (time: number) => void;
  timeFormat?: 'seconds' | 'frames';
  onTimeFormatChange?: (format: 'seconds' | 'frames') => void;
}

const PPS = 40; // Pixels Per Second
const MIN_CLIP_DURATION = 0.5;
const THUMBNAIL_WIDTH = 80;
const TRACK_OFFSET = 16; // left padding matching MovieTab

export const SequenceTimeline: React.FC<SequenceTimelineProps> = ({
  clips, activeClipId, onSelectClip, onUpdateClip, onDeleteClip, onReorderClips, onDropFromLibrary,
  globalTime, onSeekGlobal, timeFormat = 'seconds', onTimeFormatChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [dragOverClipId, setDragOverClipId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{
    type: 'trimStart' | 'trimEnd';
    clipId: string;
    initialX: number;
    initialVal: number;
  } | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});

  const clipLayouts = clips.reduce((acc, clip) => {
    const duration = (clip.trimEnd - clip.trimStart) / (clip.speed || 1);
    const startTime = acc.length > 0 ? acc[acc.length - 1].endTime : 0;
    acc.push({ ...clip, startTime, duration, endTime: startTime + duration });
    return acc;
  }, [] as Array<GeneratedClip & { startTime: number; duration: number; endTime: number }>);

  const totalDuration = clipLayouts.length > 0 ? clipLayouts[clipLayouts.length - 1].endTime : 0;
  const totalWidth = Math.max(totalDuration * PPS, typeof window !== 'undefined' ? window.innerWidth : 800);

  // Playhead position in pixels
  const playheadPosPixels = globalTime * PPS;

  // Generate thumbnails from video clips
  useEffect(() => {
    clips.forEach(clip => {
      if (thumbnails[clip.id] || !clip.url) return;
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.preload = 'metadata';
      video.src = clip.url;
      video.onloadeddata = () => {
        video.currentTime = Math.min(0.5, video.duration / 2);
      };
      video.onseeked = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 160;
          canvas.height = 90;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const thumb = canvas.toDataURL('image/jpeg', 0.6);
            setThumbnails(prev => ({ ...prev, [clip.id]: thumb }));
          }
        } catch (e) {
          console.error('Thumbnail generation failed for clip', clip.id, e);
        }
      };
    });
  }, [clips]);

  const formatTime = (t: number) => {
    if (timeFormat === 'frames') return `${Math.round(t * 30)}f`;
    return `${Math.floor(t / 60)}:${Math.floor(t % 60).toString().padStart(2, '0')}`;
  };

  // Timeline seek (same approach as MovieTab)
  const handleTimelineSeek = (e: React.MouseEvent | MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const offsetX = (e as MouseEvent).clientX - rect.left + containerRef.current.scrollLeft;
    const time = Math.max(0, (offsetX - TRACK_OFFSET) / PPS);
    onSeekGlobal(Math.min(time, totalDuration));
  };

  const handleRulerMouseDown = (e: React.MouseEvent) => {
    setIsScrubbing(true);
    handleTimelineSeek(e);
  };

  // Trim + scrub mouse move/up
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isScrubbing) {
        e.preventDefault();
        handleTimelineSeek(e);
      } else if (dragging) {
        const clip = clips.find(c => c.id === dragging.clipId);
        if (!clip) return;
        const deltaPixels = e.clientX - dragging.initialX;
        const deltaContentSeconds = (deltaPixels / PPS) * (clip.speed || 1);

        if (dragging.type === 'trimStart') {
          const newStart = Math.min(Math.max(0, dragging.initialVal + deltaContentSeconds), clip.trimEnd - MIN_CLIP_DURATION);
          onUpdateClip(clip.id, { trimStart: newStart });
        } else {
          const newEnd = Math.max(Math.min(clip.originalDuration || 100, dragging.initialVal + deltaContentSeconds), clip.trimStart + MIN_CLIP_DURATION);
          onUpdateClip(clip.id, { trimEnd: newEnd });
        }
      }
    };
    const handleMouseUp = () => {
      setIsScrubbing(false);
      setDragging(null);
      document.body.style.cursor = 'default';
    };
    if (isScrubbing || dragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = isScrubbing ? 'grabbing' : 'ew-resize';
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
    };
  }, [isScrubbing, dragging, clips, onSeekGlobal, onUpdateClip]);

  return (
    <div className="flex flex-col h-full bg-[#1e1e2e] select-none">
      {/* Toolbar - matching MovieTab */}
      <div className="h-10 border-b border-zinc-800 flex items-center px-4 bg-[#181825] gap-4 justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-red-500 font-bold">{formatTime(globalTime)}</span>
          <span className="text-xs text-zinc-400">/</span>
          <span className="text-xs font-mono text-zinc-400">{formatTime(totalDuration)}</span>
        </div>
        <div className="flex items-center gap-4">
          {onTimeFormatChange && (
            <div className="flex bg-zinc-800 rounded p-0.5 border border-zinc-700">
              <button
                onClick={() => onTimeFormatChange('seconds')}
                className={`px-2 py-1 text-[9px] font-bold uppercase rounded ${timeFormat === 'seconds' ? 'bg-zinc-600 text-white' : 'text-zinc-400'}`}
              >SEC</button>
              <button
                onClick={() => onTimeFormatChange('frames')}
                className={`px-2 py-1 text-[9px] font-bold uppercase rounded ${timeFormat === 'frames' ? 'bg-zinc-600 text-white' : 'text-zinc-400'}`}
              >FRM</button>
            </div>
          )}
        </div>
      </div>

      {/* Timeline Area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-x-auto overflow-y-hidden relative select-none custom-scrollbar bg-[#11111b]"
      >
        <div
          style={{ width: `${Math.max(totalWidth + 300, window.innerWidth)}px`, height: '100%' }}
          className="relative"
        >
          {/* Ruler - matching MovieTab */}
          <div
            className="h-6 border-b border-zinc-700/50 flex items-end text-[10px] text-zinc-400 select-none bg-[#181825] sticky top-0 z-30"
            onMouseDown={handleRulerMouseDown}
          >
            {Array.from({ length: Math.ceil(Math.max(10, totalDuration) / 5) + 5 }).map((_, i) => (
              <div
                key={i}
                className="absolute bottom-0 border-l border-zinc-700 pl-1 h-3 pointer-events-none"
                style={{ left: `${i * 5 * PPS + TRACK_OFFSET}px` }}
              >
                {timeFormat === 'frames' ? `${i * 5 * 30}f` : `${i * 5}s`}
              </div>
            ))}
          </div>

          {/* Playhead - matching MovieTab diamond style */}
          <div
            className="absolute top-0 bottom-0 z-[200] pointer-events-none transition-transform duration-75"
            style={{ left: `${playheadPosPixels + TRACK_OFFSET}px` }}
          >
            <div className="w-4 h-4 bg-red-600 transform -translate-x-1/2 rotate-45 -mt-2 rounded-sm shadow-[0_2px_5px_rgba(0,0,0,0.5)] border border-white/50 relative z-50"></div>
            <div className="w-0.5 h-full bg-red-600 transform -translate-x-1/2 shadow-[0_0_10px_rgba(255,0,0,0.6)]"></div>
          </div>

          {/* Video Track - matching MovieTab */}
          <div
            className="absolute top-8 left-4 h-24 flex items-center w-full"
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverClipId(null);
              const libraryClipId = e.dataTransfer.getData('library-clip-id');
              if (libraryClipId && onDropFromLibrary) {
                onDropFromLibrary(libraryClipId);
              }
            }}
          >
            <div className="absolute -left-14 top-8 text-[10px] font-bold text-zinc-400 w-10 text-right">V1</div>

            {clipLayouts.length === 0 && (
              <div className="absolute top-0 left-0 h-full w-[500px] flex items-center justify-center border-2 border-dashed border-zinc-700 rounded-lg bg-zinc-800/30 text-zinc-400 gap-3 pointer-events-none">
                No clips yet
              </div>
            )}

            {clipLayouts.map((clip) => {
              const isActive = clip.id === activeClipId;
              const left = clip.startTime * PPS;
              const clipWidth = Math.max(10, clip.duration * PPS);
              const thumb = thumbnails[clip.id];
              const thumbCount = Math.max(1, Math.ceil(clipWidth / THUMBNAIL_WIDTH));

              return (
                <div
                  key={clip.id}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData('timeline-clip-id', clip.id); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverClipId(clip.id); }}
                  onDragLeave={() => setDragOverClipId(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverClipId(null);
                    const timelineClipId = e.dataTransfer.getData('timeline-clip-id');
                    const libraryClipId = e.dataTransfer.getData('library-clip-id');
                    if (timelineClipId && onReorderClips) {
                      onReorderClips(timelineClipId, clip.id);
                    } else if (libraryClipId && onDropFromLibrary) {
                      onDropFromLibrary(libraryClipId);
                    }
                  }}
                  className={`absolute top-0 h-full group shrink-0 select-none border-r border-[#11111b] transition-all cursor-grab active:cursor-grabbing
                    ${isActive ? 'ring-2 ring-indigo-500 z-10' : 'opacity-90 hover:opacity-100'}
                    ${dragOverClipId === clip.id ? 'ring-2 ring-green-400 ring-offset-1 ring-offset-[#11111b]' : ''}`}
                  style={{ left, width: clipWidth }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    onSelectClip(clip.id);
                  }}
                >
                  {/* Filmstrip Thumbnails - matching MovieTab */}
                  <div className="absolute inset-0 bg-zinc-800 overflow-hidden pointer-events-none rounded-sm">
                    <div className="flex h-full w-full opacity-50">
                      {thumb ? (
                        Array.from({ length: thumbCount }).map((_, idx) => (
                          <img
                            key={idx}
                            src={thumb}
                            className="h-full w-[80px] object-cover border-r border-black/20"
                            draggable={false}
                          />
                        ))
                      ) : (
                        <div className="w-full h-full bg-zinc-700/50" />
                      )}
                    </div>
                  </div>

                  {/* Clip title - top left (MovieTab style) */}
                  <div className="absolute top-1 left-2 text-xs font-bold text-white shadow-black drop-shadow-md pointer-events-none truncate w-[80%]">
                    Clip {clip.index}
                  </div>

                  {/* Duration - bottom right (MovieTab style) */}
                  <div className="absolute bottom-1 right-2 text-[10px] font-mono text-zinc-300 pointer-events-none">
                    {clip.duration.toFixed(1)}s
                  </div>

                  {/* Delete Button - matching MovieTab style */}
                  <button
                    onMouseDown={(e) => { e.stopPropagation(); onDeleteClip(clip.id); }}
                    className="absolute top-1 right-1 w-5 h-5 bg-red-600 hover:bg-red-500 text-white rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-50 cursor-pointer"
                    style={{ pointerEvents: 'auto' }}
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>

                  {/* Trim Handle: START - matching MovieTab white pill style */}
                  <div
                    className="absolute top-0 bottom-0 left-0 w-4 cursor-ew-resize z-20 flex items-center justify-center group/left hover:bg-indigo-500/20"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      onSelectClip(clip.id);
                      setDragging({ type: 'trimStart', clipId: clip.id, initialX: e.clientX, initialVal: clip.trimStart });
                    }}
                  >
                    <div className="h-8 w-1.5 bg-white rounded-full shadow-sm group-hover/left:bg-indigo-400"></div>
                  </div>

                  {/* Trim Handle: END - matching MovieTab white pill style */}
                  <div
                    className="absolute top-0 bottom-0 right-0 w-4 cursor-ew-resize z-20 flex items-center justify-center group/right hover:bg-indigo-500/20"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      onSelectClip(clip.id);
                      setDragging({ type: 'trimEnd', clipId: clip.id, initialX: e.clientX, initialVal: clip.trimEnd });
                    }}
                  >
                    <div className="h-8 w-1.5 bg-white rounded-full shadow-sm group-hover/right:bg-indigo-400"></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { height: 10px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #11111b; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #27272a; border-radius: 5px; border: 2px solid #11111b; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #3f3f46; }
      `}</style>
    </div>
  );
};
