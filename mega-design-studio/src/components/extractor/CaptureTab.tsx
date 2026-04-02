import React, { useState, useRef, useEffect, useCallback } from 'react';
import { VideoSegment } from '@/types';
import { useExtractor } from '@/contexts/ExtractorContext';
import { useApp } from '@/contexts/AppContext';
import Timeline from './Timeline';
import { analyzeMotionInterval } from '@/services/gemini';
import { parallelBatch } from '@/services/parallelBatch';

export const CaptureTab: React.FC = () => {
  const {
    videoUrl, setVideoUrl,
    videoDuration, setVideoDuration,
    videoAspectRatio, setVideoAspectRatio,
    segments, setSegments,
    activeSegmentId, setActiveSegmentId,
    loadingAction, setLoadingAction,
    captureTimeUnit, setCaptureTimeUnit,
  } = useExtractor();

  const { addAsset, activeTab } = useApp();

  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [extractionFlash, setExtractionFlash] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const processingVideoRef = useRef<HTMLVideoElement>(null);
  const isNewVideoLoading = useRef(false);

  const activeSegment = segments.find(s => s.id === activeSegmentId);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      setSegments([]);
      setActiveSegmentId(null);
      setIsPlaying(false);
      setVideoDuration(0);
      isNewVideoLoading.current = true;
    }
  };

  const onLoadedMetadata = () => {
    if (videoRef.current) {
      const dur = videoRef.current.duration;
      setVideoDuration(dur);
      if (videoRef.current.videoWidth && videoRef.current.videoHeight) {
        setVideoAspectRatio(videoRef.current.videoWidth / videoRef.current.videoHeight);
      }
      if (isNewVideoLoading.current && dur > 0) {
        const newId = crypto.randomUUID();
        setSegments([{ id: newId, start: 0, end: dur, description: "Full Video", prompt: "", frames: [], generatedClips: [] }]);
        setActiveSegmentId(newId);
        isNewVideoLoading.current = false;
      }
    }
  };

  const onTimeUpdate = () => {
    if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
  };

  const togglePlay = useCallback(() => {
    if (videoRef.current) {
      if (videoRef.current.paused) { videoRef.current.play(); setIsPlaying(true); }
      else { videoRef.current.pause(); setIsPlaying(false); }
    }
  }, []);

  // Global keyboard handler - only active when Capture tab is visible
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeTab !== 'capture') return;
      if (!videoRef.current || !videoUrl) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const video = videoRef.current;
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (!video.paused) { video.pause(); setIsPlaying(false); }
        video.currentTime = Math.max(0, video.currentTime - 0.1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (!video.paused) { video.pause(); setIsPlaying(false); }
        video.currentTime = Math.min(video.duration, video.currentTime + 0.1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, togglePlay, videoUrl]);

  const addSegment = (start: number, end: number) => {
    const newSeg: VideoSegment = { id: crypto.randomUUID(), start, end, description: "", prompt: "", frames: [], generatedClips: [] };
    setSegments(prev => [...prev, newSeg]);
    setActiveSegmentId(newSeg.id);
  };

  const updateSegment = (id: string, start: number, end: number) => {
    setSegments(prev => prev.map(s => s.id === id ? { ...s, start, end } : s));
  };

  const extractFrame = () => {
    if (!videoRef.current || !canvasRef.current || !activeSegmentId) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/png');
    const timestamp = video.currentTime;
    setExtractionFlash(true);
    setTimeout(() => setExtractionFlash(false), 400);
    setSegments(prev => prev.map(seg => {
      if (seg.id !== activeSegmentId) return seg;
      const isFirst = seg.frames.length === 0;
      return { ...seg, frames: [...seg.frames, { id: crypto.randomUUID(), timestamp, dataUrl, isKeyframe: isFirst }] };
    }));
    // Bridge captured frame to global asset library so it appears in Lab + Symbol Generator
    addAsset({
      id: `capture-frame-${crypto.randomUUID()}`,
      url: dataUrl,
      type: 'style',
      name: `Frame @ ${timestamp.toFixed(2)}s`,
    });
  };

  const captureFrameAtTime = async (video: HTMLVideoElement, time: number): Promise<string> => {
    return new Promise((resolve) => {
      const onSeek = () => {
        if (!canvasRef.current) return resolve("");
        const ctx = canvasRef.current.getContext('2d');
        if (!ctx) return resolve("");
        canvasRef.current.width = video.videoWidth;
        canvasRef.current.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        resolve(canvasRef.current.toDataURL('image/png'));
      };
      video.addEventListener('seeked', onSeek, { once: true });
      video.currentTime = time;
    });
  };

  const handleAutoGeneratePrompts = useCallback(async () => {
    if (!activeSegment || !processingVideoRef.current) return;
    const keyframes = activeSegment.frames.filter(f => f.isKeyframe).sort((a, b) => a.timestamp - b.timestamp);
    if (keyframes.length < 2) return;

    setLoadingAction("Analyzing Motion Intervals...");
    const video = processingVideoRef.current;
    const originalTime = video.currentTime;

    try {
      if (video.readyState < 1) {
        await new Promise<void>((resolve) => { video.onloadedmetadata = () => resolve(); });
      }
      // Build array of interval items (pairs of keyframes)
      const intervals = keyframes.slice(0, -1).map((startFrame, i) => ({
        startFrame,
        endFrame: keyframes[i + 1],
        intervalIndex: i,
      }));

      // Pre-capture frames sequentially (video seeking cannot be parallelized)
      const intervalFrames: string[][] = [];
      for (let i = 0; i < intervals.length; i++) {
        const { startFrame, endFrame } = intervals[i];
        const intervalDuration = endFrame.timestamp - startFrame.timestamp;
        const capturePoints = [
          startFrame.timestamp + intervalDuration * 0.25,
          startFrame.timestamp + intervalDuration * 0.5,
          startFrame.timestamp + intervalDuration * 0.75,
        ];
        const frames: string[] = [];
        for (const t of capturePoints) {
          const url = await captureFrameAtTime(video, t);
          if (url) frames.push(url);
        }
        intervalFrames.push(frames);
      }

      // Analyze motion intervals in parallel batches of 4
      await parallelBatch(
        intervals,
        async (interval, i) => {
          const { startFrame, endFrame } = interval;
          setLoadingAction(`Analyzing Interval ${i + 1}: Frame ${i + 1} -> ${i + 2}`);
          const intervalDuration = endFrame.timestamp - startFrame.timestamp;
          const analysisFrames = intervalFrames[i];
          if (analysisFrames.length > 0) {
            return await analyzeMotionInterval(analysisFrames, intervalDuration, "");
          }
          return null;
        },
        (motionDescription, interval) => {
          if (motionDescription) {
            setSegments(prev => prev.map(s => {
              if (s.id !== activeSegmentId) return s;
              return { ...s, frames: s.frames.map(f => f.id === interval.startFrame.id ? { ...f, transitionPrompt: motionDescription } : f) };
            }));
          }
        },
        4,
        500,
      );
    } catch (err) {
      console.error("Auto prompt generation failed", err);
    } finally {
      video.currentTime = originalTime;
      setLoadingAction(null);
    }
  }, [activeSegment, activeSegmentId, setLoadingAction, setSegments]);

  return (
    <div className="h-full flex flex-col p-6 animate-fade-in overflow-y-auto">
      {!videoUrl && segments.every(s => s.frames.length === 0) ? (
        <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-zinc-800 rounded-3xl bg-zinc-900/10">
          <i className="fas fa-film text-6xl text-zinc-800 mb-4"></i>
          <p className="text-zinc-400 font-medium">Upload a video to begin capturing</p>
          <label className="mt-4 cursor-pointer bg-zinc-800 hover:bg-zinc-700 text-white px-6 py-3 rounded-lg text-sm font-bold uppercase transition-all shadow-lg">
            Select Video
            <input type="file" accept="video/*" className="hidden" onChange={handleFileUpload} />
          </label>
        </div>
      ) : !videoUrl && segments.some(s => s.frames.length > 0) ? (
        /* Loaded from project — show frames gallery without video */
        <div className="flex flex-col h-full gap-6">
          <div className="bg-zinc-900/50 border border-dashed border-zinc-700 rounded-2xl p-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <i className="fas fa-folder-open text-indigo-400 text-lg"></i>
              <div>
                <p className="text-sm font-bold text-zinc-300">Loaded from project</p>
                <p className="text-[10px] text-zinc-400">{segments.length} segment{segments.length !== 1 ? 's' : ''} &middot; {segments.reduce((sum, s) => sum + s.frames.length, 0)} frames</p>
              </div>
            </div>
            <label className="cursor-pointer bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-lg text-xs font-bold uppercase transition-all">
              Re-attach Video
              <input type="file" accept="video/*" className="hidden" onChange={handleFileUpload} />
            </label>
          </div>
          <div className="flex gap-2 flex-wrap">
            {segments.map(seg => (
              <button key={seg.id} onClick={() => setActiveSegmentId(seg.id)} className={`text-[10px] font-bold uppercase px-3 py-1.5 rounded border transition-colors ${activeSegmentId === seg.id ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white'}`}>
                {seg.description || seg.id.split('-')[0]} ({seg.frames.length})
              </button>
            ))}
          </div>
          {activeSegment && activeSegment.frames.length > 0 && (
            <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 overflow-y-auto flex-1">
              {activeSegment.frames.map((frame, i) => {
                const img = frame.modifiedDataUrl || frame.cleanedDataUrl || frame.dataUrl;
                return (
                  <div key={frame.id} className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                    <div className="relative" style={{ aspectRatio: videoAspectRatio || 16/9 }}>
                      <img src={img} className="w-full h-full object-cover" />
                      {frame.isKeyframe && <span className="absolute top-1 left-1 bg-amber-500 text-black text-[8px] font-black px-1.5 py-0.5 rounded">KF</span>}
                    </div>
                    <div className="p-1.5 text-[9px] text-zinc-400 font-mono">{frame.timestamp.toFixed(2)}s</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col h-full gap-6">
          <div className="flex-1 bg-black rounded-2xl border border-zinc-800 relative overflow-hidden flex items-center justify-center">
            <video
              ref={videoRef}
              src={videoUrl}
              onLoadedMetadata={onLoadedMetadata}
              onTimeUpdate={onTimeUpdate}
              className="max-h-full max-w-full cursor-pointer"
              onClick={togglePlay}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
            />
            {extractionFlash && <div className="absolute inset-0 bg-white z-50 animate-pulse pointer-events-none mix-blend-overlay" />}
            {extractionFlash && (
              <div className="absolute top-8 right-8 bg-black/80 text-white px-4 py-2 rounded-full flex items-center gap-2 z-50">
                <i className="fas fa-check-circle text-green-400"></i>
                <span className="text-xs font-bold uppercase tracking-wide">Frame Extracted</span>
              </div>
            )}
            {activeSegment && activeSegment.frames.filter(f => f.isKeyframe).length >= 2 && (
              <div className="absolute bottom-8 left-8 z-40">
                <span className="text-[10px] text-indigo-300 bg-indigo-900/50 px-3 py-1 rounded border border-indigo-500/30">
                  {activeSegment.frames.filter(f => f.isKeyframe).length} keyframes marked
                </span>
              </div>
            )}
          </div>

          <div className="bg-[#09090b] p-4 rounded-xl border border-zinc-800 shadow-xl">
            <div className="flex justify-between items-center mb-2">
              <div className="flex gap-2">
                <button onClick={() => addSegment(currentTime, Math.min(currentTime + 5, videoDuration))} className="text-[10px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded uppercase font-bold border border-zinc-700">
                  + New Segment
                </button>
                {activeSegmentId && (
                  <button onClick={handleAutoGeneratePrompts} className="text-[10px] bg-indigo-900/30 hover:bg-indigo-900/50 text-indigo-300 border border-indigo-500/30 px-3 py-1.5 rounded uppercase font-bold">
                    <i className="fas fa-magic mr-2"></i> Auto-Analyze
                  </button>
                )}
                <div className="flex bg-zinc-800 rounded border border-zinc-700 p-0.5">
                  <button
                    onClick={() => setCaptureTimeUnit('seconds')}
                    className={`px-2 py-1 text-[9px] font-bold uppercase rounded ${captureTimeUnit === 'seconds' ? 'bg-zinc-600 text-white shadow' : 'text-zinc-400 hover:text-white'}`}
                  >Secs</button>
                  <button
                    onClick={() => setCaptureTimeUnit('frames')}
                    className={`px-2 py-1 text-[9px] font-bold uppercase rounded ${captureTimeUnit === 'frames' ? 'bg-zinc-600 text-white shadow' : 'text-zinc-400 hover:text-white'}`}
                  >Frames</button>
                </div>
              </div>
              <span className="text-[10px] text-zinc-400 font-mono uppercase">{activeSegmentId ? `Segment: ${activeSegmentId.split('-')[0]}` : "No Segment Selected"}</span>
            </div>
            <Timeline
              duration={videoDuration}
              currentTime={currentTime}
              segments={segments}
              activeSegmentId={activeSegmentId}
              onSeek={(t) => { if (videoRef.current) videoRef.current.currentTime = t; }}
              onAddSegment={addSegment}
              onUpdateSegment={updateSegment}
              onSelectSegment={setActiveSegmentId}
              isPlaying={isPlaying}
              onTogglePlay={togglePlay}
              keyframes={activeSegment ? activeSegment.frames.map(f => f.timestamp) : []}
              timeFormat={captureTimeUnit}
            />
            <div className="flex justify-end pt-4 mt-2 border-t border-zinc-800">
              <button
                onClick={extractFrame}
                disabled={!activeSegmentId}
                className="bg-white hover:bg-zinc-200 text-black px-8 py-3 rounded-full text-sm font-black uppercase tracking-wide transition-all shadow-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95"
              >
                <i className="fas fa-camera"></i> Capture Frame
              </button>
            </div>
          </div>
        </div>
      )}
      <canvas ref={canvasRef} className="hidden" />
      <video ref={processingVideoRef} src={videoUrl || ""} className="hidden" crossOrigin="anonymous" muted />
    </div>
  );
};
