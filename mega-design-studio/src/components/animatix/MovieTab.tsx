import React, { useState, useRef, useEffect, useCallback } from 'react';
import { StoryScene } from '@/types';
import { Button } from '@/components/ui/Button';
import { useAnimatix } from '@/contexts/AnimatixContext';
import { useApp } from '@/contexts/AppContext';
import { generateSceneVideo } from '@/services/gemini';

interface AudioTrack {
  id: number;
  url: string;
  timelineStart: number;
  duration: number;
  offset: number;
}

export const MovieTab: React.FC = () => {
  const { scenes, setScenes } = useAnimatix();
  const { aspectRatio, activeTab } = useApp();

  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  const [activeTool, setActiveTool] = useState<'pointer' | 'razor'>('pointer');
  const [sidebarTab, setSidebarTab] = useState<'library' | 'music'>('library');
  const [draggedItem, setDraggedItem] = useState<{ id: number; type: 'scene' | 'audio'; source: 'timeline' | 'library' | 'music' } | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ index: number; position: 'before' | 'after' } | null>(null);

  const [audioTrack, setAudioTrack] = useState<AudioTrack | null>(null);
  const [zoom, setZoom] = useState(20);
  const [timeFormat, setTimeFormat] = useState<'seconds' | 'frames'>('seconds');

  const [isScrubbing, setIsScrubbing] = useState(false);
  const [isTrimming, setIsTrimming] = useState<'start' | 'end' | null>(null);
  const [trimmingSceneId, setTrimmingSceneId] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sceneId: number; type: 'scene' | 'audio' } | null>(null);

  const dragContext = useRef<{ startX: number; initialStart: number; initialEnd: number; lockedZoom: number } | null>(null);
  const audioDragContext = useRef<{ startX: number; initialTimelineStart: number; lockedZoom: number } | null>(null);
  const timelineContainerRef = useRef<HTMLDivElement>(null);
  const [sceneProgress, setSceneProgress] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);
  const isTransitioning = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validScenes = scenes.filter(s => (s.videoUrl || s.isGeneratingVideo) && s.includeInVideo !== false);

  const uniqueLibraryScenes = scenes.reduce((acc, current) => {
    if (!current.videoUrl) return acc;
    if (!acc.find(s => s.videoUrl === current.videoUrl)) acc.push(current);
    return acc;
  }, [] as StoryScene[]);

  useEffect(() => {
    if (currentSceneIndex >= validScenes.length && validScenes.length > 0) setCurrentSceneIndex(validScenes.length - 1);
    if (validScenes.length === 0 && currentSceneIndex !== 0) setCurrentSceneIndex(0);
  }, [validScenes.length, currentSceneIndex]);

  const currentScene = validScenes[currentSceneIndex];
  const ratioStyle = { aspectRatio: aspectRatio.replace(':', '/') };

  const getTiming = (scene: StoryScene) => {
    const defaultDuration = scene.videoDuration || 10.0;
    return { start: scene.trimStart ?? 0, end: scene.trimEnd ?? defaultDuration };
  };

  const totalSequenceDuration = validScenes.reduce((acc, s) => acc + Math.max(0, getTiming(s).end - getTiming(s).start), 0);

  // Playhead position
  let currentGlobalTime = 0;
  for (let i = 0; i < currentSceneIndex; i++) currentGlobalTime += Math.max(0, getTiming(validScenes[i]).end - getTiming(validScenes[i]).start);
  if (currentScene && !isTransitioning.current) {
    const localTime = Math.max(0, sceneProgress - getTiming(currentScene).start);
    const sceneDur = getTiming(currentScene).end - getTiming(currentScene).start;
    currentGlobalTime += Math.min(localTime, sceneDur);
  }
  const playheadPosPixels = currentGlobalTime * zoom;

  const updateScene = useCallback((index: number, updates: Partial<StoryScene>) => {
    setScenes(prev => {
      const next = [...prev];
      next[index] = { ...next[index], ...updates };
      return next;
    });
  }, [setScenes]);

  const downloadSingleVideo = (url: string, title: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.onloadedmetadata = () => { video.currentTime = Math.min(0.5, video.duration / 2); };
    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 180;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const thumbnail = canvas.toDataURL('image/jpeg');
      const duration = video.duration || 10;
      const newScene: StoryScene = {
        id: Date.now(),
        title: file.name.replace(/\.[^/.]+$/, "").substring(0, 20),
        dialogue: "", visual_prompt: "User Uploaded", action_prompt: "User Uploaded", camera_angle: "Custom",
        videoUrl: url, imageUrl: thumbnail, videoDuration: duration, trimStart: 0, trimEnd: duration, includeInVideo: false
      };
      setScenes(prev => [...prev, newScene]);
    };
    e.target.value = '';
  };

  const playNextScene = useCallback(() => {
    if (isTransitioning.current) return;
    if (currentSceneIndex < validScenes.length - 1) {
      isTransitioning.current = true;
      setCurrentSceneIndex(prev => prev + 1);
    } else {
      setIsPlaying(false);
      setCurrentSceneIndex(0);
      isTransitioning.current = true;
      if (videoRef.current && validScenes.length > 0) {
        videoRef.current.currentTime = getTiming(validScenes[0]).start;
        setSceneProgress(getTiming(validScenes[0]).start);
      }
    }
  }, [currentSceneIndex, validScenes]);

  const handleTimelineSeek = (globalTime: number) => {
    let accumulated = 0;
    let targetSceneIdx = -1;
    let targetLocalTime = 0;
    for (let i = 0; i < validScenes.length; i++) {
      const t = getTiming(validScenes[i]);
      const duration = Math.max(0, t.end - t.start);
      if (globalTime >= accumulated && globalTime <= accumulated + duration + 0.01) {
        targetSceneIdx = i;
        targetLocalTime = t.start + (globalTime - accumulated);
        break;
      }
      accumulated += duration;
    }
    if (targetSceneIdx === -1 && validScenes.length > 0) {
      targetSceneIdx = validScenes.length - 1;
      targetLocalTime = getTiming(validScenes[targetSceneIdx]).end;
    }
    if (targetSceneIdx !== -1) {
      if (targetSceneIdx !== currentSceneIndex) {
        isTransitioning.current = true;
        setCurrentSceneIndex(targetSceneIdx);
        (videoRef.current as any)._pendingSeek = targetLocalTime;
      } else if (videoRef.current) {
        videoRef.current.currentTime = targetLocalTime;
        setSceneProgress(targetLocalTime);
      }
    }
  };

  const handleTimelineMouseDown = (e: React.MouseEvent) => {
    setIsScrubbing(true);
    const rect = timelineContainerRef.current!.getBoundingClientRect();
    const offsetX = e.clientX - rect.left + timelineContainerRef.current!.scrollLeft;
    const time = Math.max(0, (offsetX - 16) / zoom);
    handleTimelineSeek(time);
  };

  const handleTrimInit = (e: React.MouseEvent, type: 'start' | 'end', scene: StoryScene) => {
    e.preventDefault(); e.stopPropagation();
    setActiveTool('pointer');
    setIsTrimming(type);
    setTrimmingSceneId(scene.id);
    const timing = getTiming(scene);
    dragContext.current = { startX: e.clientX, initialStart: timing.start, initialEnd: timing.end, lockedZoom: zoom };
  };

  const handleAudioMoveInit = (e: React.MouseEvent) => {
    if (!audioTrack) return;
    e.preventDefault(); e.stopPropagation();
    audioDragContext.current = { startX: e.clientX, initialTimelineStart: audioTrack.timelineStart, lockedZoom: zoom };
  };

  useEffect(() => {
    const handleWindowMouseMove = (e: MouseEvent) => {
      if (isScrubbing && timelineContainerRef.current) {
        e.preventDefault();
        const rect = timelineContainerRef.current.getBoundingClientRect();
        const offsetX = e.clientX - rect.left + timelineContainerRef.current.scrollLeft;
        const time = Math.max(0, (offsetX - 16) / zoom);
        handleTimelineSeek(time);
      } else if (isTrimming && trimmingSceneId !== null && dragContext.current) {
        const ctx = dragContext.current;
        const sceneIndex = scenes.findIndex(s => s.id === trimmingSceneId);
        if (sceneIndex === -1) return;
        const scene = scenes[sceneIndex];
        const deltaSeconds = (e.clientX - ctx.startX) / ctx.lockedZoom;
        if (isTrimming === 'start') {
          let newStart = ctx.initialStart + deltaSeconds;
          newStart = Math.max(0, Math.min(newStart, ctx.initialEnd - 0.5));
          if (Math.abs(newStart - (scene.trimStart || 0)) > 0.05) {
            updateScene(sceneIndex, { trimStart: newStart });
            if (videoRef.current && currentScene?.id === trimmingSceneId) videoRef.current.currentTime = newStart;
          }
        } else {
          let newEnd = ctx.initialEnd + deltaSeconds;
          const maxDur = scene.videoDuration || 10.0;
          newEnd = Math.max(ctx.initialStart + 0.5, Math.min(newEnd, maxDur));
          if (Math.abs(newEnd - (scene.trimEnd || maxDur)) > 0.05) {
            updateScene(sceneIndex, { trimEnd: newEnd });
            if (videoRef.current && currentScene?.id === trimmingSceneId) videoRef.current.currentTime = newEnd;
          }
        }
      } else if (audioDragContext.current && audioTrack) {
        e.preventDefault();
        const ctx = audioDragContext.current;
        const deltaSeconds = (e.clientX - ctx.startX) / ctx.lockedZoom;
        const newStart = Math.max(0, ctx.initialTimelineStart + deltaSeconds);
        setAudioTrack({ ...audioTrack, timelineStart: newStart });
      }
    };
    const handleWindowMouseUp = () => {
      setIsScrubbing(false); setIsTrimming(null); setTrimmingSceneId(null); dragContext.current = null; audioDragContext.current = null; document.body.style.cursor = 'default';
    };
    if (isScrubbing || isTrimming || audioDragContext.current) {
      window.addEventListener('mousemove', handleWindowMouseMove);
      window.addEventListener('mouseup', handleWindowMouseUp);
      document.body.style.cursor = isTrimming ? 'ew-resize' : 'grabbing';
    }
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
      document.body.style.cursor = 'default';
    };
  }, [isScrubbing, isTrimming, trimmingSceneId, zoom, currentScene, validScenes, audioTrack, scenes, updateScene]);

  const handleRazorClick = (e: React.MouseEvent, scene: StoryScene) => {
    e.stopPropagation(); e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const timeInClip = clickX / zoom;
    const timing = getTiming(scene);
    const splitTime = timing.start + timeInClip;
    const globalIndex = scenes.findIndex(s => s.id === scene.id);
    if (globalIndex !== -1) handleSplitScene(globalIndex, splitTime);
  };

  const handleSplitScene = useCallback((index: number, splitTime: number) => {
    setScenes(prev => {
      const scene = prev[index];
      if (!scene) return prev;
      const next = [...prev];
      const clone = { ...scene, id: Date.now(), trimStart: splitTime, trimEnd: scene.trimEnd ?? (scene.videoDuration || 10) };
      next[index] = { ...scene, trimEnd: splitTime };
      next.splice(index + 1, 0, clone);
      return next;
    });
  }, [setScenes]);

  const handleCloneScene = useCallback((sourceSceneId: number, targetIndex: number) => {
    const source = scenes.find(s => s.id === sourceSceneId);
    if (!source) return;
    const clone: StoryScene = { ...source, id: Date.now(), includeInVideo: true };
    setScenes(prev => {
      const next = [...prev];
      next.splice(targetIndex, 0, clone);
      return next;
    });
  }, [scenes, setScenes]);

  const handleReorderScenes = useCallback((fromIndex: number, toIndex: number) => {
    setScenes(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, [setScenes]);

  const handleDragStart = (e: React.DragEvent, sceneId: number) => {
    if (activeTool === 'razor' || isTrimming) { e.preventDefault(); return; }
    setDraggedItem({ id: sceneId, type: 'scene', source: 'timeline' });
    e.dataTransfer.setData("text/plain", JSON.stringify({ id: sceneId, type: 'scene', source: 'timeline' }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragStartLibrary = (e: React.DragEvent, sceneId: number) => {
    setDraggedItem({ id: sceneId, type: 'scene', source: 'library' });
    e.dataTransfer.setData("text/plain", JSON.stringify({ id: sceneId, type: 'scene', source: 'library' }));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleDrop = (e: React.DragEvent, targetSceneId: number | -1) => {
    e.preventDefault(); e.stopPropagation();
    setDropIndicator(null);
    if (activeTool === 'razor') return;
    try {
      const data = JSON.parse(e.dataTransfer.getData("text/plain"));
      const draggedId = data.id; const type = data.type; const source = data.source;
      if (type === 'audio' && source === 'music') {
        setDraggedItem(null); return;
      }
      if (type === 'scene') {
        let dropIndex = -1;
        if (targetSceneId === -1) {
          const lastIndex = scenes.reduce((max, s, i) => (s.includeInVideo !== false ? i : max), -1);
          dropIndex = lastIndex + 1;
        } else {
          const targetIndexInMaster = scenes.findIndex(s => s.id === targetSceneId);
          if (targetIndexInMaster === -1) return;
          dropIndex = dropIndicator?.position === 'before' ? targetIndexInMaster : targetIndexInMaster + 1;
        }
        if (source === 'library') { handleCloneScene(draggedId, dropIndex); }
        else { const fromIndex = scenes.findIndex(s => s.id === draggedId); if (fromIndex !== -1 && dropIndex !== -1) { if (fromIndex < dropIndex) dropIndex--; handleReorderScenes(fromIndex, dropIndex); } }
      }
    } catch (err) { console.error("Drag Drop Error", err); }
    setDraggedItem(null);
  };

  const handleDragOverClip = (e: React.DragEvent, sceneId: number) => {
    if (draggedItem?.type === 'audio') { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; return; }
    if (activeTool === 'pointer' && !isTrimming) {
      e.preventDefault(); e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      const midpoint = rect.left + rect.width / 2;
      const position = e.clientX < midpoint ? 'before' : 'after';
      setDropIndicator({ index: sceneId, position });
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleVideoMetadata = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    const v = e.target as HTMLVideoElement;
    if (currentScene && v.duration && v.duration < (currentScene.trimEnd || 10)) {
      if (Math.abs(v.duration - (currentScene.trimEnd || 10)) > 0.5) {
        const idx = scenes.findIndex(s => s.id === currentScene.id);
        if (idx !== -1) updateScene(idx, { trimEnd: v.duration, videoDuration: v.duration });
      }
    }
  };

  const togglePlay = () => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        if (currentSceneIndex === validScenes.length - 1 && (videoRef.current.ended || videoRef.current.currentTime >= getTiming(currentScene).end - 0.1)) {
          setCurrentSceneIndex(0);
          if (validScenes.length > 0) videoRef.current.currentTime = getTiming(validScenes[0]).start;
        }
        videoRef.current.play().catch(() => {});
        setIsPlaying(true);
      } else {
        videoRef.current.pause();
        setIsPlaying(false);
      }
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeTab !== 'movie') return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (e.code === 'ArrowLeft' && videoRef.current && !isPlaying) {
        e.preventDefault();
        videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 0.1);
      }
      else if (e.code === 'ArrowRight' && videoRef.current && !isPlaying) {
        e.preventDefault();
        videoRef.current.currentTime = Math.min(videoRef.current.duration, videoRef.current.currentTime + 0.1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, togglePlay, isPlaying]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const updateTime = () => {
      if (isTransitioning.current || isScrubbing || isTrimming) return;
      if (currentScene) {
        const timing = getTiming(currentScene);
        if (video.currentTime >= timing.end - 0.05 || video.ended) playNextScene();
      }
      setSceneProgress(video.currentTime);
    };
    video.addEventListener('timeupdate', updateTime);
    video.addEventListener('ended', playNextScene);
    return () => { video.removeEventListener('timeupdate', updateTime); video.removeEventListener('ended', playNextScene); };
  }, [currentScene, currentSceneIndex, validScenes, playNextScene, isPlaying, isScrubbing, isTrimming]);

  useEffect(() => {
    if (currentScene && videoRef.current) {
      const video = videoRef.current;
      const lockTimeout = setTimeout(() => { if (isTransitioning.current) isTransitioning.current = false; }, 2000);
      let startPos = getTiming(currentScene).start;
      if (typeof (video as any)._pendingSeek === 'number') { startPos = (video as any)._pendingSeek; delete (video as any)._pendingSeek; }
      const onCanPlay = () => {
        clearTimeout(lockTimeout);
        isTransitioning.current = false;
        if (Math.abs(video.currentTime - startPos) > 0.1) video.currentTime = startPos;
        if (isPlaying) video.play().catch(() => {});
      };
      if (currentScene.videoUrl) {
        if (video.src !== currentScene.videoUrl) {
          isTransitioning.current = true;
          video.src = currentScene.videoUrl!;
          const handler = () => { video.removeEventListener('canplay', handler); onCanPlay(); };
          video.addEventListener('canplay', handler);
          video.load();
        }
      } else {
        video.src = "";
      }
      return () => clearTimeout(lockTimeout);
    }
  }, [currentScene, currentSceneIndex, isPlaying]);

  // Audio sync
  useEffect(() => {
    const audio = musicRef.current;
    if (!audio || !audioTrack) { if (audio) audio.pause(); return; }
    let accumulated = 0;
    for (let i = 0; i < currentSceneIndex; i++) accumulated += Math.max(0, getTiming(validScenes[i]).end - getTiming(validScenes[i]).start);
    if (currentScene) accumulated += Math.max(0, sceneProgress - getTiming(currentScene).start);
    const currentTimeGlobal = accumulated;
    const audioEnd = audioTrack.timelineStart + audioTrack.duration;
    if (isPlaying) {
      if (currentTimeGlobal >= audioTrack.timelineStart && currentTimeGlobal < audioEnd) {
        const expectedAudioTime = currentTimeGlobal - audioTrack.timelineStart + audioTrack.offset;
        if (audio.paused) audio.play().catch(() => {});
        if (Math.abs(audio.currentTime - expectedAudioTime) > 0.3) audio.currentTime = expectedAudioTime;
      } else { if (!audio.paused) audio.pause(); }
    } else { if (!audio.paused) audio.pause(); }
  }, [isPlaying, currentSceneIndex, sceneProgress, audioTrack, validScenes]);

  const handleRetryVideo = async (sceneId: number) => {
    const index = scenes.findIndex(s => s.id === sceneId);
    if (index === -1) return;
    const scene = scenes[index];
    if (!scene.imageUrl) return;
    updateScene(index, { isGeneratingVideo: true, error: undefined });
    try {
      const videoUrl = await generateSceneVideo(scene.imageUrl, scene.action_prompt, 10, aspectRatio);
      updateScene(index, { videoUrl, isGeneratingVideo: false, videoDuration: 10, trimStart: 0, trimEnd: 10 });
    } catch (err: any) {
      updateScene(index, { isGeneratingVideo: false, error: err.message });
    }
  };

  const exportFullMovie = async () => {
    const exportableScenes = validScenes.filter(s => s.videoUrl);
    if (exportableScenes.length === 0) return;

    setIsExporting(true); setExportProgress(0);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d"); if (!ctx) return;

    const offContainer = document.createElement("div");
    Object.assign(offContainer.style, { position: "fixed", left: "0px", top: "0px", width: "1px", height: "1px", opacity: "0.01", zIndex: "-1", overflow: "hidden" });
    document.body.appendChild(offContainer);
    const offVideo = document.createElement("video"); offVideo.crossOrigin = "anonymous"; offVideo.playsInline = true; offContainer.appendChild(offVideo);

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const audioCtx = new AudioContextClass({ sampleRate: 48000 });
    const dest = audioCtx.createMediaStreamDestination();
    await audioCtx.resume();

    const videoSrc = audioCtx.createMediaElementSource(offVideo);
    const videoGain = audioCtx.createGain(); videoGain.gain.value = 1.0;
    videoSrc.connect(videoGain); videoGain.connect(dest);

    const osc = audioCtx.createOscillator(); const oscGain = audioCtx.createGain(); oscGain.gain.value = 0.001; osc.connect(oscGain); oscGain.connect(dest); osc.start();

    const width = aspectRatio === "16:9" ? 1280 : 720;
    const height = aspectRatio === "16:9" ? 720 : 1280;
    canvas.width = width; canvas.height = height;
    const stream = canvas.captureStream(30);
    if (dest.stream.getAudioTracks().length > 0) stream.addTrack(dest.stream.getAudioTracks()[0]);

    const mimeType = MediaRecorder.isTypeSupported("video/mp4; codecs=avc1.42E01E, mp4a.40.2") ? "video/mp4; codecs=avc1.42E01E, mp4a.40.2" : "video/webm; codecs=vp9,opus";
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8000000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.start();

    try {
      for (let i = 0; i < exportableScenes.length; i++) {
        const scene = exportableScenes[i];
        const t = getTiming(scene);
        setExportProgress(Math.round((i / exportableScenes.length) * 100));
        offVideo.src = scene.videoUrl!; offVideo.muted = false; offVideo.volume = 0.8;
        await new Promise<void>((resolve, reject) => {
          const onCanPlay = () => { offVideo.removeEventListener("canplay", onCanPlay); resolve(); };
          offVideo.addEventListener("canplay", onCanPlay); offVideo.addEventListener("error", reject); offVideo.load();
        });
        offVideo.currentTime = t.start;
        await new Promise<void>(resolve => { const onSeeked = () => { offVideo.removeEventListener("seeked", onSeeked); resolve(); }; offVideo.addEventListener("seeked", onSeeked); });
        const playPromise = offVideo.play();
        await new Promise<void>(resolve => { const onPlaying = () => { offVideo.removeEventListener("playing", onPlaying); resolve(); }; offVideo.addEventListener("playing", onPlaying); });
        await playPromise;
        const drawFrame = () => {
          // Clear to black (letterbox)
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, width, height);
          // Calculate fit dimensions
          const vw = offVideo.videoWidth || width;
          const vh = offVideo.videoHeight || height;
          const videoAR = vw / vh;
          const canvasAR = width / height;
          let dw = width, dh = height, dx = 0, dy = 0;
          if (videoAR > canvasAR) {
            dh = width / videoAR;
            dy = (height - dh) / 2;
          } else {
            dw = height * videoAR;
            dx = (width - dw) / 2;
          }
          ctx.drawImage(offVideo, dx, dy, dw, dh);
        };
        while (true) {
          drawFrame();
          if (offVideo.currentTime >= t.end || offVideo.ended || offVideo.paused) break;
          await new Promise(r => requestAnimationFrame(r));
        }
        offVideo.pause();
      }
      recorder.stop(); osc.stop();
      await new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `Animatix_Movie.${mimeType.includes("mp4") ? "mp4" : "webm"}`; document.body.appendChild(a); a.click(); setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
    } catch (e) { console.error("Export Failed", e); alert("Export failed."); }
    finally { setIsExporting(false); setExportProgress(0); document.body.removeChild(offContainer); audioCtx.close(); }
  };

  const handleRemoveScene = (e: React.MouseEvent, sceneId: number) => {
    e.preventDefault(); e.stopPropagation(); setContextMenu(null);
    const originalIndex = scenes.findIndex(s => s.id === sceneId);
    if (originalIndex !== -1) updateScene(originalIndex, { includeInVideo: false });
  };

  const handleResetTrim = (sceneId: number) => {
    setContextMenu(null);
    const idx = scenes.findIndex(s => s.id === sceneId);
    if (idx !== -1) updateScene(idx, { trimStart: 0, trimEnd: scenes[idx].videoDuration || 10 });
  };

  const handleSplitCurrent = () => {
    if (currentScene && videoRef.current) {
      const splitTime = videoRef.current.currentTime;
      const globalIndex = scenes.findIndex(s => s.id === currentScene.id);
      if (globalIndex !== -1) handleSplitScene(globalIndex, splitTime);
    }
  };

  return (
    <div className="bg-black/90 rounded-2xl border border-zinc-800 shadow-2xl overflow-hidden flex flex-col h-full animate-fade-in select-none" onContextMenu={(e) => e.preventDefault()}>
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-80 bg-zinc-900 border-r border-zinc-800 flex flex-col shrink-0">
          <div className="flex border-b border-zinc-800">
            <button onClick={() => setSidebarTab('library')} className={`flex-1 py-3 text-sm font-semibold ${sidebarTab === 'library' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-300'}`}>Library</button>
            <button onClick={() => setSidebarTab('music')} className={`flex-1 py-3 text-sm font-semibold relative overflow-hidden ${sidebarTab === 'music' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-300'}`}>
              Soundtrack
              <div className="absolute top-1 right-[-20px] rotate-45 bg-indigo-600 text-[8px] text-white px-5 py-0.5 font-bold shadow-sm">SOON</div>
            </button>
          </div>
          {sidebarTab === 'library' && (
            <div className="flex-1 overflow-y-auto p-2">
              <div className="mb-3 px-1">
                <input type="file" ref={fileInputRef} className="hidden" accept="video/*" onChange={handleVideoUpload} />
                <Button onClick={() => fileInputRef.current?.click()} className="w-full text-xs py-2" variant="secondary">Upload Video</Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {uniqueLibraryScenes.map(scene => (
                  <div key={scene.id} draggable={!!scene.videoUrl} onDragStart={(e) => scene.videoUrl && handleDragStartLibrary(e, scene.id)} className={`relative aspect-video bg-black rounded border transition-all overflow-hidden group ${scene.videoUrl ? 'cursor-grab active:cursor-grabbing hover:border-indigo-500 border-zinc-600' : 'cursor-default border-zinc-800'} opacity-100`}>
                    <img src={scene.imageUrl} className={`w-full h-full object-cover ${!scene.videoUrl ? 'opacity-30' : ''}`} />
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-[10px] text-white px-1 truncate z-10">{scene.title}</div>
                    {scene.videoUrl && (
                      <button onClick={(e) => { e.stopPropagation(); downloadSingleVideo(scene.videoUrl!, scene.title); }} className="absolute top-1 right-1 p-1 bg-black/60 text-white rounded hover:bg-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {sidebarTab === 'music' && (
            <div className="p-4 flex-1 flex flex-col items-center justify-center text-center space-y-4">
              <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mb-2 animate-pulse">
                <svg className="w-8 h-8 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
              </div>
              <div>
                <h3 className="text-white font-bold text-lg">Soundtrack Generator</h3>
                <p className="text-zinc-400 text-xs mt-1 max-w-[200px] mx-auto">AI Music Generation is currently under maintenance. We'll be back online shortly!</p>
              </div>
              <div className="px-3 py-1 bg-indigo-500/10 text-indigo-300 text-[10px] font-mono rounded border border-indigo-500/20">
                STATUS: COMING SOON
              </div>
            </div>
          )}
        </div>

        {/* Video Preview */}
        <div className="flex-1 bg-black flex items-center justify-center relative group overflow-hidden" onClick={togglePlay}>
          {currentScene ? (
            currentScene.videoUrl ? (
              <div className="relative w-full h-full flex items-center justify-center p-4">
                <video ref={videoRef} className="max-w-full max-h-full shadow-2xl" style={ratioStyle} muted={false} playsInline onLoadedMetadata={handleVideoMetadata} />
                {!isPlaying && (
                  <div className="absolute inset-0 flex items-center justify-center z-10">
                    <div className="bg-black/50 p-6 rounded-full backdrop-blur-sm border border-white/10">
                      <svg className="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="relative w-full h-full flex items-center justify-center p-4">
                <div className="flex flex-col items-center gap-4 text-indigo-400">
                  <div className="animate-spin h-12 w-12 border-4 border-indigo-500 border-t-transparent rounded-full"></div>
                  <h3 className="text-xl font-bold animate-pulse">GENERATING SCENE...</h3>
                  <p className="text-zinc-400 text-sm">Please wait while we render your video.</p>
                </div>
              </div>
            )
          ) : (
            <div className="text-zinc-400 flex flex-col items-center"><p>No scenes in timeline.</p></div>
          )}
        </div>
      </div>

      {/* Hidden audio element */}
      {audioTrack && <audio ref={musicRef} src={audioTrack.url} preload="auto" />}

      {/* Timeline Panel */}
      <div className="h-[320px] bg-[#1e1e2e] border-t border-zinc-800 flex flex-col relative z-20 shrink-0">
        {/* Toolbar */}
        <div className="h-10 border-b border-zinc-800 flex items-center px-4 bg-[#181825] gap-4 justify-between shrink-0">
          <div className="flex items-center gap-2">
            <button onClick={togglePlay} className="p-1.5 rounded hover:bg-zinc-700 text-white" title="Play/Pause" disabled={!currentScene || !currentScene.videoUrl}>
              {isPlaying
                ? <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
                : <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
              }
            </button>
            <div className="w-[1px] h-4 bg-zinc-700 mx-2"></div>
            <button onClick={() => setActiveTool('pointer')} className={`p-1.5 rounded transition-colors ${activeTool === 'pointer' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-white'}`}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897" /></svg>
            </button>
            <button onClick={() => setActiveTool('razor')} className={`p-1.5 rounded transition-colors ${activeTool === 'razor' ? 'bg-red-600 text-white' : 'text-zinc-400 hover:text-white'}`}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" /></svg>
            </button>
            <div className="w-[1px] h-4 bg-zinc-700 mx-2"></div>
            <button onClick={handleSplitCurrent} disabled={!currentScene} className="p-1.5 rounded hover:bg-zinc-700 text-white disabled:opacity-50">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" /></svg>
            </button>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex bg-zinc-800 rounded p-0.5 border border-zinc-700">
              <button onClick={() => setTimeFormat('seconds')} className={`px-2 py-1 text-[9px] font-bold uppercase rounded ${timeFormat === 'seconds' ? 'bg-zinc-600 text-white' : 'text-zinc-400'}`}>SEC</button>
              <button onClick={() => setTimeFormat('frames')} className={`px-2 py-1 text-[9px] font-bold uppercase rounded ${timeFormat === 'frames' ? 'bg-zinc-600 text-white' : 'text-zinc-400'}`}>FRM</button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400">Zoom</span>
              <input type="range" min="5" max="100" value={zoom} onChange={(e) => setZoom(parseInt(e.target.value))} className="w-24 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer" />
            </div>
            <Button onClick={exportFullMovie} disabled={isExporting} className="h-7 text-xs px-4 bg-indigo-600 hover:bg-indigo-500 border-none">
              {isExporting ? `Exporting ${exportProgress}%` : 'Export Movie'}
            </Button>
          </div>
        </div>

        {/* Timeline */}
        <div
          ref={timelineContainerRef}
          className={`flex-1 overflow-x-auto overflow-y-hidden relative select-none custom-scrollbar bg-[#11111b] ${activeTool === 'razor' ? 'cursor-cell' : 'cursor-default'}`}
          onMouseDown={() => setContextMenu(null)}
        >
          <div
            style={{ width: `${Math.max(window.innerWidth, Math.max(totalSequenceDuration, audioTrack ? audioTrack.timelineStart + audioTrack.duration : 0) * zoom + 300)}px`, height: '100%' }}
            className="relative"
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
            onDrop={(e) => handleDrop(e, -1)}
          >
            {/* Ruler */}
            <div className="h-6 border-b border-zinc-700/50 flex items-end text-[10px] text-zinc-400 select-none bg-[#181825] sticky top-0 z-30" onMouseDown={handleTimelineMouseDown}>
              {Array.from({ length: Math.ceil(Math.max(10, totalSequenceDuration + (audioTrack ? audioTrack.duration : 0)) / 5) + 5 }).map((_, i) => (
                <div key={i} className="absolute bottom-0 border-l border-zinc-700 pl-1 h-3 pointer-events-none" style={{ left: `${i * 5 * zoom + 16}px` }}>{timeFormat === 'frames' ? `${i * 5 * 30}f` : `${i * 5}s`}</div>
              ))}
            </div>

            {/* Playhead */}
            <div className="absolute top-0 bottom-0 z-[200] pointer-events-none transition-transform duration-75" style={{ left: `${playheadPosPixels + 16}px` }}>
              <div className="w-4 h-4 bg-red-600 transform -translate-x-1/2 rotate-45 -mt-2 rounded-sm shadow-[0_2px_5px_rgba(0,0,0,0.5)] border border-white/50 relative z-50"></div>
              <div className="w-0.5 h-full bg-red-600 transform -translate-x-1/2 shadow-[0_0_10px_rgba(255,0,0,0.6)]"></div>
            </div>

            {/* Video Track */}
            <div className="absolute top-8 left-4 h-24 flex items-center w-full">
              <div className="absolute -left-14 top-8 text-[10px] font-bold text-zinc-400 w-10 text-right">V1</div>
              {validScenes.length === 0 && (
                <div className="absolute top-0 left-0 h-full w-[500px] flex items-center justify-center border-2 border-dashed border-zinc-700 rounded-lg bg-zinc-800/30 text-zinc-400 gap-3 pointer-events-none">
                  Drag videos from Library here
                </div>
              )}
              {validScenes.map((scene, i) => {
                const timing = getTiming(scene);
                const duration = Math.max(0, timing.end - timing.start);
                const clipWidth = Math.max(10, duration * zoom);
                const isActive = i === currentSceneIndex;
                const isDropTarget = dropIndicator && dropIndicator.index === scene.id;

                return (
                  <div key={scene.id} className="relative h-full flex items-center">
                    {isDropTarget && dropIndicator.position === 'before' && (
                      <div className="absolute left-[-2px] -top-4 -bottom-4 w-2 bg-red-600 shadow-[0_0_20px_rgba(255,0,0,1)] z-[1000] rounded-full pointer-events-none border border-white/80"></div>
                    )}
                    <div
                      style={{ width: `${clipWidth}px` }}
                      className={`h-full relative group shrink-0 select-none border-r border-[#11111b] transition-opacity ${isActive ? 'ring-2 ring-indigo-500 z-10' : 'opacity-90 hover:opacity-100'}`}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        if (e.button === 2) { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, sceneId: scene.id, type: 'scene' }); return; }
                        if (activeTool === 'razor') { handleRazorClick(e, scene); }
                        else if (activeTool === 'pointer') { setCurrentSceneIndex(i); }
                      }}
                      draggable={activeTool === 'pointer'}
                      onDragStart={(e) => handleDragStart(e, scene.id)}
                      onDragOver={(e) => handleDragOverClip(e, scene.id)}
                      onDrop={(e) => handleDrop(e, scene.id)}
                    >
                      <div className="absolute inset-0 bg-zinc-800 overflow-hidden pointer-events-none rounded-sm">
                        <div className="flex h-full w-full opacity-50">
                          {Array.from({ length: Math.ceil(clipWidth / 80) }).map((_, idx) => (
                            <img key={idx} src={scene.imageUrl} className="h-full w-[80px] object-cover border-r border-black/20" draggable={false} />
                          ))}
                        </div>
                      </div>
                      <div className="absolute top-1 left-2 text-xs font-bold text-white shadow-black drop-shadow-md pointer-events-none truncate w-[80%]">{scene.title}</div>
                      <div className="absolute bottom-1 right-2 text-[10px] font-mono text-zinc-300 pointer-events-none">{duration.toFixed(1)}s</div>
                      {scene.isGeneratingVideo && (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-30 flex-col">
                          <div className="animate-spin h-5 w-5 border-2 border-indigo-400 border-t-transparent rounded-full mb-1"></div>
                          <span className="text-[9px] font-bold text-indigo-300 uppercase tracking-wider animate-pulse">Rendering</span>
                        </div>
                      )}
                      <button onMouseDown={(e) => handleRemoveScene(e, scene.id)} className="absolute top-1 right-1 w-5 h-5 bg-red-600 hover:bg-red-500 text-white rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-50 cursor-pointer" style={{ pointerEvents: 'auto' }}>
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                      {activeTool === 'pointer' && (
                        <>
                          <div className="absolute top-0 bottom-0 left-0 w-4 cursor-ew-resize z-20 flex items-center justify-center group/left hover:bg-indigo-500/20" onMouseDown={(e) => handleTrimInit(e, 'start', scene)}>
                            <div className="h-8 w-1.5 bg-white rounded-full shadow-sm group-hover/left:bg-indigo-400"></div>
                          </div>
                          <div className="absolute top-0 bottom-0 right-0 w-4 cursor-ew-resize z-20 flex items-center justify-center group/right hover:bg-indigo-500/20" onMouseDown={(e) => handleTrimInit(e, 'end', scene)}>
                            <div className="h-8 w-1.5 bg-white rounded-full shadow-sm group-hover/right:bg-indigo-400"></div>
                          </div>
                        </>
                      )}
                    </div>
                    {isDropTarget && dropIndicator.position === 'after' && (
                      <div className="absolute right-[-2px] -top-4 -bottom-4 w-2 bg-red-600 shadow-[0_0_20px_rgba(255,0,0,1)] z-[1000] rounded-full pointer-events-none border border-white/80"></div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Audio Track */}
            {audioTrack && (
              <div className="absolute top-[140px] left-4 h-12 w-full">
                <div className="absolute -left-14 top-3 text-[10px] font-bold text-zinc-400 w-10 text-right">A1</div>
                <div
                  className="absolute h-full bg-green-900/70 border border-green-500/50 rounded cursor-grab active:cursor-grabbing hover:border-green-400 transition-colors group"
                  style={{ left: `${audioTrack.timelineStart * zoom}px`, width: `${audioTrack.duration * zoom}px` }}
                  onMouseDown={handleAudioMoveInit}
                  onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, sceneId: audioTrack.id, type: 'audio' }); }}
                >
                  <div className="absolute top-1 left-2 text-[10px] font-bold text-green-300">Audio</div>
                  <div className="absolute bottom-1 right-2 text-[9px] font-mono text-green-400">{audioTrack.duration.toFixed(1)}s</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div className="fixed z-[300] bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl py-1 min-w-[180px]" style={{ left: contextMenu.x, top: contextMenu.y }}>
          {contextMenu.type === 'scene' ? (
            <>
              <button onClick={() => handleRetryVideo(contextMenu.sceneId)} className="w-full text-left px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white">Regenerate Video</button>
              <button onClick={() => handleResetTrim(contextMenu.sceneId)} className="w-full text-left px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white">Reset Trim</button>
              <hr className="border-zinc-800 my-1" />
              <button onClick={(e) => handleRemoveScene(e, contextMenu.sceneId)} className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-zinc-800 hover:text-red-300">Remove from Timeline</button>
            </>
          ) : (
            <button onClick={() => { setAudioTrack(null); setContextMenu(null); }} className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-zinc-800 hover:text-red-300">Remove Audio</button>
          )}
        </div>
      )}
    </div>
  );
};
