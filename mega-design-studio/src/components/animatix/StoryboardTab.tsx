import React, { useState, useCallback } from 'react';
import { StoryScene, Character } from '@/types';
import { Button } from '@/components/ui/Button';
import { ImagePreview } from '@/components/ui/ImagePreview';
import { AddSceneDialog } from './AddSceneDialog';
import { AspectRatioSelector } from '@/components/shared/AspectRatioSelector';
import { ExtendStoryDialog } from './ExtendStoryDialog';
import { useAnimatix } from '@/contexts/AnimatixContext';
import { useApp } from '@/contexts/AppContext';
import {
  generateSceneImage,
  editSceneImage,
  generateCharacterSheetFromStory,
  generateSceneVideo,
} from '@/services/gemini';
import { parallelBatch } from '@/services/parallelBatch';

/** Build video prompt that includes dialogue when present */
const buildVideoPrompt = (scene: StoryScene): string =>
  scene.dialogue
    ? `${scene.action_prompt} Dialogue: "${scene.dialogue}"`
    : scene.action_prompt;

export const StoryboardTab: React.FC = () => {
  const {
    scenes, setScenes,
    characters, setCharacters,
    style, brief,
    isApproved, setIsApproved,
    videoQueue, setVideoQueue,
    statusMessage, setStatusMessage,
    aspectRatio, setAspectRatio,
  } = useAnimatix();
  const { setActiveTab, loadingAction, addAsset, setAspectRatio: setAppAspectRatio } = useApp();

  // Sync both contexts when aspect ratio changes in storyboard
  const handleSetAspectRatio = (ar: string) => {
    setAspectRatio(ar);
    setAppAspectRatio(ar);
  };

  const [editModal, setEditModal] = useState<{ sceneId: number; activeTab: 'script' | 'fix' } | null>(null);
  const [charEditModal, setCharEditModal] = useState<{
    index: number;
    name: string;
    description: string;
    inputReferences: string[];
    masterBlueprint?: string;
  } | null>(null);

  const [tempVisual, setTempVisual] = useState("");
  const [tempAction, setTempAction] = useState("");
  const [tempDialogue, setTempDialogue] = useState("");
  const [fixInstruction, setFixInstruction] = useState("");
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [addSceneModal, setAddSceneModal] = useState<{ isOpen: boolean; insertIndex: number }>({ isOpen: false, insertIndex: -1 });
  const [extendDialogOpen, setExtendDialogOpen] = useState(false);

  const isLoading = !!loadingAction;

  // --- Handlers ---

  const updateScene = useCallback((index: number, updates: Partial<StoryScene>) => {
    setScenes(prev => {
      const next = [...prev];
      next[index] = { ...next[index], ...updates };
      return next;
    });
  }, [setScenes]);

  const handleRegenerateImage = useCallback(async (index: number) => {
    const scene = scenes[index];
    if (!scene) return;
    updateScene(index, { isGeneratingImage: true, error: undefined });
    try {
      const imageUrl = await generateSceneImage(scene, style, characters, aspectRatio);
      updateScene(index, { imageUrl, isGeneratingImage: false });
      // Bridge scene image to Lab
      addAsset({
        id: `animatix-scene-${scene.id}`,
        url: imageUrl,
        type: 'style',
        name: scene.title || `Scene ${index + 1}`,
      });
    } catch (err: any) {
      updateScene(index, { isGeneratingImage: false, error: err.message });
    }
  }, [scenes, characters, style, aspectRatio, updateScene, addAsset]);

  const handleEditImage = useCallback(async (index: number, prompt: string) => {
    const scene = scenes[index];
    if (!scene?.imageUrl) return;
    updateScene(index, { isGeneratingImage: true, error: undefined });
    try {
      const imageUrl = await editSceneImage(scene.imageUrl, prompt);
      updateScene(index, { imageUrl, isGeneratingImage: false });
      // Bridge edited scene image to Lab
      addAsset({
        id: `animatix-scene-${scene.id}`,
        url: imageUrl,
        type: 'style',
        name: `${scene.title || 'Scene'} (Edited)`,
      });
    } catch (err: any) {
      updateScene(index, { isGeneratingImage: false, error: err.message });
    }
  }, [scenes, updateScene, addAsset]);

  const handleReorderScenes = useCallback((fromIndex: number, toIndex: number) => {
    setScenes(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, [setScenes]);

  const handleAddScene = useCallback((insertIndex: number, description: string, dialogue: string, actionPrompt: string, _selectedCharIds: string[], image?: string) => {
    const newScene: StoryScene = {
      id: Date.now(),
      title: description.substring(0, 40),
      dialogue,
      visual_prompt: description,
      action_prompt: actionPrompt || description,
      camera_angle: 'Custom',
      imageUrl: image,
      includeInVideo: true,
    };
    setScenes(prev => {
      const next = [...prev];
      next.splice(insertIndex, 0, newScene);
      return next;
    });
    if (!image && isApproved) {
      const idx = insertIndex;
      setTimeout(() => handleRegenerateImage(idx), 100);
    }
  }, [setScenes, isApproved, handleRegenerateImage]);

  const handleDuplicateScene = useCallback((index: number) => {
    setScenes(prev => {
      const next = [...prev];
      const dup = { ...next[index], id: Date.now(), videoUrl: undefined, isGeneratingVideo: false };
      next.splice(index + 1, 0, dup);
      return next;
    });
  }, [setScenes]);

  const handleDeleteScene = useCallback((index: number) => {
    setScenes(prev => prev.filter((_, i) => i !== index));
  }, [setScenes]);

  const handleApprove = useCallback(async () => {
    setIsApproved(true);
    // Auto-generate images for ALL scenes in parallel batches
    const scenesNeedingImages = scenes
      .map((scene, i) => ({ scene, index: i }))
      .filter(({ scene }) => !scene.imageUrl && !scene.isGeneratingImage);

    if (scenesNeedingImages.length === 0) return;

    await parallelBatch(
      scenesNeedingImages,
      async ({ index }) => {
        await handleRegenerateImage(index);
      },
      undefined, // onItemDone not needed - handleRegenerateImage updates state internally
      4,   // batchSize
      800, // delayMs
    );
  }, [setIsApproved, scenes, handleRegenerateImage]);

  const handleExtendStory = useCallback(async (brief: string, sceneCount: number, chapterAR: string) => {
    setExtendDialogOpen(false);
    // For now, just create placeholder scenes - the full implementation would call the AI
    for (let i = 0; i < sceneCount; i++) {
      const newScene: StoryScene = {
        id: Date.now() + i,
        title: `Chapter Extension ${i + 1}`,
        dialogue: '',
        visual_prompt: brief,
        action_prompt: brief,
        camera_angle: 'Custom',
        aspectRatio: chapterAR,
        includeInVideo: true,
      };
      setScenes(prev => [...prev, newScene]);
    }
    // Auto-generate images if approved
    if (isApproved) {
      const startIdx = scenes.length;
      for (let i = 0; i < sceneCount; i++) {
        setTimeout(() => handleRegenerateImage(startIdx + i), i * 500);
      }
    }
  }, [scenes, isApproved, setScenes, handleRegenerateImage]);

  const handleGenerateVideos = useCallback(async () => {
    const scenesWithImages = scenes.filter(s => s.imageUrl && !s.videoUrl && !s.isGeneratingVideo);
    if (scenesWithImages.length === 0) {
      setActiveTab('movie');
      return;
    }

    // Mark all target scenes as generating before kicking off batches
    scenesWithImages.forEach(scene => {
      const index = scenes.findIndex(s => s.id === scene.id);
      if (index !== -1) updateScene(index, { isGeneratingVideo: true });
    });

    await parallelBatch(
      scenesWithImages,
      async (scene) => {
        const index = scenes.findIndex(s => s.id === scene.id);
        if (index === -1) return null;
        try {
          const videoUrl = await generateSceneVideo(scene.imageUrl!, buildVideoPrompt(scene), 10, aspectRatio);
          return { index, videoUrl, error: undefined };
        } catch (err: any) {
          return { index, videoUrl: undefined, error: err.message };
        }
      },
      (result, scene) => {
        if (!result || result.index === -1) return;
        if (result.videoUrl) {
          updateScene(result.index, { videoUrl: result.videoUrl, isGeneratingVideo: false, videoDuration: 10, trimStart: 0, trimEnd: 10 });
          // Bridge video to global asset library
          addAsset({
            id: `animatix-video-${scene.id}-${Date.now()}`,
            url: result.videoUrl,
            type: 'style',
            mediaType: 'video',
            name: scene.title || `Scene ${result.index + 1} Video`,
          });
        } else {
          updateScene(result.index, { isGeneratingVideo: false, error: result.error });
        }
      },
      4,   // batchSize
      800, // delayMs - rate limit sensitive
    );

    setActiveTab('movie');
  }, [scenes, aspectRatio, updateScene, setActiveTab, addAsset]);

  const handleRetryVideo = useCallback(async (sceneId: number) => {
    const index = scenes.findIndex(s => s.id === sceneId);
    if (index === -1) return;
    const scene = scenes[index];
    if (!scene.imageUrl) return;
    updateScene(index, { isGeneratingVideo: true, error: undefined });
    try {
      const videoUrl = await generateSceneVideo(scene.imageUrl, buildVideoPrompt(scene), 10, aspectRatio);
      updateScene(index, { videoUrl, isGeneratingVideo: false, videoDuration: 10, trimStart: 0, trimEnd: 10 });
      // Bridge video to global asset library
      addAsset({
        id: `animatix-video-${scene.id}-${Date.now()}`,
        url: videoUrl,
        type: 'style',
        mediaType: 'video',
        name: scene.title || `Scene ${index + 1} Video`,
      });
    } catch (err: any) {
      updateScene(index, { isGeneratingVideo: false, error: err.message });
    }
  }, [scenes, aspectRatio, updateScene, addAsset]);

  const handleUpdateCharacter = useCallback((index: number, updates: Partial<Character>) => {
    setCharacters(prev => {
      const next = [...prev];
      next[index] = { ...next[index], ...updates };
      return next;
    });
  }, [setCharacters]);

  const handleRegenerateCharacterSheet = useCallback(async (index: number) => {
    const char = characters[index];
    if (!char) return;
    setCharacters(prev => {
      const next = [...prev];
      next[index] = { ...next[index], masterBlueprint: undefined };
      return next;
    });
    try {
      const blueprint = await generateCharacterSheetFromStory(char, style, char.inputReferences);
      setCharacters(prev => {
        const next = [...prev];
        next[index] = { ...next[index], masterBlueprint: blueprint };
        return next;
      });
      // Bridge: add to global asset library for cross-module sharing
      addAsset({
        id: `animatix-char-${char.id}-${Date.now()}`,
        url: blueprint,
        type: 'character_primary',
        name: char.name || `Character ${index + 1}`,
      });
    } catch (err) {
      console.error(`Blueprint regeneration failed for ${char.name}`, err);
    }
  }, [characters, style, setCharacters, addAsset]);

  // --- Edit Modal Handlers ---

  const openEditModal = (scene: StoryScene, tab: 'script' | 'fix' = 'script') => {
    setTempVisual(scene.visual_prompt);
    setTempAction(scene.action_prompt);
    setTempDialogue(scene.dialogue);
    setFixInstruction("");
    setEditModal({ sceneId: scene.id, activeTab: tab });
  };

  const handleSaveScript = (regenerate: boolean) => {
    if (!editModal) return;
    const index = scenes.findIndex(s => s.id === editModal.sceneId);
    if (index !== -1) {
      updateScene(index, { visual_prompt: tempVisual, action_prompt: tempAction, dialogue: tempDialogue });
      if (regenerate && isApproved) handleRegenerateImage(index);
    }
    setEditModal(null);
  };

  const handleMagicFix = () => {
    if (!editModal || !fixInstruction.trim()) return;
    const index = scenes.findIndex(s => s.id === editModal.sceneId);
    if (index !== -1) handleEditImage(index, fixInstruction);
    setEditModal(null);
  };

  // --- Character Edit Modal Handlers ---

  const handleSaveCharacter = () => {
    if (!charEditModal) return;
    const idx = charEditModal.index;
    const oldChar = characters[idx];
    const descChanged = oldChar?.description !== charEditModal.description;
    const nameChanged = oldChar?.name !== charEditModal.name;
    const refsChanged = JSON.stringify(oldChar?.inputReferences) !== JSON.stringify(charEditModal.inputReferences);

    handleUpdateCharacter(idx, {
      name: charEditModal.name,
      description: charEditModal.description,
      inputReferences: charEditModal.inputReferences,
      masterBlueprint: charEditModal.masterBlueprint,
    });
    setCharEditModal(null);

    // Auto-regenerate blueprint if identity changed (name, description, or references)
    if (descChanged || nameChanged || refsChanged) {
      setTimeout(() => handleRegenerateCharacterSheet(idx), 200);
    }
  };

  const handleCharRefUpload = (idx: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setCharEditModal(prev => {
          if (!prev) return null;
          const newRefs = [...(prev.inputReferences || ['', '', ''])];
          newRefs[idx] = reader.result as string;
          return { ...prev, inputReferences: newRefs };
        });
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const handleCharBlueprintUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setCharEditModal(prev => prev ? { ...prev, masterBlueprint: reader.result as string } : null);
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  // --- Drag & Drop ---

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
    const img = new Image();
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    e.dataTransfer.setDragImage(img, 0, 0);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    setDragOverIndex(index);
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    handleReorderScenes(draggedIndex, index);
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  // --- Derived State ---

  const allBlueprintsReady = characters.every(c => c.masterBlueprint);
  const isGeneratingVideos = scenes.some(s => s.isGeneratingVideo);

  const visibleSceneItems = scenes
    .map((scene, index) => ({ scene, originalIndex: index }))
    .filter(item => !item.scene.isHiddenFromStoryboard);

  return (
    <div className="h-full overflow-y-auto space-y-8 pb-32 animate-fade-in p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-center bg-zinc-900 p-6 rounded-xl border border-zinc-800 shadow-2xl gap-4 sticky top-0 z-40 backdrop-blur-md bg-opacity-90">
        <div className="flex flex-col">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            Storyboard <span className="text-xs bg-indigo-900/50 px-2 py-0.5 rounded text-indigo-400 border border-indigo-500/30">{scenes.length} Scenes</span>
          </h2>
          <p className="text-xs text-zinc-400 mt-1 max-w-md line-clamp-1">{brief}</p>
        </div>
        <div className="flex gap-3 items-center">
          <AspectRatioSelector
            value={aspectRatio}
            onChange={handleSetAspectRatio}
            options={['16:9', '9:16', '1:1']}
            compact
          />
          {!isApproved ? (
            <Button
              onClick={handleApprove}
              disabled={!allBlueprintsReady || isLoading}
              className="bg-green-600 hover:bg-green-500 border-none shadow-lg shadow-green-900/20 px-8"
            >
              Approve Characters & Proceed
            </Button>
          ) : (
            <>
              <Button onClick={() => setAddSceneModal({ isOpen: true, insertIndex: scenes.length })} className="text-xs bg-zinc-800 hover:bg-zinc-700 border-zinc-700" variant="secondary">Add Scene</Button>
              <Button onClick={() => setExtendDialogOpen(true)} className="text-xs bg-emerald-700 hover:bg-emerald-600 border-emerald-600" variant="secondary">
                <i className="fas fa-layer-group mr-2"></i>Generate Chapter
              </Button>
              <Button onClick={handleGenerateVideos} disabled={isGeneratingVideos} isLoading={isGeneratingVideos}>
                Render Full Movie
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Cast Section */}
      <div className={`bg-zinc-900/50 p-6 rounded-2xl border transition-all duration-500 ${!isApproved ? 'border-indigo-500 ring-2 ring-indigo-500/20 bg-indigo-950/10' : 'border-zinc-800'}`}>
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-sm font-black text-indigo-300 uppercase tracking-widest flex items-center gap-2">
            Master Identity Blueprints
            {!isApproved && <span className="ml-2 px-2 py-0.5 bg-indigo-500 text-white text-[10px] rounded animate-pulse">ACTION REQUIRED: APPROVE TO START</span>}
          </h3>
        </div>
        <div className="flex gap-6 overflow-x-auto pb-4 custom-scrollbar">
          {characters.map((char, i) => (
            <div key={i} className={`flex-shrink-0 w-80 bg-zinc-900 rounded-xl border p-4 flex flex-col gap-4 transition-all duration-300 ${!isApproved ? 'border-indigo-500/50 shadow-xl shadow-indigo-950/50' : 'border-zinc-800'}`}>
              <div className="flex justify-between items-center">
                <h4 className="font-bold text-white truncate text-lg">{char.name}</h4>
                <div className="flex gap-1">
                  <button
                    onClick={() => setCharEditModal({ index: i, name: char.name, description: char.description, inputReferences: char.inputReferences || ['', '', ''], masterBlueprint: char.masterBlueprint })}
                    className="p-1.5 bg-zinc-800 hover:bg-indigo-600 text-zinc-400 hover:text-white rounded transition-colors"
                    title="Edit Identity, Refs & Style Sheet"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  </button>
                  <button
                    onClick={() => handleRegenerateCharacterSheet(i)}
                    className="p-1.5 bg-zinc-800 hover:bg-green-600 text-zinc-400 hover:text-white rounded transition-colors"
                    title="Regenerate Blueprint"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  </button>
                </div>
              </div>
              <div className="relative group cursor-pointer aspect-square bg-black rounded-lg overflow-hidden border border-zinc-700" onClick={() => char.masterBlueprint && setPreviewImage(char.masterBlueprint)}>
                {char.masterBlueprint ? (
                  <img src={char.masterBlueprint} className="w-full h-full object-contain" />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-zinc-400 gap-3">
                    <div className="animate-spin h-10 w-10 border-2 border-zinc-700 border-t-indigo-500 rounded-full"></div>
                    <span className="text-[10px] uppercase font-black tracking-widest">Constructing Actor...</span>
                  </div>
                )}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="text-[10px] text-white font-bold bg-black/60 px-3 py-1 rounded-full uppercase tracking-tighter">View Style Sheet</span>
                </div>
              </div>
              <div className="bg-zinc-950 p-2 rounded border border-zinc-800 min-h-[48px]">
                <p className="text-xs text-zinc-400 italic line-clamp-2">"{char.description}"</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Storyboard Grid */}
      <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 gap-y-12 transition-opacity duration-500 ${!isApproved ? 'opacity-50 pointer-events-none grayscale' : 'opacity-100'}`}>
        {visibleSceneItems.map(({ scene, originalIndex }, visualIndex) => (
          <div
            key={scene.id}
            onDragOver={(e) => handleDragOver(e, originalIndex)}
            onDrop={(e) => handleDrop(e, originalIndex)}
            className={`group relative overflow-visible transition-all duration-300 ${dragOverIndex === originalIndex ? 'scale-105 z-10' : ''}`}
          >
            {/* Floating add buttons */}
            <button
              onClick={() => setAddSceneModal({ isOpen: true, insertIndex: originalIndex })}
              className="absolute -left-8 top-1/2 -translate-y-1/2 z-50 w-8 h-8 bg-green-600 text-white rounded-full shadow-xl flex items-center justify-center opacity-0 group-hover:opacity-100 hover:scale-110 hover:bg-green-500 transition-all border-2 border-zinc-900 cursor-pointer"
              title="Insert Scene Before"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" /></svg>
            </button>
            <button
              onClick={() => setAddSceneModal({ isOpen: true, insertIndex: originalIndex + 1 })}
              className="absolute -right-8 top-1/2 -translate-y-1/2 z-50 w-8 h-8 bg-green-600 text-white rounded-full shadow-xl flex items-center justify-center opacity-0 group-hover:opacity-100 hover:scale-110 hover:bg-green-500 transition-all border-2 border-zinc-900 cursor-pointer"
              title="Insert Scene After"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" /></svg>
            </button>

            {/* Card */}
            <div className={`flex flex-col bg-zinc-900 border rounded-2xl overflow-hidden shadow-2xl ${dragOverIndex === originalIndex ? 'border-indigo-500 shadow-indigo-500/20' : 'border-zinc-800 hover:border-indigo-500/50'}`}>
              {/* Header */}
              <div className="p-3 bg-zinc-950 border-b border-zinc-800 flex justify-between items-center relative z-20">
                <div className="flex items-center gap-2 overflow-hidden">
                  <span className="bg-zinc-800 text-zinc-400 text-xs font-bold px-2 py-0.5 rounded shrink-0">#{visualIndex + 1}</span>
                  <span className="text-sm font-semibold text-zinc-200 truncate max-w-[200px]">{scene.title}</span>
                </div>
                <div
                  draggable
                  onDragStart={(e) => handleDragStart(e, originalIndex)}
                  className="cursor-grab active:cursor-grabbing p-1.5 text-red-500 hover:text-red-400 bg-red-900/10 hover:bg-red-900/20 rounded border border-red-900/20 hover:border-red-500/50 transition-colors"
                  title="Drag to reorder"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
                </div>
              </div>

              {/* Image Frame */}
              <div className="relative w-full bg-black aspect-video group/image border-b border-zinc-800">
                {scene.isGeneratingImage ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-900">
                    <div className="animate-spin h-8 w-8 border-2 border-indigo-500 border-t-transparent rounded-full"></div>
                    <span className="text-xs font-bold text-indigo-400 animate-pulse">Filming Scene...</span>
                  </div>
                ) : scene.imageUrl ? (
                  <>
                    <img src={scene.imageUrl} className="w-full h-full object-cover" />
                    {scene.videoUrl && (
                      <video
                        src={scene.videoUrl}
                        className="absolute inset-0 w-full h-full object-cover opacity-0 group-hover/image:opacity-100 transition-opacity z-[5]"
                        muted
                        loop
                        onMouseEnter={(e) => (e.target as HTMLVideoElement).play().catch(() => {})}
                        onMouseLeave={(e) => { const v = e.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
                      />
                    )}
                    <div className="absolute inset-0 bg-black/0 group-hover/image:bg-black/20 transition-colors flex items-center justify-center pointer-events-none">
                      <button
                        onClick={() => setPreviewImage(scene.imageUrl!)}
                        className="pointer-events-auto opacity-0 group-hover/image:opacity-100 p-2 bg-black/50 rounded-full text-white hover:bg-indigo-600 transition-all transform scale-90 group-hover/image:scale-100"
                        title="Full Screen"
                      >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-900/50">
                    <span className="text-xs text-zinc-400 font-medium">No footage available</span>
                    <Button variant="primary" onClick={() => handleRegenerateImage(originalIndex)} className="text-xs">
                      Generate Shot
                    </Button>
                  </div>
                )}
                {scene.error && (
                  <div className="absolute bottom-2 left-2 right-2 bg-red-900/90 text-white text-[10px] p-2 rounded border border-red-500 flex items-center gap-2">
                    <svg className="w-4 h-4 text-red-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <span className="truncate">{scene.error}</span>
                    <button onClick={() => handleRegenerateImage(originalIndex)} className="ml-auto underline hover:text-red-200">Retry</button>
                  </div>
                )}
              </div>

              {/* Toolbar */}
              <div className="flex items-center justify-between p-2 bg-zinc-900 border-b border-zinc-800 gap-1 shrink-0">
                <div className="flex gap-1">
                  <button title="Edit Script & Prompt" onClick={() => openEditModal(scene, 'script')} className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded transition-colors">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                  </button>
                  <button title="Magic Fix (In-Painting)" onClick={() => openEditModal(scene, 'fix')} className="p-1.5 text-zinc-400 hover:text-purple-400 hover:bg-zinc-800 rounded transition-colors">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  </button>
                  <button title="Regenerate Image" onClick={() => handleRegenerateImage(originalIndex)} className="p-1.5 text-zinc-400 hover:text-blue-400 hover:bg-zinc-800 rounded transition-colors">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  </button>
                </div>
                <div className="flex gap-1">
                  {scene.imageUrl && (
                    <button
                      onClick={() => handleRetryVideo(scene.id)}
                      disabled={scene.isGeneratingVideo}
                      title={scene.videoUrl ? "Retake Video" : "Generate Video"}
                      className={`p-1.5 rounded transition-all ${
                        scene.isGeneratingVideo ? 'bg-indigo-900/50 text-indigo-300 animate-pulse' :
                        scene.videoUrl ? 'text-green-400 hover:text-green-300 hover:bg-zinc-800' :
                        'text-indigo-400 hover:text-white hover:bg-indigo-600'
                      }`}
                    >
                      {scene.isGeneratingVideo ? (
                        <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                      ) : (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                      )}
                    </button>
                  )}
                  <button onClick={() => handleDuplicateScene(originalIndex)} className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded transition-colors" title="Duplicate">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  </button>
                  <button onClick={() => handleDeleteScene(originalIndex)} className="p-1.5 text-zinc-400 hover:text-red-400 hover:bg-zinc-800 rounded transition-colors" title="Delete">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              </div>

              {/* Content Body */}
              <div className="flex-1 p-4 flex flex-col gap-3 bg-zinc-900/50 border-t border-zinc-800/50">
                <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 relative group/dialogue">
                  <span className="absolute top-1 left-2 text-[9px] text-zinc-400 font-bold uppercase tracking-wider">Dialogue</span>
                  <p className="text-sm text-indigo-200 italic font-medium pt-3 leading-relaxed">"{scene.dialogue}"</p>
                </div>
                <div className="flex-1 space-y-2">
                  <div className="flex items-start gap-2">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase mt-0.5 w-12 shrink-0">Visual</span>
                    <p className="text-xs text-zinc-400 line-clamp-3 leading-relaxed">{scene.visual_prompt}</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase mt-0.5 w-12 shrink-0">Action</span>
                    <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">{scene.action_prompt}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}

        {/* Add Scene Card */}
        <button
          onClick={() => setAddSceneModal({ isOpen: true, insertIndex: scenes.length })}
          className={`border-2 border-dashed border-zinc-800 rounded-2xl flex flex-col items-center justify-center p-8 gap-4 text-zinc-400 hover:text-indigo-400 hover:border-indigo-500/50 hover:bg-zinc-900/50 transition-all min-h-[400px] ${!isApproved ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        >
          <div className="w-16 h-16 rounded-full bg-zinc-900 flex items-center justify-center border border-zinc-800 transition-colors shadow-xl">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          </div>
          <span className="font-bold uppercase tracking-widest text-sm">Add New Scene</span>
        </button>
      </div>

      {/* Character Edit Modal */}
      {charEditModal && (
        <div className="fixed inset-0 z-[150] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[95vh]">
            <div className="p-6 border-b border-zinc-800 flex justify-between items-center shrink-0">
              <h3 className="text-xl font-bold text-white uppercase tracking-tight">Modify Identity & Assets</h3>
              <button onClick={() => setCharEditModal(null)} className="text-zinc-400 hover:text-white">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-6 space-y-8 overflow-y-auto custom-scrollbar">
              <div className="grid md:grid-cols-2 gap-8">
                <div className="space-y-6">
                  <div>
                    <label className="text-xs text-zinc-400 uppercase font-black block mb-2">Actor Name</label>
                    <input value={charEditModal.name} onChange={(e) => setCharEditModal(prev => prev ? { ...prev, name: e.target.value } : null)} className="w-full bg-zinc-950 border border-zinc-700 rounded p-3 text-sm text-white focus:border-indigo-500 outline-none" />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400 uppercase font-black block mb-2">Physical Description</label>
                    <textarea value={charEditModal.description} onChange={(e) => setCharEditModal(prev => prev ? { ...prev, description: e.target.value } : null)} className="w-full h-40 bg-zinc-950 border border-zinc-700 rounded p-3 text-sm text-white focus:border-indigo-500 outline-none resize-none" placeholder="Hair color, clothes, build..." />
                  </div>
                  <div className="bg-indigo-950/30 border border-indigo-500/20 p-4 rounded-lg">
                    <p className="text-[10px] text-indigo-300 italic leading-relaxed">
                      <strong>GUIDE:</strong> The Reference Images help guide the initial design. The Master Style Sheet is the final source of truth for the AI to maintain consistency across scenes.
                    </p>
                  </div>
                </div>
                <div className="space-y-6">
                  <div>
                    <label className="text-xs text-zinc-400 uppercase font-black block mb-3">Input References (3 Slots)</label>
                    <div className="grid grid-cols-3 gap-3">
                      {[0, 1, 2].map(idx => (
                        <div key={idx} className="relative aspect-square bg-zinc-950 border border-zinc-700 rounded-lg overflow-hidden flex items-center justify-center group/ref">
                          {charEditModal.inputReferences[idx] ? (
                            <>
                              <img src={charEditModal.inputReferences[idx]} className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/ref:opacity-100 flex items-center justify-center transition-opacity gap-2 z-10">
                                <button onClick={() => setPreviewImage(charEditModal.inputReferences[idx])} className="p-1.5 bg-zinc-700 text-white rounded-full hover:bg-zinc-600" title="View">
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                </button>
                                <button onClick={() => {
                                  setCharEditModal(prev => {
                                    if (!prev) return null;
                                    const r = [...prev.inputReferences];
                                    r[idx] = '';
                                    return { ...prev, inputReferences: r };
                                  });
                                }} className="p-1.5 bg-red-600 text-white rounded-full hover:bg-red-500" title="Remove">
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                              </div>
                            </>
                          ) : (
                            <label className="w-full h-full flex flex-col items-center justify-center cursor-pointer hover:bg-zinc-800 transition-colors">
                              <svg className="w-5 h-5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                              <span className="text-[9px] font-bold text-zinc-400 mt-1">REF {idx + 1}</span>
                              <input type="file" accept="image/*" className="hidden" onChange={(e) => handleCharRefUpload(idx, e)} />
                            </label>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400 uppercase font-black block mb-3">Master Style Sheet</label>
                    <div className="relative aspect-video bg-zinc-950 border border-zinc-700 rounded-lg overflow-hidden flex items-center justify-center group/blueprint">
                      {charEditModal.masterBlueprint ? (
                        <>
                          <img src={charEditModal.masterBlueprint} className="w-full h-full object-contain" />
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/blueprint:opacity-100 flex items-center justify-center transition-opacity gap-2 z-10">
                            <button onClick={() => setPreviewImage(charEditModal.masterBlueprint!)} className="p-2 bg-zinc-700 text-white rounded-full hover:bg-zinc-600" title="View Full">
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                            </button>
                            <button onClick={() => setCharEditModal(prev => prev ? { ...prev, masterBlueprint: undefined } : null)} className="p-2 bg-red-600 text-white rounded-full hover:bg-red-500" title="Remove Sheet">
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          </div>
                        </>
                      ) : (
                        <label className="w-full h-full flex flex-col items-center justify-center cursor-pointer hover:bg-zinc-800 transition-colors border-2 border-dashed border-zinc-800 hover:border-indigo-500/50">
                          <svg className="w-8 h-8 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                          <span className="text-xs font-bold text-zinc-400 mt-2 uppercase">Upload Master Style Sheet</span>
                          <input type="file" accept="image/*" className="hidden" onChange={handleCharBlueprintUpload} />
                        </label>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-zinc-800 flex justify-end gap-3 bg-zinc-950/50 shrink-0">
              <Button variant="ghost" onClick={() => setCharEditModal(null)}>Discard</Button>
              <Button onClick={handleSaveCharacter}>Update Identity Profile</Button>
            </div>
          </div>
        </div>
      )}

      {/* Scene Edit Modal */}
      {editModal && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex border-b border-zinc-800 shrink-0">
              <button
                onClick={() => setEditModal(prev => prev ? { ...prev, activeTab: 'script' } : null)}
                className={`flex-1 py-4 text-sm font-bold uppercase tracking-wider transition-colors ${editModal.activeTab === 'script' ? 'bg-zinc-900 text-indigo-400 border-b-2 border-indigo-500' : 'bg-zinc-950 text-zinc-400 hover:text-zinc-300'}`}
              >
                Script & Direction
              </button>
              <button
                onClick={() => setEditModal(prev => prev ? { ...prev, activeTab: 'fix' } : null)}
                className={`flex-1 py-4 text-sm font-bold uppercase tracking-wider transition-colors ${editModal.activeTab === 'fix' ? 'bg-zinc-900 text-indigo-400 border-b-2 border-indigo-500' : 'bg-zinc-950 text-zinc-400 hover:text-zinc-300'}`}
              >
                Magic Fix (In-Painting)
              </button>
            </div>
            <div className="p-6 overflow-y-auto custom-scrollbar">
              {editModal.activeTab === 'script' ? (
                <div className="space-y-6">
                  <div>
                    <label className="text-xs font-bold text-zinc-400 uppercase block mb-2">Dialogue</label>
                    <input value={tempDialogue} onChange={(e) => setTempDialogue(e.target.value)} className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-white focus:border-indigo-500 outline-none" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-zinc-400 uppercase block mb-2">Visual Description (Image Gen)</label>
                    <textarea value={tempVisual} onChange={(e) => setTempVisual(e.target.value)} className="w-full h-32 bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-white focus:border-indigo-500 outline-none resize-none" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-zinc-400 uppercase block mb-2">Motion Prompt (Video Gen)</label>
                    <textarea value={tempAction} onChange={(e) => setTempAction(e.target.value)} className="w-full h-24 bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-white focus:border-indigo-500 outline-none resize-none" />
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="bg-indigo-900/20 border border-indigo-500/30 p-4 rounded-lg">
                    <h4 className="text-indigo-300 font-bold text-sm mb-1">Magic Fix</h4>
                    <p className="text-xs text-indigo-200/70">
                      Describe what you want to change in the image while keeping the rest the same.
                      <br />
                      <em>Example: "Make the character smile", "Change the background to sunset", "Add a red hat".</em>
                    </p>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-zinc-400 uppercase block mb-2">Instruction</label>
                    <input
                      value={fixInstruction}
                      onChange={(e) => setFixInstruction(e.target.value)}
                      placeholder="e.g., Remove the glasses, make the sky blue..."
                      className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-white focus:border-indigo-500 outline-none"
                      autoFocus
                    />
                  </div>
                  <div className="flex justify-end pt-4">
                    <Button onClick={handleMagicFix} disabled={!fixInstruction.trim()} className="w-full justify-center">
                      Apply Magic Fix
                    </Button>
                  </div>
                </div>
              )}
            </div>
            {editModal.activeTab === 'script' && (
              <div className="p-4 border-t border-zinc-800 flex justify-between bg-zinc-950/50 shrink-0">
                <Button variant="ghost" onClick={() => setEditModal(null)}>Cancel</Button>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => handleSaveScript(false)}>Save Text Only</Button>
                  <Button variant="primary" onClick={() => handleSaveScript(true)}>Save & Regenerate</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Image Preview */}
      {previewImage && <ImagePreview src={previewImage} onClose={() => setPreviewImage(null)} />}

      {/* Add Scene Dialog */}
      <AddSceneDialog
        isOpen={addSceneModal.isOpen}
        onClose={() => setAddSceneModal({ ...addSceneModal, isOpen: false })}
        onSubmit={(desc, dia, act, chars, img) => {
          handleAddScene(addSceneModal.insertIndex, desc, dia, act, chars, img);
          setAddSceneModal({ ...addSceneModal, isOpen: false });
        }}
        characters={characters}
        title="Add New Scene"
        aspectRatio={aspectRatio}
      />

      <ExtendStoryDialog
        isOpen={extendDialogOpen}
        onClose={() => setExtendDialogOpen(false)}
        onGenerate={handleExtendStory}
      />
    </div>
  );
};
