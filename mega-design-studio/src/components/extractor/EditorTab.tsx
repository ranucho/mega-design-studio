import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useExtractor } from '@/contexts/ExtractorContext';
import { useApp } from '@/contexts/AppContext';
import { GeneratedClip } from '@/types';
import { ClipTrimmer } from './ClipTrimmer';
import { SequenceTimeline } from './SequenceTimeline';

export const EditorTab: React.FC = () => {
  const { clips, setClips, videoAspectRatio } = useExtractor();
  const { activeTab } = useApp();
  const [activeClipId, setActiveClipId] = useState<string | null>(clips[0]?.id || null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [editorTimeFormat, setEditorTimeFormat] = useState<'seconds' | 'frames'>('seconds');
  const [localTime, setLocalTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Export State
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  const exportCanvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const watchdogRef = useRef<number | null>(null);

  const onUpdateClip = (clipId: string, updates: Partial<GeneratedClip>) => {
    setClips(prev => prev.map(c => c.id === clipId ? { ...c, ...updates } : c));
  };

  // Remove from timeline but keep in library
  const onRemoveFromTimeline = (clipId: string) => {
    setClips(prev => prev.map(c => c.id === clipId ? { ...c, inTimeline: false } : c));
  };

  // Permanently delete clip
  const onDeleteClip = (clipId: string) => {
    setClips(prev => prev.filter(c => c.id !== clipId));
  };

  // Add back to timeline from library
  const onRestoreToTimeline = (clipId: string) => {
    setClips(prev => prev.map(c => c.id === clipId ? { ...c, inTimeline: true } : c));
  };

  // Reorder clips on the timeline via drag-and-drop
  const onReorderClips = (fromId: string, toId: string) => {
    setClips(prev => {
      const arr = [...prev];
      const fromIdx = arr.findIndex(c => c.id === fromId);
      const toIdx = arr.findIndex(c => c.id === toId);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return prev;
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      return arr;
    });
  };

  // Timeline clips = those not removed
  const timelineClips = clips.filter(c => c.inTimeline !== false);
  const libraryOnlyClips = clips.filter(c => c.inTimeline === false);

  // Safety: If active clip is removed from timeline, select another
  useEffect(() => {
    if (activeClipId && !timelineClips.find(c => c.id === activeClipId)) {
      setActiveClipId(timelineClips[0]?.id || null);
      setIsPlaying(false);
    }
  }, [clips, activeClipId]);

  const activeClip = timelineClips.find(c => c.id === activeClipId);
  const activeClipIndex = timelineClips.findIndex(c => c.id === activeClipId);

  const getTimelineInfo = () => {
    let total = 0, currentClipStart = 0;
    for (const clip of timelineClips) {
      const duration = (clip.trimEnd - clip.trimStart) / (clip.speed || 1);
      if (clip.id === activeClipId) currentClipStart = total;
      total += duration;
    }
    return { totalDuration: total, activeClipStartTime: currentClipStart };
  };

  const { activeClipStartTime, totalDuration } = getTimelineInfo();
  const currentGlobalTime = activeClipStartTime + ((localTime - (activeClip?.trimStart || 0)) / (activeClip?.speed || 1));

  // --- SPEED CONTROL ---
  useEffect(() => {
    if (videoRef.current && activeClip) {
      videoRef.current.playbackRate = activeClip.speed || 1;
    }
  }, [activeClip?.speed]);

  // --- EXPORT LOGIC (matches MovieTab audio approach) ---

  const handleExportSequence = async () => {
    if (timelineClips.length === 0) return;
    setIsExporting(true);
    setExportStatus('Initializing export...');

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) { setIsExporting(false); return; }

    // Create offscreen video container
    const offContainer = document.createElement('div');
    Object.assign(offContainer.style, { position: 'fixed', left: '0px', top: '0px', width: '1px', height: '1px', opacity: '0.01', zIndex: '-1', overflow: 'hidden' });
    document.body.appendChild(offContainer);
    const offVideo = document.createElement('video');
    offVideo.crossOrigin = 'anonymous';
    offVideo.playsInline = true;
    offContainer.appendChild(offVideo);

    // Audio setup - matching MovieTab pattern exactly
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const exportAudioCtx = new AudioContextClass({ sampleRate: 48000 });
    const dest = exportAudioCtx.createMediaStreamDestination();
    await exportAudioCtx.resume();

    const videoSrc = exportAudioCtx.createMediaElementSource(offVideo);
    const videoGain = exportAudioCtx.createGain();
    videoGain.gain.value = 1.0;
    videoSrc.connect(videoGain);
    videoGain.connect(dest);

    // Silent oscillator to keep audio stream active (critical for audio export)
    const osc = exportAudioCtx.createOscillator();
    const oscGain = exportAudioCtx.createGain();
    oscGain.gain.value = 0.001;
    osc.connect(oscGain);
    oscGain.connect(dest);
    osc.start();

    // Canvas setup
    const width = 1280;
    const height = 720;
    canvas.width = width;
    canvas.height = height;

    const stream = canvas.captureStream(30);
    if (dest.stream.getAudioTracks().length > 0) {
      stream.addTrack(dest.stream.getAudioTracks()[0]);
    }

    const mimeType = MediaRecorder.isTypeSupported('video/mp4; codecs=avc1.42E01E, mp4a.40.2')
      ? 'video/mp4; codecs=avc1.42E01E, mp4a.40.2'
      : 'video/webm; codecs=vp9,opus';
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8000000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.start();

    try {
      for (let i = 0; i < timelineClips.length; i++) {
        const clip = timelineClips[i];
        setExportStatus(`Exporting clip ${i + 1}/${timelineClips.length}...`);
        setActiveClipId(clip.id);

        offVideo.src = clip.url;
        offVideo.muted = false;
        offVideo.volume = 0.8;
        offVideo.playbackRate = clip.speed || 1;

        await new Promise<void>((resolve, reject) => {
          const onCanPlay = () => { offVideo.removeEventListener('canplay', onCanPlay); resolve(); };
          offVideo.addEventListener('canplay', onCanPlay);
          offVideo.addEventListener('error', reject);
          offVideo.load();
        });

        offVideo.currentTime = clip.trimStart;
        await new Promise<void>(resolve => {
          const onSeeked = () => { offVideo.removeEventListener('seeked', onSeeked); resolve(); };
          offVideo.addEventListener('seeked', onSeeked);
        });

        const playPromise = offVideo.play();
        await new Promise<void>(resolve => {
          const onPlaying = () => { offVideo.removeEventListener('playing', onPlaying); resolve(); };
          offVideo.addEventListener('playing', onPlaying);
        });
        await playPromise;

        const drawFrame = () => {
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, width, height);
          const vw = offVideo.videoWidth || width;
          const vh = offVideo.videoHeight || height;
          const videoAR = vw / vh;
          const canvasAR = width / height;
          let dw = width, dh = height, dx = 0, dy = 0;
          if (videoAR > canvasAR) { dh = width / videoAR; dy = (height - dh) / 2; }
          else { dw = height * videoAR; dx = (width - dw) / 2; }
          ctx.drawImage(offVideo, dx, dy, dw, dh);
        };

        while (true) {
          drawFrame();
          if (offVideo.currentTime >= clip.trimEnd || offVideo.ended || offVideo.paused) break;
          await new Promise(r => requestAnimationFrame(r));
        }
        offVideo.pause();
      }

      recorder.stop();
      osc.stop();
      await new Promise<void>(resolve => { recorder.onstop = () => resolve(); });

      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sequence_export.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
    } catch (e) {
      console.error('Export failed', e);
      alert('Export failed.');
    } finally {
      setIsExporting(false);
      setExportStatus('');
      document.body.removeChild(offContainer);
      exportAudioCtx.close();
    }
  };

  // --- LIFECYCLE ---
  useEffect(() => {
    if (!activeClip || !videoRef.current || isExporting) return;
    let mounted = true;
    const videoEl = videoRef.current;

    const setupClip = async () => {
      try {
        videoEl.load();
        if (videoEl.readyState < 1) {
          await new Promise((resolve, reject) => {
            if (!mounted) return reject('Unmounted');
            videoEl.addEventListener('loadedmetadata', () => resolve(true), { once: true });
            videoEl.addEventListener('error', () => reject('Video load error'), { once: true });
          });
        }
        if (!mounted) return;
        if (!activeClip.originalDuration) {
          onUpdateClip(activeClip.id, { originalDuration: videoEl.duration, trimEnd: videoEl.duration });
        }
        videoEl.playbackRate = activeClip.speed || 1;
        if (isFinite(activeClip.trimStart)) {
          videoEl.currentTime = activeClip.trimStart;
          setLocalTime(activeClip.trimStart);
        }
        if (isPlaying) {
          try { await videoEl.play(); } catch (e: any) {
            if (e.name !== 'AbortError') console.error('Play failed:', e);
          }
        }
      } catch (e: any) {
        console.error('Clip transition failed:', e);
      }
    };
    setupClip();
    return () => { mounted = false; };
  }, [activeClipId]);

  const advanceToNextClip = () => {
    const currentIndex = timelineClips.findIndex(c => c.id === activeClipId);
    const nextClip = timelineClips[currentIndex + 1];
    if (nextClip) { setActiveClipId(nextClip.id); }
    else { if (videoRef.current) videoRef.current.pause(); setIsPlaying(false); }
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current || !activeClip || isExporting) return;
    const now = videoRef.current.currentTime;
    setLocalTime(now);
    if (activeClip.trimEnd > 0 && now >= (activeClip.trimEnd - 0.05)) {
      if (isPlaying) advanceToNextClip();
      else { videoRef.current.pause(); setIsPlaying(false); }
    }
  };

  const togglePlay = useCallback(() => {
    if (isExporting || !videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      if (currentGlobalTime >= totalDuration - 0.1 && timelineClips.length > 0) {
        setActiveClipId(timelineClips[0].id);
        setIsPlaying(true);
      } else if (activeClip) {
        if (videoRef.current.currentTime >= activeClip.trimEnd) videoRef.current.currentTime = activeClip.trimStart;
        videoRef.current.play().catch(() => {});
        setIsPlaying(true);
      }
    }
  }, [isExporting, isPlaying, currentGlobalTime, totalDuration, timelineClips, activeClip]);

  // Global keyboard handler - only active when Editor tab is visible
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeTab !== 'editor') return;
      if (isExporting || !videoRef.current) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (isPlaying) { videoRef.current.pause(); setIsPlaying(false); }
        if (activeClip) {
          const newTime = Math.max(activeClip.trimStart, videoRef.current.currentTime - 0.1);
          videoRef.current.currentTime = newTime;
          setLocalTime(newTime);
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (isPlaying) { videoRef.current.pause(); setIsPlaying(false); }
        if (activeClip) {
          const newTime = Math.min(activeClip.trimEnd, videoRef.current.currentTime + 0.1);
          videoRef.current.currentTime = newTime;
          setLocalTime(newTime);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, isExporting, isPlaying, activeClip, togglePlay]);

  const handleGlobalSeek = (time: number) => {
    if (isExporting) return;
    let elapsed = 0;
    for (const clip of timelineClips) {
      const duration = (clip.trimEnd - clip.trimStart) / (clip.speed || 1);
      if (time >= elapsed && time <= elapsed + duration + 0.1) {
        const local = (time - elapsed) * (clip.speed || 1) + clip.trimStart;
        if (activeClipId !== clip.id) { setActiveClipId(clip.id); }
        else if (videoRef.current) {
          const clamped = Math.max(clip.trimStart, Math.min(local, clip.trimEnd));
          videoRef.current.currentTime = clamped;
          setLocalTime(clamped);
        }
        break;
      }
      elapsed += duration;
    }
  };

  if (clips.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-500">
        <i className="fas fa-film text-4xl mb-4" />
        <p>No generated clips found. Create segments in Studio first.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#09090b] text-white overflow-hidden relative">
      <canvas ref={exportCanvasRef} className="absolute top-0 left-0 w-px h-px opacity-0 pointer-events-none" />

      {/* Export Overlay */}
      {isExporting && (
        <div className="absolute inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center backdrop-blur-sm">
          <div className="w-16 h-16 border-4 border-zinc-800 border-t-indigo-500 rounded-full animate-spin mb-4" />
          <div className="text-xl font-bold text-white mb-2">Rendering Final Sequence</div>
          <div className="text-indigo-400 font-mono text-sm mb-6 animate-pulse">{exportStatus}</div>
          <div className="w-64 h-1 bg-zinc-800 rounded-full overflow-hidden mb-6">
            <div className="h-full bg-indigo-500 transition-all duration-300" style={{ width: `${(currentGlobalTime / totalDuration) * 100}%` }} />
          </div>
          <button
            onClick={() => { setIsExporting(false); }}
            className="text-red-500 hover:text-red-400 text-xs font-bold uppercase hover:bg-red-500/10 px-4 py-2 rounded transition-colors"
          >
            Cancel Export
          </button>
          <p className="text-zinc-600 text-[10px] mt-8 max-w-xs text-center">
            Recording viewport playback... Do not minimize window.
          </p>
        </div>
      )}

      {/* MAIN EDITOR AREA */}
      <div className="flex-1 min-h-0 flex border-b border-zinc-800">
        {/* LEFT: LIBRARY */}
        <div className="w-64 bg-[#09090b] border-r border-zinc-800 flex flex-col shrink-0">
          <div className="p-4 border-b border-zinc-800 bg-zinc-900/50">
            <h3 className="text-xs font-black uppercase tracking-widest text-zinc-400">Media Library</h3>
            <p className="text-[10px] text-zinc-500 mt-1">{timelineClips.length} on timeline · {clips.length} total</p>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {/* Timeline clips */}
            {timelineClips.map((clip) => (
              <div
                key={clip.id}
                draggable
                onDragStart={(e) => { e.dataTransfer.setData('library-clip-id', clip.id); e.dataTransfer.effectAllowed = 'move'; }}
                onClick={() => { if (isExporting) return; setActiveClipId(clip.id); setIsPlaying(false); }}
                className={`w-full text-left p-2 rounded-lg flex gap-3 items-center border transition-all cursor-grab active:cursor-grabbing group ${activeClipId === clip.id ? 'bg-zinc-800 border-zinc-600' : 'border-transparent hover:bg-zinc-900'}`}
              >
                <div className="w-16 h-10 bg-black rounded border border-zinc-700 overflow-hidden relative shrink-0">
                  <video src={clip.url} className="w-full h-full object-cover pointer-events-none" />
                  <div className="absolute inset-0 bg-black/20" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-zinc-300 truncate">Clip #{clip.index}</div>
                  <div className="text-[10px] text-zinc-500 font-mono">{(clip.trimEnd - clip.trimStart).toFixed(1)}s</div>
                </div>
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); onRemoveFromTimeline(clip.id); }}
                  className="opacity-0 group-hover:opacity-100 p-2 hover:bg-orange-500/20 hover:text-orange-400 rounded text-zinc-500 transition-all z-10 cursor-pointer pointer-events-auto"
                  title="Remove from timeline"
                >
                  <i className="fas fa-minus-circle text-xs pointer-events-none" />
                </button>
              </div>
            ))}

            {/* Removed clips section */}
            {libraryOnlyClips.length > 0 && (
              <>
                <div className="pt-3 pb-1 px-1">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-600">Removed</span>
                </div>
                {libraryOnlyClips.map((clip) => (
                  <div
                    key={clip.id}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData('library-clip-id', clip.id); e.dataTransfer.effectAllowed = 'copy'; }}
                    className="w-full text-left p-2 rounded-lg flex gap-3 items-center border border-transparent hover:bg-zinc-900/50 transition-all cursor-pointer group opacity-50 hover:opacity-80"
                  >
                    <div className="w-16 h-10 bg-black rounded border border-zinc-700/50 overflow-hidden relative shrink-0">
                      <video src={clip.url} className="w-full h-full object-cover pointer-events-none" />
                      <div className="absolute inset-0 bg-black/40" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-zinc-500 truncate">Clip #{clip.index}</div>
                      <div className="text-[10px] text-zinc-600 font-mono">{(clip.trimEnd - clip.trimStart).toFixed(1)}s</div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); onRestoreToTimeline(clip.id); }}
                        className="opacity-0 group-hover:opacity-100 p-2 hover:bg-green-500/20 hover:text-green-400 rounded text-zinc-500 transition-all cursor-pointer"
                        title="Add back to timeline"
                      >
                        <i className="fas fa-plus-circle text-xs" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onDeleteClip(clip.id); }}
                        className="opacity-0 group-hover:opacity-100 p-2 hover:bg-red-500/20 hover:text-red-500 rounded text-zinc-500 transition-all cursor-pointer"
                        title="Delete permanently"
                      >
                        <i className="fas fa-trash text-xs" />
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        {/* CENTER: PLAYER */}
        <div className="flex-1 flex flex-col bg-[#000000] relative">
          <div className="flex-1 flex items-center justify-center p-4 overflow-hidden" onClick={togglePlay}>
            <div className="relative w-full h-full flex items-center justify-center">
              {activeClip ? (
                <video
                  ref={videoRef} src={activeClip.url}
                  className="max-w-full max-h-full shadow-2xl"
                  style={{ aspectRatio: videoAspectRatio >= 1 ? `${videoAspectRatio}` : `${videoAspectRatio}` }}
                  onTimeUpdate={handleTimeUpdate}
                  crossOrigin="anonymous"
                  playsInline
                  muted={false}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-zinc-600">No Clip Selected</div>
              )}
              {!isPlaying && activeClip && !isExporting && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                  <div className="bg-black/50 p-6 rounded-full backdrop-blur-sm border border-white/10">
                    <svg className="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Player Controls */}
          <div className="h-12 border-t border-zinc-800 bg-zinc-900 flex items-center px-4 justify-between shrink-0">
            <div className="flex items-center gap-4">
              <button onClick={togglePlay} className="text-white hover:text-indigo-400 transition-colors w-8" disabled={isExporting}>
                <i className={`fas fa-${isPlaying ? 'pause' : 'play'}`} />
              </button>
              <div className="text-xs font-mono text-zinc-400">
                <span className="text-white">{currentGlobalTime.toFixed(2)}s</span> / {totalDuration.toFixed(2)}s
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-[10px] font-bold text-zinc-500 uppercase mr-4">Rate: {activeClip?.speed || 1}x</span>
              <button
                onClick={handleExportSequence} disabled={isExporting}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white px-4 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest shadow-lg flex items-center gap-2"
              >
                <i className="fas fa-film" /> Export Sequence
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT: INSPECTOR */}
        <div className="w-72 bg-[#09090b] border-l border-zinc-800 flex flex-col shrink-0">
          <div className="p-4 border-b border-zinc-800 bg-zinc-900/50">
            <h3 className="text-xs font-black uppercase tracking-widest text-zinc-400">Inspector</h3>
          </div>
          <div className="p-4 overflow-y-auto space-y-6">
            {activeClip ? (
              <>
                {/* Trim Controls */}
                <div>
                  <label className="text-[10px] uppercase font-bold text-zinc-500 mb-2 block flex justify-between">
                    <span>Range</span>
                    <span className="text-indigo-400">{(activeClip.trimEnd - activeClip.trimStart).toFixed(1)}s</span>
                  </label>
                  <ClipTrimmer
                    duration={activeClip.originalDuration || 10}
                    trimStart={activeClip.trimStart || 0}
                    trimEnd={activeClip.trimEnd || (activeClip.originalDuration || 10)}
                    currentTime={localTime}
                    onTrimChange={(s, e) => { if (!isExporting) onUpdateClip(activeClip.id, { trimStart: s, trimEnd: e }); }}
                    onScrub={(t) => { if (videoRef.current && !isExporting) videoRef.current.currentTime = t; }}
                  />
                </div>

                {/* Speed Controls */}
                <div>
                  <label className="text-[10px] uppercase font-bold text-zinc-500 mb-2 block">Playback Speed</label>
                  <div className="grid grid-cols-5 gap-1 bg-zinc-900 p-1 rounded-lg border border-zinc-800">
                    {[0.5, 1, 1.5, 2, 4].map(speed => (
                      <button
                        key={speed}
                        onClick={() => { if (!isExporting) onUpdateClip(activeClip.id, { speed }); }}
                        className={`py-2 text-[9px] font-bold rounded ${activeClip.speed === speed ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:bg-zinc-800'}`}
                        disabled={isExporting}
                      >
                        {speed}x
                      </button>
                    ))}
                  </div>
                </div>

                {/* Clip Info */}
                <div className="p-3 rounded bg-zinc-900 border border-zinc-800 text-[10px] space-y-1">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Source ID</span>
                    <span className="text-zinc-300 font-mono truncate w-24 text-right" title={activeClip.id}>{activeClip.id.substring(0, 8)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Full Duration</span>
                    <span className="text-zinc-300 font-mono">{(activeClip.originalDuration || 0).toFixed(2)}s</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center text-zinc-600 text-xs py-10">Select a clip to edit</div>
            )}
          </div>
        </div>
      </div>

      {/* BOTTOM: SEQUENCE TIMELINE */}
      <div className="h-[280px] border-t border-zinc-800 bg-[#18181b] shrink-0">
        <SequenceTimeline
          clips={timelineClips}
          activeClipId={activeClipId}
          onSelectClip={(id) => { if (isExporting) return; setActiveClipId(id); setIsPlaying(false); }}
          onUpdateClip={(id, u) => { if (!isExporting) onUpdateClip(id, u); }}
          onDeleteClip={onRemoveFromTimeline}
          onReorderClips={onReorderClips}
          onDropFromLibrary={(clipId) => { onRestoreToTimeline(clipId); }}
          globalTime={currentGlobalTime}
          onSeekGlobal={handleGlobalSeek}
          timeFormat={editorTimeFormat}
          onTimeFormatChange={setEditorTimeFormat}
        />
      </div>
    </div>
  );
};
