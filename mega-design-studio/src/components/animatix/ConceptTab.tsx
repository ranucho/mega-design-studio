import React, { useState, useEffect } from 'react';
import { Character } from '@/types';
import { Button } from '@/components/ui/Button';
import { ImagePreview } from '@/components/ui/ImagePreview';
import { useAnimatix } from '@/contexts/AnimatixContext';
import { AspectRatioSelector } from '@/components/shared/AspectRatioSelector';
import { useApp } from '@/contexts/AppContext';
import { generateRandomStoryConcept, generateStoryStructure, generateCharacterSheetFromStory } from '@/services/gemini';
import { parallelBatch } from '@/services/parallelBatch';

export const ConceptTab: React.FC = () => {
  const {
    characters, setCharacters,
    style, setStyle,
    brief, setBrief,
    sceneCount, setSceneCount,
    scenes, setScenes,
    storyTitle, setStoryTitle,
    setStep, statusMessage, setStatusMessage,
    aspectRatio: animatixAR, setAspectRatio: setAnimatixAR,
    setIsApproved,
  } = useAnimatix();
  const { setActiveTab, aspectRatio, setAspectRatio, addAsset } = useApp();

  // Sync both contexts when aspect ratio changes
  const handleSetAspectRatio = (ar: string) => {
    setAspectRatio(ar);
    setAnimatixAR(ar);
  };

  const [characterCount, setCharacterCount] = useState(characters.length);
  const [savedStyles, setSavedStyles] = useState<string[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isGeneratingLucky, setIsGeneratingLucky] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('megastudio_saved_styles');
      if (stored) setSavedStyles(JSON.parse(stored));
    } catch {}
  }, []);

  const handleSaveStyle = () => {
    if (!style.trim() || savedStyles.includes(style.trim())) return;
    const updated = [style.trim(), ...savedStyles];
    setSavedStyles(updated);
    localStorage.setItem('megastudio_saved_styles', JSON.stringify(updated));
  };

  const handleCountChange = (count: number) => {
    setCharacterCount(count);
    setCharacters(prev => {
      const newChars = [...prev];
      if (count > prev.length) {
        for (let i = prev.length; i < count; i++) {
          newChars.push({ id: String(i + 1), type: 'character', name: '', description: '', inputReferences: [] });
        }
      } else {
        newChars.splice(count);
      }
      return newChars;
    });
  };

  const updateCharacter = (index: number, field: keyof Character, value: any) => {
    setCharacters(prev => {
      const newChars = [...prev];
      newChars[index] = { ...newChars[index], [field]: value };
      return newChars;
    });
  };

  const handleImageUpload = (charIndex: number, refIndex: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      setCharacters(prev => {
        const newChars = [...prev];
        const refs = [...(newChars[charIndex].inputReferences || [])];
        refs[refIndex] = base64String;
        newChars[charIndex] = { ...newChars[charIndex], inputReferences: refs };
        return newChars;
      });
    };
    reader.readAsDataURL(file);
  };

  const removeImage = (charIndex: number, refIndex: number) => {
    setCharacters(prev => {
      const newChars = [...prev];
      const refs = [...(newChars[charIndex].inputReferences || [])];
      refs.splice(refIndex, 1);
      newChars[charIndex] = { ...newChars[charIndex], inputReferences: refs };
      return newChars;
    });
  };

  const handleFeelLucky = async () => {
    setIsGeneratingLucky(true);
    try {
      const concept = await generateRandomStoryConcept();
      setCharacters([]);
      setStyle("");
      setBrief("");
      setTimeout(() => {
        setCharacters(concept.characters);
        setStyle(concept.style);
        setBrief(concept.brief);
        handleSetAspectRatio(concept.aspectRatio);
        setSceneCount(concept.sceneCount);
        setCharacterCount(concept.characters.length);
      }, 100);
    } catch (e) {
      console.error("AI Generation failed", e);
      setBrief("A group of explorers discovers an ancient secret in a futuristic city.");
      setStyle("Cyberpunk 2077");
    } finally {
      setIsGeneratingLucky(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setStatusMessage("Generating story structure...");

    try {
      // Reset approval so new story requires re-approval (which triggers auto-generation)
      setIsApproved(false);
      // Sync aspect ratio to AnimatixContext before generating
      setAnimatixAR(aspectRatio);

      // Step 1: Generate story
      const storyData = await generateStoryStructure(characters, style, brief, sceneCount);
      setStoryTitle(storyData.title);
      setScenes(storyData.scenes.map((s, i) => ({
        id: i,
        title: s.title,
        dialogue: s.dialogue,
        visual_prompt: s.visual_prompt,
        action_prompt: s.video_prompt,
        camera_angle: s.camera_angle,
        includeInVideo: true,
      })));

      // Step 2: Generate character blueprints (parallel batches of 4)
      setStatusMessage(`Generating blueprints for ${characters.length} entities...`);
      await parallelBatch(
        characters,
        async (char, i) => {
          setStatusMessage(`Generating blueprint for ${char.name || `Entity ${i + 1}`}...`);
          const blueprint = await generateCharacterSheetFromStory(
            char,
            style,
            char.inputReferences
          );
          return { blueprint, index: i, char };
        },
        (result) => {
          const { blueprint, index, char } = result;
          setCharacters(prev => {
            const updated = [...prev];
            updated[index] = { ...updated[index], masterBlueprint: blueprint };
            return updated;
          });
          // Bridge to global asset library for Lab access
          addAsset({
            id: `animatix-char-${char.id}`,
            url: blueprint,
            type: char.type === 'background' ? 'background' :
                  char.type === 'object' ? 'object' : 'character_primary',
            name: char.name || `Entity ${index + 1}`,
          });
        },
        4,
        500,
      );

      setStatusMessage('');
      setActiveTab('storyboard');
    } catch (err: any) {
      console.error("Story generation failed:", err);
      setStatusMessage(`Error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto max-w-3xl mx-auto space-y-8 p-6">
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-8 shadow-xl backdrop-blur-sm">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-white">Define your Story</h2>
          <Button
            variant="ghost"
            onClick={handleFeelLucky}
            disabled={isLoading || isGeneratingLucky}
            className="text-sm px-3 py-1.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
          >
            {isGeneratingLucky ? <div className="animate-spin h-4 w-4 border-2 border-indigo-400 border-t-transparent rounded-full mr-1" /> : <span className="mr-1"><i className="fa-solid fa-dice" /></span>}
            I'm Feeling Lucky
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Entity & Scene Count */}
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">Number of Entities (1-4)</label>
              <div className="flex gap-2">
                {[1, 2, 3, 4].map(num => (
                  <button key={num} type="button" onClick={() => handleCountChange(num)}
                    className={`w-12 h-12 rounded-lg font-bold transition-all ${characterCount === num ? 'bg-indigo-600 text-white ring-2 ring-indigo-400' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
                  >{num}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">Number of Scenes (1-12)</label>
              <div className="flex gap-2 flex-wrap">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(num => (
                  <button key={num} type="button" onClick={() => setSceneCount(num)}
                    className={`w-10 h-10 md:w-11 md:h-11 rounded-lg font-bold transition-all ${sceneCount === num ? 'bg-indigo-600 text-white ring-2 ring-indigo-400' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
                  >{num}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Characters */}
          <div className="space-y-4">
            {characters.map((char, charIdx) => (
              <div key={char.id} className="p-4 bg-zinc-800/50 rounded-xl border border-zinc-700/50">
                <div className="flex flex-col md:flex-row items-start gap-4">
                  {/* Reference Images */}
                  <div className="flex-shrink-0 flex flex-col gap-2 w-full md:w-48">
                    <label className="block text-xs font-semibold text-indigo-300 text-center">References (Up to 3)</label>
                    <div className="grid grid-cols-3 gap-1 w-full">
                      {[0, 1, 2].map((refIdx) => {
                        const currentImage = char.inputReferences?.[refIdx];
                        return (
                          <div key={refIdx} className="relative aspect-square bg-zinc-900 border border-zinc-600 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-indigo-500 hover:bg-zinc-800 transition-colors overflow-hidden group/image">
                            {currentImage ? (
                              <>
                                <img src={currentImage} alt={`Ref ${refIdx + 1}`} className="w-full h-full object-cover z-0 pointer-events-none" />
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/image:opacity-100 transition-opacity flex items-center justify-center gap-1 z-20">
                                  <button type="button" onClick={(e) => { e.stopPropagation(); setPreviewImage(currentImage); }}
                                    className="p-1 bg-black/50 hover:bg-black/80 text-white rounded-full backdrop-blur-sm border border-white/10" title="View">
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                    </svg>
                                  </button>
                                  <button type="button" onClick={(e) => { e.stopPropagation(); removeImage(charIdx, refIdx); }}
                                    className="p-1 bg-red-600/80 hover:bg-red-500 text-white rounded-full" title="Remove">
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                </div>
                              </>
                            ) : (
                              <>
                                <svg className="w-5 h-5 text-zinc-400 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                <input type="file" accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer z-10" onChange={(e) => handleImageUpload(charIdx, refIdx, e)} />
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {char.inputReferences && char.inputReferences.length > 0 && (
                      <div className="flex items-center justify-center gap-2 bg-zinc-900 rounded p-1 border border-zinc-700">
                        <span className={`text-[9px] font-bold ${!char.preserveOriginal ? 'text-indigo-400' : 'text-zinc-400'}`}>Adapt Style</span>
                        <button type="button" onClick={() => updateCharacter(charIdx, 'preserveOriginal', !char.preserveOriginal)}
                          className={`w-8 h-4 rounded-full relative transition-colors ${char.preserveOriginal ? 'bg-green-600' : 'bg-zinc-700'}`}>
                          <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${char.preserveOriginal ? 'left-4.5' : 'left-0.5'}`} />
                        </button>
                        <span className={`text-[9px] font-bold ${char.preserveOriginal ? 'text-green-400' : 'text-zinc-400'}`}>Keep Exact</span>
                      </div>
                    )}
                  </div>

                  {/* Name & Description */}
                  <div className="flex-1 space-y-4 w-full">
                    <div className="flex justify-between items-center gap-2">
                      <h3 className="text-sm font-semibold text-indigo-300">Entity {charIdx + 1}</h3>
                      <select value={char.type || 'character'} onChange={(e) => updateCharacter(charIdx, 'type', e.target.value as any)}
                        className="bg-zinc-900 border border-zinc-700 text-xs rounded px-2 py-1 text-zinc-300 outline-none focus:border-indigo-500 cursor-pointer">
                        <option value="character">Character</option>
                        <option value="object">Object / Vehicle</option>
                        <option value="background">Background / Environment</option>
                      </select>
                    </div>
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="md:col-span-1">
                        <input type="text" placeholder="Name" value={char.name}
                          onChange={(e) => updateCharacter(charIdx, 'name', e.target.value)}
                          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-white focus:border-indigo-500 outline-none" required />
                      </div>
                      <div className="md:col-span-2">
                        <input type="text" placeholder="Description (e.g., Tall robot with rusted armor)" value={char.description}
                          onChange={(e) => updateCharacter(charIdx, 'description', e.target.value)}
                          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-white focus:border-indigo-500 outline-none" required />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Style, Aspect Ratio, Brief */}
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-medium text-zinc-400">Visual Style</label>
                {savedStyles.length > 0 && (
                  <select className="bg-zinc-900 border border-zinc-700 text-xs rounded px-2 py-1 text-zinc-300 outline-none focus:border-indigo-500 max-w-[200px]"
                    onChange={(e) => { if (e.target.value) setStyle(e.target.value); }} value="">
                    <option value="" disabled>Load Saved...</option>
                    {savedStyles.map((s, i) => <option key={i} value={s}>{s.substring(0, 30)}{s.length > 30 ? '...' : ''}</option>)}
                  </select>
                )}
              </div>
              <div className="flex gap-2">
                <input type="text" placeholder="e.g., Cyberpunk 2077, 1950s Noir, Watercolor" value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-white focus:border-indigo-500 outline-none" required />
                <button type="button" onClick={handleSaveStyle} disabled={!style.trim() || savedStyles.includes(style.trim())}
                  className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-indigo-400 rounded-lg border border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                  <i className="fa-solid fa-bookmark" />
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">Aspect Ratio</label>
              <AspectRatioSelector
                value={aspectRatio}
                onChange={handleSetAspectRatio}
                options={['16:9', '9:16']}
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-zinc-400 mb-2">Brief Storyline</label>
              <textarea placeholder="Describe the plot..." value={brief} onChange={(e) => setBrief(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-white focus:border-indigo-500 outline-none h-[42px] min-h-[42px] resize-none overflow-hidden"
                style={{ height: 'auto', minHeight: '42px' }}
                onInput={(e) => { e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px'; }}
                required />
            </div>
          </div>

          {/* Status & Submit */}
          {statusMessage && (
            <div className="p-3 bg-indigo-900/20 border border-indigo-500/30 rounded-lg text-sm text-indigo-200 animate-pulse">
              {statusMessage}
            </div>
          )}

          <div className="pt-4 flex justify-end">
            <Button type="submit" isLoading={isLoading}>
              Generate Storyboard
            </Button>
          </div>
        </form>
      </div>

      {previewImage && <ImagePreview src={previewImage} onClose={() => setPreviewImage(null)} />}
    </div>
  );
};
