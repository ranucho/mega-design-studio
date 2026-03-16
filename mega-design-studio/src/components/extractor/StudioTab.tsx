import React, { useState, useRef, useCallback } from 'react';
import { ExtractedFrame, ReferenceAsset, AssetType, GeneratedClip, VideoSegment } from '@/types';
import { ImagePreview } from '@/components/ui/ImagePreview';
import { useExtractor } from '@/contexts/ExtractorContext';
import { useApp } from '@/contexts/AppContext';
import { cleanImage, modifyImage, generateCharacterSheetFromReferences, generateAnimation, analyzeMotionInterval, refineVideoPrompt, describeVideoSegment, analyzeReelGrid, analyzeReskinResult } from '@/services/gemini';
import { parallelBatch } from '@/services/parallelBatch';
import { ReelGridAnalysis, SymbolConsistencyMap } from '@/types';

type OperationType = 'cleaning' | 'modifying';

export const StudioTab: React.FC = () => {
  const {
    segments, setSegments,
    activeSegmentId,
    videoAspectRatio,
    modificationPrompt, setModificationPrompt,
    referenceAssets, setReferenceAssets,
    clips, setClips,
    loadingAction, setLoadingAction,
  } = useExtractor();
  const { addAsset } = useApp();

  const isGeneratingSequenceRef = useRef(false);
  const [frameOperations, setFrameOperations] = useState<Map<string, OperationType>>(new Map());
  const [comparingFrameIds, setComparingFrameIds] = useState<Set<string>>(new Set());
  const [frameRedoCache, setFrameRedoCache] = useState<Map<string, string>>(new Map());
  const [lastBatchSegment, setLastBatchSegment] = useState<VideoSegment | null>(null);
  const [redoBatchSegment, setRedoBatchSegment] = useState<VideoSegment | null>(null);

  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewFrame, setPreviewFrame] = useState<ExtractedFrame | null>(null);
  const [modifyingFrame, setModifyingFrame] = useState<ExtractedFrame | null>(null);
  const [singleFramePrompt, setSingleFramePrompt] = useState("");
  const [singleFrameReference, setSingleFrameReference] = useState<string | null>(null);

  const [masterSheetUrl, setMasterSheetUrl] = useState<string | null>(null);
  const [isGeneratingSheet, setIsGeneratingSheet] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [generationQuality, setGenerationQuality] = useState<'fast' | 'pro'>('fast');
  const [replacingAssetId, setReplacingAssetId] = useState<string | null>(null);
  const replaceAssetInputRef = useRef<HTMLInputElement>(null);
  const [isGeneratingMotionPrompts, setIsGeneratingMotionPrompts] = useState(false);

  const activeSegment = segments.find(s => s.id === activeSegmentId);

  const getAspectRatioString = () => {
    if (videoAspectRatio >= 1.7) return '16:9';
    if (videoAspectRatio <= 0.6) return '9:16';
    if (videoAspectRatio > 1.2 && videoAspectRatio < 1.4) return '4:3';
    if (videoAspectRatio > 0.7 && videoAspectRatio < 0.8) return '3:4';
    return '1:1';
  };

  const currentKeyframes = activeSegment
    ? activeSegment.frames.filter(f => f.isKeyframe).sort((a, b) => a.timestamp - b.timestamp)
    : [];

  // --- Frame Operations ---

  const handleCleanFrame = useCallback(async (frameId: string) => {
    const frame = activeSegment?.frames.find(f => f.id === frameId);
    if (!frame) return;
    setFrameOperations(prev => new Map(prev).set(frameId, 'cleaning'));
    try {
      const ratio = getAspectRatioString();
      const cleaned = await cleanImage(frame.dataUrl, ratio);
      setSegments(prev => prev.map(seg => seg.id === activeSegmentId ? {
        ...seg, frames: seg.frames.map(f => f.id === frameId ? { ...f, cleanedDataUrl: cleaned } : f)
      } : seg));
    } catch { /* ignore */ } finally {
      setFrameOperations(prev => { const next = new Map(prev); next.delete(frameId); return next; });
    }
  }, [activeSegment, activeSegmentId, setSegments]);

  const handleRevertFrame = useCallback((frameId: string) => {
    setSegments(prev => prev.map(seg => {
      if (seg.id !== activeSegmentId) return seg;
      return { ...seg, frames: seg.frames.map(f => {
        if (f.id === frameId) {
          if (f.modifiedDataUrl) {
            const { modifiedDataUrl, ...rest } = f;
            setFrameRedoCache(prev => new Map(prev).set(frameId, f.modifiedDataUrl!));
            return rest;
          }
          if (f.cleanedDataUrl) { const { cleanedDataUrl, ...rest } = f; return rest; }
        }
        return f;
      })};
    }));
  }, [activeSegmentId, setSegments]);

  const handleRedoFrame = useCallback((frameId: string) => {
    const redoUrl = frameRedoCache.get(frameId);
    if (!redoUrl) return;
    setSegments(prev => prev.map(seg => {
      if (seg.id !== activeSegmentId) return seg;
      return { ...seg, frames: seg.frames.map(f => f.id === frameId ? { ...f, modifiedDataUrl: redoUrl } : f) };
    }));
    setFrameRedoCache(prev => { const next = new Map(prev); next.delete(frameId); return next; });
  }, [activeSegmentId, frameRedoCache, setSegments]);

  const handleRegenerateFrame = useCallback(async (frameId: string) => {
    const frame = activeSegment?.frames.find(f => f.id === frameId);
    if (!frame) return;
    const promptToUse = frame.lastModificationPrompt || modificationPrompt;
    if (!promptToUse) return;
    setFrameOperations(prev => new Map(prev).set(frameId, 'modifying'));
    try {
      const source = frame.baseImageForLastModification || frame.cleanedDataUrl || frame.dataUrl;
      const currentRatio = getAspectRatioString();
      const isEditMode = frame.lastModificationMode === 'edit';
      let effectiveAssets: ReferenceAsset[] = [...referenceAssets];
      if (masterSheetUrl && !isEditMode) {
        effectiveAssets = [{ id: 'master-sheet', url: masterSheetUrl, type: 'character_primary', name: 'Master Sheet' }, ...referenceAssets.filter(a => a.type !== 'character_primary')];
      }
      const modified = await modifyImage(source, promptToUse, currentRatio, effectiveAssets, isEditMode);
      setSegments(prev => prev.map(seg => {
        if (seg.id !== activeSegmentId) return seg;
        return { ...seg, frames: seg.frames.map(f => f.id === frameId ? { ...f, modifiedDataUrl: modified, lastModificationPrompt: promptToUse, lastModificationMode: isEditMode ? 'edit' : 'reskin' } : f) };
      }));
    } catch (err) { console.error(err); } finally {
      setFrameOperations(prev => { const next = new Map(prev); next.delete(frameId); return next; });
    }
  }, [activeSegment, activeSegmentId, modificationPrompt, referenceAssets, masterSheetUrl, setSegments]);

  const handleSingleFrameModification = useCallback(async () => {
    if (!modifyingFrame || !singleFramePrompt) return;
    const targetFrameId = modifyingFrame.id;
    const prompt = singleFramePrompt;
    const localRef = singleFrameReference;
    setModifyingFrame(null); setSingleFramePrompt(""); setSingleFrameReference(null);
    setFrameOperations(prev => new Map(prev).set(targetFrameId, 'modifying'));
    try {
      const source = modifyingFrame.modifiedDataUrl || modifyingFrame.cleanedDataUrl || modifyingFrame.dataUrl;
      const currentRatio = getAspectRatioString();
      const effectiveAssets: ReferenceAsset[] = [...referenceAssets];
      if (localRef) effectiveAssets.push({ id: 'temp-single', url: localRef, type: 'style', name: 'Frame Reference' });
      const modified = await modifyImage(source, prompt, currentRatio, effectiveAssets, true);
      setSegments(prev => prev.map(seg => {
        if (seg.id !== activeSegmentId) return seg;
        return { ...seg, frames: seg.frames.map(f => f.id === targetFrameId ? { ...f, modifiedDataUrl: modified, lastModificationPrompt: prompt, lastModificationMode: 'edit', baseImageForLastModification: source } : f) };
      }));
    } catch (err) { console.error(err); } finally {
      setFrameOperations(prev => { const next = new Map(prev); next.delete(targetFrameId); return next; });
    }
  }, [modifyingFrame, singleFramePrompt, singleFrameReference, referenceAssets, activeSegmentId, setSegments]);

  const handleApplyModifications = useCallback(async () => {
    if (!modificationPrompt || !activeSegment || activeSegment.frames.length === 0) return;
    setLastBatchSegment(JSON.parse(JSON.stringify(activeSegment)));
    setRedoBatchSegment(null);
    setFrameOperations(prev => {
      const next = new Map(prev);
      activeSegment.frames.forEach(f => next.set(f.id, 'modifying'));
      return next;
    });
    const currentRatio = getAspectRatioString();
    let effectiveAssets: ReferenceAsset[] = [...referenceAssets];
    if (masterSheetUrl) {
      effectiveAssets = [{ id: 'master-sheet', url: masterSheetUrl, type: 'character_primary', name: 'Master Sheet' }, ...referenceAssets.filter(a => a.type !== 'character_primary')];
    }
    const fullPrompt = modificationPrompt + ". Make sure the subject matches the original character posture, expression and position exactly like in the frames.";

    try {
      // --- Phase 0: Analyze grid structure from first frame ---
      let gridMetadata: ReelGridAnalysis | null = null;
      let symbolMap: SymbolConsistencyMap[] = [];
      const firstFrame = activeSegment.frames[0];
      const firstSource = firstFrame.cleanedDataUrl || firstFrame.dataUrl;

      try {
        setLoadingAction('Analyzing grid structure...');
        gridMetadata = await analyzeReelGrid(firstSource);
        if (!gridMetadata.isReelContent) {
          gridMetadata = null; // Not a reel — skip grid-aware flow
          console.log('[Grid-Aware Reskin] Non-reel content detected, using standard flow.');
        } else {
          console.log(`[Grid-Aware Reskin] Detected ${gridMetadata.rows}×${gridMetadata.cols} reel grid with ${gridMetadata.symbols.length} symbols.`);
        }
      } catch (err) {
        console.warn('[Grid-Aware Reskin] Grid analysis failed, proceeding without metadata:', err);
        gridMetadata = null;
      }

      // --- Phase 1: Reskin frame 1 (with grid metadata, no symbol map yet) ---
      setLoadingAction(gridMetadata ? 'Reskinning frame 1 (grid-aware)...' : 'Reskinning frames...');
      let firstReskinResult: string | null = null;

      try {
        const modified = await modifyImage(firstSource, fullPrompt, currentRatio, effectiveAssets, false, gridMetadata);
        firstReskinResult = modified;
        setSegments(prev => prev.map(seg => {
          if (seg.id !== activeSegment.id) return seg;
          return { ...seg, frames: seg.frames.map(f => f.id === firstFrame.id ? { ...f, modifiedDataUrl: modified, lastModificationPrompt: fullPrompt, lastModificationMode: 'reskin', baseImageForLastModification: firstSource } : f) };
        }));
      } catch (e) {
        console.error(`Failed frame 1 (${firstFrame.id})`, e);
      } finally {
        setFrameOperations(prev => { const next = new Map(prev); next.delete(firstFrame.id); return next; });
      }

      // --- Phase 2: Build symbol consistency map (reel content only) ---
      if (gridMetadata && firstReskinResult) {
        try {
          setLoadingAction('Building symbol consistency map...');
          symbolMap = await analyzeReskinResult(firstSource, firstReskinResult, gridMetadata);
          console.log(`[Grid-Aware Reskin] Symbol map built: ${symbolMap.length} unique mappings.`, symbolMap);
        } catch (err) {
          console.warn('[Grid-Aware Reskin] Symbol mapping failed, proceeding without:', err);
          symbolMap = [];
        }
      }

      // --- Phase 3: Reskin remaining frames with grid metadata + symbol map ---
      const remainingFrames = activeSegment.frames.slice(1);
      if (remainingFrames.length > 0) {
        setLoadingAction(gridMetadata ? `Reskinning ${remainingFrames.length} frames (grid-aware)...` : `Reskinning ${remainingFrames.length} frames...`);
        await parallelBatch(
          remainingFrames,
          async (frame) => {
            const source = frame.cleanedDataUrl || frame.dataUrl;
            const modified = await modifyImage(
              source, fullPrompt, currentRatio, effectiveAssets, false,
              gridMetadata, symbolMap.length > 0 ? symbolMap : undefined
            );
            return { frameId: frame.id, modified, source };
          },
          (result) => {
            setSegments(prev => prev.map(seg => {
              if (seg.id !== activeSegment.id) return seg;
              return { ...seg, frames: seg.frames.map(f => f.id === result.frameId ? { ...f, modifiedDataUrl: result.modified, lastModificationPrompt: fullPrompt, lastModificationMode: 'reskin', baseImageForLastModification: result.source } : f) };
            }));
            setFrameOperations(prev => { const next = new Map(prev); next.delete(result.frameId); return next; });
          },
          4,
          500,
        );
      }
    } catch { /* ignore */ } finally {
      // Clear ALL frame processing indicators to prevent stuck state
      setFrameOperations(new Map());
      setLoadingAction(null);
    }
  }, [modificationPrompt, activeSegment, referenceAssets, masterSheetUrl, setSegments, setLoadingAction]);

  const handleUndoBatch = () => {
    if (lastBatchSegment && activeSegmentId === lastBatchSegment.id) {
      const current = segments.find(s => s.id === activeSegmentId);
      if (current) setRedoBatchSegment(JSON.parse(JSON.stringify(current)));
      setSegments(prev => prev.map(s => s.id === lastBatchSegment.id ? lastBatchSegment : s));
      setLastBatchSegment(null);
    }
  };

  const handleRedoBatch = () => {
    if (redoBatchSegment && activeSegmentId === redoBatchSegment.id) {
      const current = segments.find(s => s.id === activeSegmentId);
      if (current) setLastBatchSegment(JSON.parse(JSON.stringify(current)));
      setSegments(prev => prev.map(s => s.id === redoBatchSegment.id ? redoBatchSegment : s));
      setRedoBatchSegment(null);
    }
  };

  // --- Asset Operations ---

  const handleAssetUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      Array.from(files).forEach((file) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          if (event.target?.result) {
            setReferenceAssets(prev => [...prev, { id: crypto.randomUUID(), url: event.target!.result as string, type: 'character_primary', name: '' }]);
          }
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const handleGenerateSheet = async () => {
    const primaryRefs = referenceAssets.filter(a => a.type === 'character_primary');
    if (primaryRefs.length === 0) return;
    setIsGeneratingSheet(true); setLoadingAction("Generating Master Character Sheet...");
    try {
      const sheetUrl = await generateCharacterSheetFromReferences(primaryRefs.map(r => r.url));
      setMasterSheetUrl(sheetUrl);
    } catch (err) { console.error(err); } finally { setIsGeneratingSheet(false); setLoadingAction(null); }
  };

  const handleReplaceAssetClick = (id: string) => { setReplacingAssetId(id); replaceAssetInputRef.current?.click(); };
  const handleReplaceAssetFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && replacingAssetId) {
      const reader = new FileReader();
      reader.onload = (event) => { if (event.target?.result) setReferenceAssets(prev => prev.map(a => a.id === replacingAssetId ? { ...a, url: event.target!.result as string } : a)); setReplacingAssetId(null); };
      reader.readAsDataURL(file);
    } else setReplacingAssetId(null);
  };

  const toggleCompare = (frameId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setComparingFrameIds(prev => { const next = new Set(prev); if (next.has(frameId)) next.delete(frameId); else next.add(frameId); return next; });
  };

  const removeFrame = (id: string) => { setSegments(prev => prev.map(seg => seg.id === activeSegmentId ? { ...seg, frames: seg.frames.filter(f => f.id !== id) } : seg)); };
  const toggleKeyframe = (frameId: string) => { setSegments(prev => prev.map(seg => { if (seg.id !== activeSegmentId) return seg; return { ...seg, frames: seg.frames.map(f => f.id === frameId ? { ...f, isKeyframe: !f.isKeyframe } : f) }; })); };
  const addQuickPrompt = (text: string) => { setModificationPrompt(prev => (prev.trim().length > 0 ? prev.trim() + " " : "") + text); };
  const handleSingleFrameReferenceUpload = (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (file) { const reader = new FileReader(); reader.onload = (event) => { if (event.target?.result) setSingleFrameReference(event.target.result as string); }; reader.readAsDataURL(file); } };

  const handleUpdateTransitionPrompt = (frameId: string, prompt: string) => {
    setSegments(prev => prev.map(s => { if (s.id !== activeSegmentId) return s; return { ...s, frames: s.frames.map(f => f.id === frameId ? { ...f, transitionPrompt: prompt } : f) }; }));
  };

  // --- Motion Prompt Generation ---

  const handleGenerateMotionPrompts = useCallback(async () => {
    if (!activeSegment) return;
    const keyframes = activeSegment.frames.filter(f => f.isKeyframe).sort((a, b) => a.timestamp - b.timestamp);
    if (keyframes.length < 2) return;
    setIsGeneratingMotionPrompts(true);
    setLoadingAction('Generating motion prompts...');
    try {
      const items = keyframes.slice(0, -1).map((startFrame, i) => ({
        startFrame,
        endFrame: keyframes[i + 1],
        // Original video frames → motion analysis
        originalStartImg: startFrame.dataUrl,
        originalEndImg: keyframes[i + 1].dataUrl,
        // Reskinned frames → style analysis
        styledStartImg: startFrame.modifiedDataUrl || startFrame.cleanedDataUrl || startFrame.dataUrl,
        styledEndImg: keyframes[i + 1].modifiedDataUrl || keyframes[i + 1].cleanedDataUrl || keyframes[i + 1].dataUrl,
        duration: keyframes[i + 1].timestamp - startFrame.timestamp,
        index: i,
      }));
      await parallelBatch(
        items,
        async (item) => {
          const result = await describeVideoSegment(
            [item.originalStartImg, item.originalEndImg],  // motion from originals
            [item.styledStartImg, item.styledEndImg],      // style from reskins
            item.duration,
          );
          return { prompt: result.prompt, startFrameId: item.startFrame.id };
        },
        (result, item, idx) => {
          setLoadingAction(`Analyzed transition ${idx + 1}/${items.length}...`);
          setSegments(prev => prev.map(seg => {
            if (seg.id !== activeSegmentId) return seg;
            return { ...seg, frames: seg.frames.map(f => f.id === result.startFrameId ? { ...f, transitionPrompt: result.prompt } : f) };
          }));
        },
        4,
        500,
      );
    } finally {
      setIsGeneratingMotionPrompts(false);
      setLoadingAction(null);
    }
  }, [activeSegment, activeSegmentId, setLoadingAction, setSegments]);

  // --- Sequence Generation ---

  const handleGenerateSequence = useCallback(async () => {
    if (!activeSegment || isGeneratingSequenceRef.current) return;
    const keyframes = activeSegment.frames.filter(f => f.isKeyframe).sort((a, b) => a.timestamp - b.timestamp);
    if (keyframes.length < 2) return;
    isGeneratingSequenceRef.current = true;
    setLoadingAction(`Preparing Keyframe Sequence (${keyframes.length - 1} Clips)`);
    const baseIndex = activeSegment.generatedClips.length;
    const ratioParam = videoAspectRatio < 1 ? '9:16' : '16:9';
    try {
      const items = keyframes.slice(0, -1).map((startFrame, i) => ({
        startFrame,
        endFrame: keyframes[i + 1],
        startImg: startFrame.modifiedDataUrl || startFrame.cleanedDataUrl || startFrame.dataUrl,
        endImg: (keyframes[i + 1].modifiedDataUrl || keyframes[i + 1].cleanedDataUrl || keyframes[i + 1].dataUrl),
        transitionPrompt: startFrame.transitionPrompt || activeSegment.prompt || "Cinematic video",
        targetDuration: keyframes[i + 1].timestamp - startFrame.timestamp,
        index: i,
      }));
      await parallelBatch(
        items,
        async (item, idx) => {
          const { url: currentVideoUrl } = await generateAnimation(item.startImg, item.endImg, item.transitionPrompt, ratioParam, generationQuality);
          const tempVideo = document.createElement('video');
          tempVideo.src = currentVideoUrl;
          await new Promise<void>(r => { tempVideo.onloadedmetadata = () => r(); tempVideo.onerror = () => r(); });
          const currentDuration = tempVideo.duration || 5;
          const requiredSpeed = item.targetDuration > 0 ? currentDuration / item.targetDuration : 1;
          const newClip: GeneratedClip = { id: crypto.randomUUID(), url: currentVideoUrl, startFrameId: item.startFrame.id, endFrameId: item.endFrame.id, index: baseIndex + idx + 1, speed: requiredSpeed, originalDuration: currentDuration, trimStart: 0, trimEnd: currentDuration };
          return newClip;
        },
        (newClip, item, idx) => {
          setLoadingAction(`Rendered Clip ${baseIndex + idx + 1} (Base Layer)...`);
          setSegments(prev => prev.map(seg => seg.id !== activeSegmentId ? seg : { ...seg, generatedClips: [...seg.generatedClips, newClip] }));
          // Auto-send to Editor timeline (sort by index to maintain order despite parallel completion)
          setClips(prev => {
            if (prev.some(c => c.id === newClip.id)) return prev;
            return [...prev, newClip].sort((a, b) => a.index - b.index);
          });
          // Add to global asset library
          addAsset({ id: newClip.id, url: newClip.url, name: `Clip ${baseIndex + idx + 1}`, type: 'style', mediaType: 'video' });
        },
        4,
        800,
      );
    } catch (err: any) { console.error(err); } finally { isGeneratingSequenceRef.current = false; setLoadingAction(null); }
  }, [activeSegment, activeSegmentId, generationQuality, videoAspectRatio, setLoadingAction, setSegments, addAsset]);

  const handleDeleteClip = (clipId: string) => { setSegments(prev => prev.map(seg => ({ ...seg, generatedClips: seg.generatedClips.filter(c => c.id !== clipId) }))); };

  // --- Drag & Drop for Storyboard ---

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => { e.dataTransfer.setData('text/plain', index.toString()); };
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); };
  const handleDrop = (e: React.DragEvent<HTMLDivElement>, dropIndex: number) => {
    e.preventDefault();
    if (!activeSegment) return;
    const dragIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (isNaN(dragIndex) || dragIndex === dropIndex) return;
    const frames = [...activeSegment.frames];
    const sortedKeyframes = frames.filter(f => f.isKeyframe).sort((a, b) => a.timestamp - b.timestamp);
    const dragFrame = sortedKeyframes[dragIndex];
    const dropFrame = sortedKeyframes[dropIndex];
    if (dragFrame && dropFrame) {
      const tempTime = dragFrame.timestamp;
      const newFrames = frames.map(f => {
        if (f.id === dragFrame.id) return { ...f, timestamp: dropFrame.timestamp };
        if (f.id === dropFrame.id) return { ...f, timestamp: tempTime };
        return f;
      });
      setSegments(prev => prev.map(s => s.id === activeSegment.id ? { ...s, frames: newFrames } : s));
    }
  };

  const PromptInsertionDropdown = ({ label, icon, filterType, assets, onInsert, genericTemplate, specificTemplate }: {
    label: string; icon: string; filterType?: AssetType; assets: ReferenceAsset[];
    onInsert: (text: string) => void; genericTemplate: string; specificTemplate: (name: string) => string;
  }) => {
    const [isOpen, setIsOpen] = useState(false);
    const filtered = filterType ? assets.filter(a => a.type === filterType) : assets;
    return (
      <div className="relative">
        <button onClick={() => setIsOpen(!isOpen)} className="text-[9px] bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white px-2 py-1 rounded border border-zinc-700 transition-colors flex items-center gap-1">
          <i className={`fas ${icon} text-[8px]`}></i> {label}
        </button>
        {isOpen && (
          <div className="absolute top-full left-0 mt-1 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl z-50 min-w-[200px] p-2 flex flex-col gap-1">
            <button onClick={() => { onInsert(genericTemplate); setIsOpen(false); }} className="text-left text-[10px] text-zinc-300 hover:bg-zinc-800 px-2 py-1.5 rounded">
              {genericTemplate.substring(0, 50)}...
            </button>
            {filtered.filter(a => a.name).map(a => (
              <button key={a.id} onClick={() => { onInsert(specificTemplate(a.name!)); setIsOpen(false); }} className="text-left text-[10px] text-indigo-300 hover:bg-zinc-800 px-2 py-1.5 rounded flex items-center gap-2">
                <img src={a.url} className="w-5 h-5 rounded object-cover" />
                {a.name}
              </button>
            ))}
            <button onClick={() => setIsOpen(false)} className="text-[9px] text-zinc-500 hover:text-white text-center py-1">Close</button>
          </div>
        )}
      </div>
    );
  };

  if (!activeSegment) {
    return <div className="text-center py-20 text-zinc-600 min-h-[60vh] flex items-center justify-center">Select or create a segment in the Capture tab to process frames.</div>;
  }

  return (
    <div className="h-full overflow-y-auto p-8 w-full max-w-7xl mx-auto space-y-10 animate-fade-in">
      {/* Section 1: Frame Processor */}
      <section>
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xs font-black uppercase tracking-widest text-zinc-400">1. Frame Processor</h3>
          <div className="text-[10px] text-zinc-500 uppercase font-bold">{activeSegment.frames.length} Assets</div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {activeSegment.frames.map((frame) => {
            const isComparing = comparingFrameIds.has(frame.id);
            let displayImage = frame.dataUrl;
            let badge = <span className="bg-zinc-800 text-zinc-500 px-2 py-0.5 rounded text-[9px] font-bold uppercase">Raw</span>;
            if (frame.modifiedDataUrl) {
              displayImage = isComparing ? (frame.cleanedDataUrl || frame.dataUrl) : frame.modifiedDataUrl;
              badge = <span className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30 border px-2 py-0.5 rounded text-[9px] font-bold uppercase">Modified</span>;
            } else if (frame.cleanedDataUrl) {
              displayImage = isComparing ? frame.dataUrl : frame.cleanedDataUrl;
              badge = <span className="bg-green-500/20 text-green-300 border-green-500/30 border px-2 py-0.5 rounded text-[9px] font-bold uppercase">Cleaned</span>;
            }
            const operation = frameOperations.get(frame.id);
            const isProcessing = !!operation;
            const keyframeIndex = currentKeyframes.findIndex(k => k.id === frame.id);

            return (
              <div key={frame.id} className="group relative bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-sm hover:border-zinc-600 transition-colors">
                <div className="absolute top-2 left-2 z-20 flex flex-col gap-1 items-start">
                  {frame.isKeyframe && <span className="bg-amber-500 text-black text-[9px] font-black uppercase px-2 py-1 rounded shadow-lg border border-amber-300/50">Keyframe #{keyframeIndex + 1}</span>}
                  {badge}
                </div>
                {(frame.cleanedDataUrl || frame.modifiedDataUrl) && !isProcessing && (
                  <div className="absolute top-2 right-2 z-20">
                    <button onClick={(e) => toggleCompare(frame.id, e)} className={`w-6 h-6 rounded-full flex items-center justify-center shadow-lg transition-all ${isComparing ? 'bg-indigo-500 text-white' : 'bg-black/60 text-white hover:bg-black'}`} title="Toggle Original/Modified">
                      <i className={`fas ${isComparing ? 'fa-eye-slash' : 'fa-eye'} text-[10px]`}></i>
                    </button>
                  </div>
                )}
                <div className="relative bg-black/50 cursor-pointer w-full" style={{ aspectRatio: videoAspectRatio }} onClick={() => setPreviewFrame(frame)}>
                  <img src={displayImage} className="w-full h-full object-cover" />
                  {isProcessing && (
                    <div className="absolute inset-0 z-10 bg-black/50 overflow-hidden flex items-center justify-center flex-col">
                      {operation === 'cleaning' && <span className="text-[10px] font-black uppercase tracking-widest text-green-400 animate-pulse">Cleaning</span>}
                      {operation === 'modifying' && <><i className="fas fa-wand-magic-sparkles text-indigo-400 text-2xl animate-bounce mb-2"></i><span className="text-[10px] font-black uppercase tracking-widest text-indigo-300 animate-pulse">Designing</span></>}
                    </div>
                  )}
                  {!isProcessing && (
                    <div className="absolute inset-0 bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-4 p-4">
                      <div className="flex gap-3 items-center">
                        <button title="Inspect" onClick={(e) => { e.stopPropagation(); setPreviewFrame(frame); }} className="w-8 h-8 rounded-full bg-zinc-700 hover:bg-white hover:text-black flex items-center justify-center transition-colors"><i className="fas fa-expand text-xs"></i></button>
                        {(frame.modifiedDataUrl || frame.cleanedDataUrl) && <button title="Undo" onClick={(e) => { e.stopPropagation(); handleRevertFrame(frame.id); }} className="w-8 h-8 rounded-full bg-zinc-700 hover:bg-yellow-500 hover:text-white flex items-center justify-center transition-colors"><i className="fas fa-undo text-xs"></i></button>}
                        {!frame.modifiedDataUrl && frameRedoCache.has(frame.id) && <button title="Redo" onClick={(e) => { e.stopPropagation(); handleRedoFrame(frame.id); }} className="w-8 h-8 rounded-full bg-zinc-700 hover:bg-blue-500 hover:text-white flex items-center justify-center transition-colors"><i className="fas fa-redo text-xs"></i></button>}
                        {frame.modifiedDataUrl && <button title="Regenerate" onClick={(e) => { e.stopPropagation(); handleRegenerateFrame(frame.id); }} className="w-8 h-8 rounded-full bg-zinc-700 hover:bg-blue-500 hover:text-white flex items-center justify-center transition-colors"><i className="fas fa-sync-alt text-xs"></i></button>}
                        <button title="Clean UI" onClick={(e) => { e.stopPropagation(); handleCleanFrame(frame.id); }} className="w-8 h-8 rounded-full bg-zinc-700 hover:bg-green-500 hover:text-white flex items-center justify-center transition-colors"><i className="fas fa-magic text-xs"></i></button>
                        <button title="Modify Frame" onClick={(e) => { e.stopPropagation(); setModifyingFrame(frame); }} className="w-8 h-8 rounded-full bg-zinc-700 hover:bg-indigo-500 hover:text-white flex items-center justify-center transition-colors"><i className="fas fa-wand-magic-sparkles text-xs"></i></button>
                        <button title="Delete" onClick={(e) => { e.stopPropagation(); removeFrame(frame.id); }} className="w-8 h-8 rounded-full bg-zinc-700 hover:bg-red-500 hover:text-white flex items-center justify-center transition-colors"><i className="fas fa-trash text-xs"></i></button>
                      </div>
                      <div className="flex gap-2 w-full pt-2 border-t border-white/10">
                        <button onClick={(e) => { e.stopPropagation(); toggleKeyframe(frame.id); }} className={`w-full py-1.5 text-[9px] font-bold uppercase rounded flex items-center justify-center gap-2 ${frame.isKeyframe ? 'bg-amber-500 text-black' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>
                          {frame.isKeyframe ? <><i className="fas fa-check"></i> In Sequence</> : <><i className="fas fa-plus"></i> Add to Sequence</>}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Section 2: Global Styling */}
      <section className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-8 h-8 rounded bg-indigo-600 flex items-center justify-center font-bold text-sm">2</div>
          <h3 className="text-sm font-black uppercase tracking-widest text-zinc-200">Global Styling</h3>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div>
            <label className="text-[10px] uppercase font-bold text-zinc-500 mb-2 block">Modification Prompt</label>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2 bg-black/50 border border-zinc-700 rounded-lg p-2">
                <textarea className="w-full bg-transparent text-sm text-white focus:outline-none resize-y min-h-[120px]" placeholder="E.g. Cyberpunk style, neon lights, rainy street..." value={modificationPrompt} onChange={e => setModificationPrompt(e.target.value)} rows={3} />
                <div className="flex flex-wrap gap-2 pt-2 border-t border-zinc-800">
                  <PromptInsertionDropdown label="Symbols" icon="fa-shapes" filterType="game_symbol" assets={referenceAssets} onInsert={addQuickPrompt} genericTemplate="Replace all the symbols to [SUBJECT]. Make sure to keep the source images symbols layout and order." specificTemplate={(name) => `Replace all the symbols with ${name} style symbols. Keep the source layout and order.`} />
                  <PromptInsertionDropdown label="Long Tile" icon="fa-grip-lines-vertical" filterType="long_game_tile" assets={referenceAssets} onInsert={addQuickPrompt} genericTemplate="Replace the tall vertical/long tile symbols with [SUBJECT]. Maintain the elongated shape." specificTemplate={(name) => `Replace the long tile symbols with ${name} style. Maintain the elongated shape.`} />
                  <PromptInsertionDropdown label="Characters" icon="fa-user" filterType="character_primary" assets={referenceAssets} onInsert={addQuickPrompt} genericTemplate="When there is no character in the source, leave it without a character." specificTemplate={(name) => `Make the character look like ${name}.`} />
                  <PromptInsertionDropdown label="Background" icon="fa-image" filterType="background" assets={referenceAssets} onInsert={addQuickPrompt} genericTemplate="Replace the background with [DESCRIBE BACKGROUND]." specificTemplate={(name) => `Replace the background with ${name}.`} />
                  <PromptInsertionDropdown label="Reels BG" icon="fa-border-all" assets={referenceAssets} onInsert={addQuickPrompt} genericTemplate="Replace the reels background/cabinet frame with [DESCRIBE THEME]. Keep the grid structure." specificTemplate={(name) => `Replace the reels background with ${name} theme. Keep the grid structure.`} />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleApplyModifications} className="flex-1 bg-zinc-800 hover:bg-zinc-700 px-4 py-2 rounded-lg text-xs font-bold uppercase whitespace-nowrap border border-zinc-700 hover:border-zinc-500 transition-colors">Apply to All Frames</button>
                {lastBatchSegment && activeSegmentId === lastBatchSegment.id && <button onClick={handleUndoBatch} className="bg-yellow-600/20 hover:bg-yellow-600 text-yellow-300 hover:text-white px-4 py-2 rounded-lg text-xs font-bold uppercase transition-colors border border-yellow-500/30"><i className="fas fa-undo mr-2"></i> Undo</button>}
                {redoBatchSegment && activeSegmentId === redoBatchSegment.id && <button onClick={handleRedoBatch} className="bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white px-4 py-2 rounded-lg text-xs font-bold uppercase transition-colors border border-blue-500/30"><i className="fas fa-redo mr-2"></i> Redo</button>}
              </div>
            </div>
          </div>
          <div>
            <div className="border border-zinc-800 rounded-lg p-4 bg-black/20 h-full">
              <label className="text-[9px] uppercase font-bold text-zinc-500 mb-2 flex items-center gap-2"><i className="fas fa-layer-group"></i> Asset Manager</label>
              <div className="flex flex-col gap-2 mb-2">
                {referenceAssets.map((asset) => (
                  <div key={asset.id} className="flex gap-3 bg-black/40 p-2 rounded-lg border border-zinc-700/50 group relative">
                    <div className="relative w-12 h-12 shrink-0 rounded overflow-hidden border border-zinc-700 group/thumb">
                      <img src={asset.url} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center gap-1">
                        <button onClick={() => setPreviewImage(asset.url)} className="w-5 h-5 rounded-full bg-zinc-800 hover:bg-white text-zinc-400 hover:text-black flex items-center justify-center transition-colors" title="View"><i className="fas fa-eye text-[9px]"></i></button>
                        <button onClick={() => handleReplaceAssetClick(asset.id)} className="w-5 h-5 rounded-full bg-zinc-800 hover:bg-indigo-500 text-zinc-400 hover:text-white flex items-center justify-center transition-colors" title="Replace"><i className="fas fa-pen text-[9px]"></i></button>
                      </div>
                    </div>
                    <div className="flex-1 flex flex-col justify-center gap-1">
                      <div className="flex justify-between items-center gap-2">
                        <input type="text" value={asset.name || ''} onChange={(e) => setReferenceAssets(prev => prev.map(a => a.id === asset.id ? { ...a, name: e.target.value } : a))} placeholder="Trigger Word" className="bg-transparent text-[9px] font-bold text-indigo-400 uppercase placeholder-zinc-700 outline-none w-full border-b border-transparent focus:border-indigo-500" />
                        {asset.name && <button onClick={() => { navigator.clipboard.writeText(asset.name || ''); setCopiedId(asset.id); setTimeout(() => setCopiedId(null), 1500); }} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white w-6 h-6 rounded flex items-center justify-center border border-zinc-700 transition-colors shrink-0" title="Copy"><i className={`fas ${copiedId === asset.id ? 'fa-check text-green-500' : 'fa-copy'} text-[10px]`}></i></button>}
                        <button onClick={() => setReferenceAssets(prev => prev.filter(a => a.id !== asset.id))} className="text-zinc-500 hover:text-red-400"><i className="fas fa-times"></i></button>
                      </div>
                      <select value={asset.type} onChange={(e) => setReferenceAssets(prev => prev.map(a => a.id === asset.id ? { ...a, type: e.target.value as AssetType } : a))} className="w-full bg-zinc-800 text-white text-[10px] rounded px-2 py-1 border border-zinc-700 outline-none focus:border-indigo-500">
                        <option value="game_symbol">Game Symbol</option>
                        <option value="long_game_tile">Long Tile / Wild</option>
                        <option value="wild_symbol">Wild Symbol</option>
                        <option value="object">Object / Prop</option>
                        <option value="character_primary">Primary Character</option>
                        <option value="character_secondary">Secondary Character</option>
                        <option value="background">Background</option>
                        <option value="style">Style Reference</option>
                      </select>
                    </div>
                  </div>
                ))}
                <input type="file" ref={replaceAssetInputRef} className="hidden" accept="image/*" onChange={handleReplaceAssetFileChange} />
                <label className="flex items-center justify-center w-full py-3 border border-dashed border-zinc-700 rounded-lg cursor-pointer hover:bg-zinc-800 transition-colors gap-2 text-zinc-500 hover:text-white">
                  <i className="fas fa-plus text-xs"></i><span className="text-[10px] font-bold uppercase">Add Reference Asset</span>
                  <input type="file" accept="image/*" multiple onChange={handleAssetUpload} className="hidden" />
                </label>
              </div>
              {referenceAssets.some(a => a.type === 'character_primary') && !masterSheetUrl && (
                <button onClick={handleGenerateSheet} disabled={isGeneratingSheet} className="w-full mt-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2">
                  {isGeneratingSheet ? <i className="fas fa-spinner animate-spin"></i> : <i className="fas fa-drafting-compass"></i>} Generate Master Sheet
                </button>
              )}
              {masterSheetUrl && (
                <div className="mt-3 bg-black/40 border border-indigo-500/30 rounded-lg p-2">
                  <div className="flex justify-between items-center mb-2"><span className="text-[9px] font-black uppercase text-indigo-400 tracking-widest">Active Master Reference</span><button onClick={() => setMasterSheetUrl(null)} className="text-zinc-500 hover:text-white text-[10px]"><i className="fas fa-times"></i></button></div>
                  <div className="w-full h-24 bg-black rounded overflow-hidden cursor-pointer" onClick={() => setPreviewImage(masterSheetUrl)}><img src={masterSheetUrl} className="w-full h-full object-cover" /></div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Section 3: Storyboard */}
      <section className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <div className="w-8 h-8 rounded bg-indigo-600 flex items-center justify-center font-bold text-sm">3</div>
            <h3 className="text-sm font-black uppercase tracking-widest text-zinc-200">Storyboard (Drag to Reorder)</h3>
          </div>
          {currentKeyframes.length >= 2 && (
            <button
              onClick={handleGenerateMotionPrompts}
              disabled={isGeneratingMotionPrompts || !!loadingAction}
              className="bg-purple-700 hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 shadow-lg transition-all"
            >
              {isGeneratingMotionPrompts ? <i className="fas fa-spinner animate-spin"></i> : <i className="fas fa-magic"></i>}
              {isGeneratingMotionPrompts ? 'Generating...' : 'Auto Motion Prompts'}
            </button>
          )}
        </div>
        {currentKeyframes.length < 2 ? (
          <div className="text-center py-8 border border-dashed border-zinc-800 rounded-xl bg-black/20"><p className="text-zinc-500 text-xs">Mark at least 2 keyframes in the Frame Processor to build a storyboard sequence.</p></div>
        ) : (
          <div className="space-y-4">
            {currentKeyframes.slice(0, -1).map((startFrame, i) => {
              const endFrame = currentKeyframes[i + 1];
              return (
                <div key={startFrame.id} draggable onDragStart={(e) => handleDragStart(e, i)} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, i)} className="flex flex-col md:flex-row gap-4 items-center bg-black/40 p-3 rounded-lg border border-zinc-800/50 cursor-move hover:border-indigo-500/50 transition-colors">
                  <div className="text-zinc-600 cursor-grab"><i className="fas fa-grip-vertical"></i></div>
                  <div className="relative w-16 h-16 shrink-0 rounded overflow-hidden border border-zinc-700"><img src={startFrame.modifiedDataUrl || startFrame.dataUrl} className="w-full h-full object-cover" /><span className="absolute bottom-0 left-0 right-0 bg-black/60 text-[8px] text-center text-white font-mono">KF #{i + 1}</span></div>
                  <div className="flex-1 w-full">
                    <label className="text-[9px] uppercase font-bold text-zinc-500 mb-1 block">Action / Transition {i + 1}</label>
                    <textarea className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-xs text-white focus:border-indigo-500 outline-none resize-y" placeholder={`Describe motion from KF ${i + 1} to ${i + 2}...`} value={startFrame.transitionPrompt || ""} onChange={(e) => handleUpdateTransitionPrompt(startFrame.id, e.target.value)} rows={3} />
                  </div>
                  <div className="relative w-16 h-16 shrink-0 rounded overflow-hidden border border-zinc-700"><img src={endFrame.modifiedDataUrl || endFrame.dataUrl} className="w-full h-full object-cover" /><span className="absolute bottom-0 left-0 right-0 bg-black/60 text-[8px] text-center text-white font-mono">KF #{i + 2}</span></div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Section 4: Export & Production */}
      <section className="bg-gradient-to-br from-zinc-900 to-black border border-zinc-800 rounded-2xl p-8 shadow-2xl">
        <div className="flex items-center gap-4 mb-6"><div className="w-8 h-8 rounded bg-indigo-600 flex items-center justify-center font-bold text-sm">4</div><h3 className="text-sm font-black uppercase tracking-widest text-zinc-200">Export & Production</h3></div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          <div>
            <label className="text-[10px] uppercase font-bold text-zinc-500 mb-2 block">Quality Settings</label>
            <div className="flex bg-zinc-900 p-1 rounded-lg border border-zinc-800 mb-4">
              <button onClick={() => setGenerationQuality('fast')} className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all flex items-center justify-center gap-2 ${generationQuality === 'fast' ? 'bg-zinc-700 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}><i className="fas fa-bolt text-[10px]"></i> Fast Preview</button>
              <button onClick={() => setGenerationQuality('pro')} className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all flex items-center justify-center gap-2 ${generationQuality === 'pro' ? 'bg-indigo-600 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}><i className="fas fa-star text-[10px]"></i> Pro Quality</button>
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold text-zinc-500 mb-2 block">Actions</label>
            <button onClick={handleGenerateSequence} disabled={!!loadingAction} className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white py-3 rounded-lg text-xs font-black uppercase tracking-widest shadow-lg shadow-indigo-500/20 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {loadingAction ? <><i className="fas fa-spinner animate-spin"></i> {loadingAction}</> : 'Render Sequence'}
            </button>
            <p className="text-[10px] text-zinc-500 mt-2 text-center">Mark 2+ Keyframes to create a sequence.</p>
          </div>
        </div>
        {activeSegment.generatedClips.length > 0 && (
          <div className="mt-8 border-t border-zinc-800 pt-8">
            <div className="flex justify-between items-center mb-4">
              <h4 className="text-xs font-black uppercase tracking-widest text-center">Sequence Output ({activeSegment.generatedClips.length} Clips)</h4>
              <span className="text-[10px] text-green-400 font-bold uppercase flex items-center gap-2">
                <i className="fas fa-check-circle"></i> Auto-synced to Editor
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {activeSegment.generatedClips.map((clip) => (
                <div key={clip.id} className="bg-black border border-zinc-800 rounded-xl overflow-hidden shadow-2xl relative group hover:border-zinc-600 transition-colors">
                  <div className="relative w-full bg-zinc-900 flex items-center justify-center" style={{ height: '420px' }}>
                    <video src={clip.url} controls className="w-full h-full object-contain" />
                  </div>
                  <div className="p-5 flex justify-between items-center bg-zinc-900 border-t border-zinc-800">
                    <span className="text-sm font-bold text-zinc-300 uppercase tracking-wide">Clip #{clip.index}</span>
                    <div className="flex gap-2">
                      <button onClick={() => handleDeleteClip(clip.id)} className="text-zinc-400 hover:text-red-500 transition-colors bg-black/50 hover:bg-black p-2 rounded-lg" title="Delete"><i className="fas fa-trash text-lg"></i></button>
                      <a href={clip.url} download={`veo-clip-${clip.index}.mp4`} className="text-zinc-400 hover:text-indigo-400 transition-colors bg-black/50 hover:bg-black p-2 rounded-lg" title="Download"><i className="fas fa-download text-lg"></i></a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Preview Modals */}
      {previewImage && <ImagePreview src={previewImage} onClose={() => setPreviewImage(null)} />}

      {previewFrame && (
        <div className="fixed inset-0 z-[200] bg-black/95 flex flex-col items-center justify-center p-4 backdrop-blur-xl cursor-default" onClick={() => setPreviewFrame(null)}>
          <button className="absolute top-6 right-6 text-zinc-500 hover:text-white text-4xl transition-colors z-[210]" onClick={() => setPreviewFrame(null)}><i className="fas fa-times"></i></button>
          {previewFrame.modifiedDataUrl ? (
            <div className="flex flex-col md:flex-row gap-4 w-full h-full items-center justify-center" onClick={(e) => e.stopPropagation()}>
              <div className="flex-1 flex items-center justify-center h-full">
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden relative w-full h-full flex items-center justify-center">
                  <img src={previewFrame.cleanedDataUrl || previewFrame.dataUrl} className="max-w-full max-h-full object-contain" />
                  <span className="absolute top-2 left-2 bg-black/60 px-2 py-1 rounded text-[10px] uppercase font-bold text-zinc-400">{previewFrame.cleanedDataUrl ? "Cleaned Source" : "Original Source"}</span>
                </div>
              </div>
              <div className="text-zinc-600 hidden md:block"><i className="fas fa-arrow-right text-2xl"></i></div>
              <div className="flex-1 flex items-center justify-center h-full">
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden relative w-full h-full flex items-center justify-center">
                  <img src={previewFrame.modifiedDataUrl} className="max-w-full max-h-full object-contain" />
                  <span className="absolute top-2 left-2 bg-indigo-600/80 px-2 py-1 rounded text-[10px] uppercase font-bold text-white shadow-lg">Generative Result</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
              <img src={previewFrame.cleanedDataUrl || previewFrame.dataUrl} className="max-w-full max-h-full object-contain rounded-lg shadow-2xl border border-zinc-800" />
            </div>
          )}
        </div>
      )}

      {/* Single Frame Edit Modal */}
      {modifyingFrame && (
        <div className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center p-6 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl flex flex-col gap-4">
            <div className="flex justify-between items-center border-b border-zinc-800 pb-4">
              <h3 className="text-lg font-black uppercase tracking-widest text-white">Modify Single Frame</h3>
              <button onClick={() => setModifyingFrame(null)} className="text-zinc-500 hover:text-white"><i className="fas fa-times"></i></button>
            </div>
            <div className="flex gap-4">
              <div className="w-1/3 aspect-video bg-black rounded-lg overflow-hidden border border-zinc-800 relative">
                <img src={modifyingFrame.modifiedDataUrl || modifyingFrame.cleanedDataUrl || modifyingFrame.dataUrl} className="w-full h-full object-cover opacity-60" />
                <div className="absolute inset-0 flex items-center justify-center"><span className="text-[10px] font-bold text-zinc-400 uppercase bg-black/60 px-2 py-1 rounded">{modifyingFrame.modifiedDataUrl ? 'Current Result' : 'Target Frame'}</span></div>
              </div>
              <div className="flex-1 flex flex-col gap-4">
                <div>
                  <label className="text-[10px] font-bold text-zinc-500 uppercase mb-2 block">Prompt</label>
                  <textarea value={singleFramePrompt} onChange={(e) => setSingleFramePrompt(e.target.value)} className="w-full bg-black border border-zinc-700 rounded-lg p-3 text-sm text-white focus:border-indigo-500 outline-none resize-none h-24" placeholder="Describe modification..." />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-zinc-500 uppercase mb-2 block">Reference (Optional)</label>
                  <div className="flex gap-2 items-center">
                    {singleFrameReference && <img src={singleFrameReference} className="w-10 h-10 rounded object-cover border border-zinc-700" />}
                    <label className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs px-4 py-2 rounded-lg cursor-pointer border border-zinc-700 flex items-center justify-center gap-2">
                      <i className="fas fa-upload"></i> Upload Reference
                      <input type="file" accept="image/*" onChange={handleSingleFrameReferenceUpload} className="hidden" />
                    </label>
                    {singleFrameReference && <button onClick={() => setSingleFrameReference(null)} className="text-zinc-500 hover:text-red-500 px-2"><i className="fas fa-trash"></i></button>}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setModifyingFrame(null)} className="px-4 py-2 text-xs font-bold uppercase text-zinc-400 hover:text-white">Cancel</button>
              <button onClick={handleSingleFrameModification} disabled={!singleFramePrompt} className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded-lg text-xs font-bold uppercase shadow-lg disabled:opacity-50 flex items-center gap-2">
                <i className="fas fa-wand-magic-sparkles"></i> Generate Frame
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
