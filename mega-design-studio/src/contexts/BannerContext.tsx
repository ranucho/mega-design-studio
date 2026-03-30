import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import {
  BannerProject,
  BannerComposition,
  BannerLayer,
  ExtractedElement,
  DetectedElement,
  BannerStage,
  BannerMode,
  BannerSkin,
  SkinIndexEntry,
  BANNER_PRESETS,
} from '@/types';
import { generateBannerLayout } from '@/services/gemini';
import { getLayerZOrder } from '@/services/gemini/banner-rules';
import { getBannerSkinIndex, getAllBannerSkins } from '@/services/skinDb';

interface BannerContextType {
  project: BannerProject | null;
  setProject: React.Dispatch<React.SetStateAction<BannerProject | null>>;

  // Workflow
  initProject: (sourceImage: string, width: number, height: number, mode: BannerMode) => void;
  setStage: (stage: BannerStage) => void;
  resetProject: () => void;

  // Elements
  addExtractedElement: (el: ExtractedElement) => void;
  removeExtractedElement: (id: string) => void;

  // Presets
  togglePreset: (key: string) => void;
  setSelectedPresets: (keys: string[]) => void;

  // Compositions
  addComposition: (comp: BannerComposition) => void;
  updateComposition: (id: string, updates: Partial<BannerComposition>) => void;
  updateLayer: (compId: string, layerId: string, updates: Partial<BannerLayer>) => void;
  activeCompositionId: string | null;
  setActiveCompositionId: (id: string | null) => void;

  // Generation
  generateCompositions: () => Promise<void>;

  // Banner Skins
  bannerSkins: BannerSkin[];
  setBannerSkins: React.Dispatch<React.SetStateAction<BannerSkin[]>>;
  activeBannerSkinId: string | null;
  setActiveBannerSkinId: (id: string | null) => void;
  bannerSkinIndex: SkinIndexEntry[];
  setBannerSkinIndex: React.Dispatch<React.SetStateAction<SkinIndexEntry[]>>;
}

const BannerContext = createContext<BannerContextType | null>(null);

export const useBanner = () => {
  const ctx = useContext(BannerContext);
  if (!ctx) throw new Error('useBanner must be used within BannerProvider');
  return ctx;
};

export const BannerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [project, setProject] = useState<BannerProject | null>(null);
  const [activeCompositionId, setActiveCompositionId] = useState<string | null>(null);

  // Banner Skins
  const [bannerSkins, setBannerSkins] = useState<BannerSkin[]>([]);
  const [activeBannerSkinId, setActiveBannerSkinId] = useState<string | null>(null);
  const [bannerSkinIndex, setBannerSkinIndex] = useState<SkinIndexEntry[]>(() => getBannerSkinIndex());

  useEffect(() => {
    getAllBannerSkins().then(skins => {
      if (skins.length > 0) setBannerSkins(skins);
    }).catch(console.error);
  }, []);

  const initProject = useCallback((sourceImage: string, width: number, height: number, mode: BannerMode) => {
    setProject({
      id: crypto.randomUUID(),
      sourceImage,
      sourceWidth: width,
      sourceHeight: height,
      detectedElements: [],
      extractedElements: [],
      compositions: [],
      selectedPresets: [],
      mode,
      stage: 'upload',
      isExtracting: false,
      isGenerating: false,
      extractionProcessedCount: 0,
    });
    setActiveCompositionId(null);
  }, []);

  const setStage = useCallback((stage: BannerStage) => {
    setProject(prev => prev ? { ...prev, stage } : null);
  }, []);

  const resetProject = useCallback(() => {
    setProject(null);
    setActiveCompositionId(null);
  }, []);

  const addExtractedElement = useCallback((el: ExtractedElement) => {
    setProject(prev => prev ? {
      ...prev,
      extractedElements: [...prev.extractedElements, el],
    } : null);
  }, []);

  const removeExtractedElement = useCallback((id: string) => {
    setProject(prev => prev ? {
      ...prev,
      extractedElements: prev.extractedElements.filter(e => e.id !== id),
    } : null);
  }, []);

  const togglePreset = useCallback((key: string) => {
    setProject(prev => {
      if (!prev) return null;
      const has = prev.selectedPresets.includes(key);
      return {
        ...prev,
        selectedPresets: has
          ? prev.selectedPresets.filter(k => k !== key)
          : [...prev.selectedPresets, key],
      };
    });
  }, []);

  const setSelectedPresets = useCallback((keys: string[]) => {
    setProject(prev => prev ? { ...prev, selectedPresets: keys } : null);
  }, []);

  const addComposition = useCallback((comp: BannerComposition) => {
    setProject(prev => prev ? {
      ...prev,
      compositions: [...prev.compositions, comp],
    } : null);
  }, []);

  const projectRef = useRef(project);
  projectRef.current = project;

  /**
   * Generate multi-layer compositions using AI-driven layout engine.
   * Each size gets its own AI-designed layout — not instant, but intelligent.
   * All elements are rendered as images (extracted assets), never live text.
   */
  const generateCompositions = useCallback(async () => {
    const proj = projectRef.current;
    if (!proj || proj.selectedPresets.length === 0) return;

    // Keep existing compositions that already have a preset key
    const existingComps = proj.compositions || [];
    const existingKeys = new Set(existingComps.map(c => c.presetKey).filter(Boolean));

    // Only generate for presets that DON'T already have a composition
    const presetsToGenerate = proj.selectedPresets
      .filter(key => !existingKeys.has(key))
      .map(key => BANNER_PRESETS.find(p => p.key === key))
      .filter((p): p is NonNullable<typeof p> => !!p);

    if (presetsToGenerate.length === 0) {
      // All selected sizes already exist — just go to edit
      setProject(prev => prev ? { ...prev, stage: 'edit' } : null);
      setActiveCompositionId(existingComps[0]?.id ?? null);
      return;
    }

    const elements = proj.extractedElements;

    setProject(prev => prev ? { ...prev, isGenerating: true } : null);

    const newCompositions: BannerComposition[] = [];

    // Generate layouts one at a time (AI call per size)
    for (const preset of presetsToGenerate) {
      try {
        const layoutResult = await generateBannerLayout(
          elements,
          preset.width,
          preset.height,
          proj.sourceWidth,
          proj.sourceHeight,
        );

        const layers: BannerLayer[] = layoutResult.map(item => {
          const el = elements.find(e => e.id === item.elementId);
          if (!el) return null;

          return {
            id: crypto.randomUUID(),
            type: 'image' as const,
            name: el.label,
            src: el.dataUrl,
            x: item.x,
            y: item.y,
            scaleX: item.scaleX,
            scaleY: item.scaleY,
            rotation: 0,
            flipX: false,
            flipY: false,
            opacity: 1,
            visible: item.visible,
            locked: el.role === 'background',
            role: el.role,
            nativeWidth: el.nativeWidth,
            nativeHeight: el.nativeHeight,
            text: el.detectedText,
            fontFamily: 'sans-serif',
            fontSize: 24,
            fontWeight: 700,
            fontColor: '#ffffff',
            textAlign: 'left' as const,
          };
        }).filter((l): l is BannerLayer => l !== null);

        layers.sort((a, b) => getLayerZOrder(a.role, a.name) - getLayerZOrder(b.role, b.name));

        newCompositions.push({
          id: crypto.randomUUID(),
          name: preset.name,
          presetKey: preset.key,
          width: preset.width,
          height: preset.height,
          layers,
          selectedLayerId: null,
          backgroundColor: '#000000',
          warnings: [],
          status: 'ready' as const,
        });

        // Update progress — merge existing + new so far
        setProject(prev => prev ? {
          ...prev,
          compositions: [...existingComps, ...newCompositions],
        } : null);
      } catch (err) {
        console.error(`Failed to generate layout for ${preset.name}:`, err);
      }
    }

    // Final state: merge existing compositions with newly generated ones
    const allCompositions = [...existingComps, ...newCompositions];

    setProject(prev => prev ? {
      ...prev,
      compositions: allCompositions,
      isGenerating: false,
      stage: 'edit',
    } : null);

    setActiveCompositionId(allCompositions[0]?.id ?? null);
  }, []);

  const updateComposition = useCallback((id: string, updates: Partial<BannerComposition>) => {
    setProject(prev => {
      if (!prev) return null;
      return {
        ...prev,
        compositions: prev.compositions.map(c =>
          c.id === id ? { ...c, ...updates } : c
        ),
      };
    });
  }, []);

  const updateLayer = useCallback((compId: string, layerId: string, updates: Partial<BannerLayer>) => {
    setProject(prev => {
      if (!prev) return null;
      return {
        ...prev,
        compositions: prev.compositions.map(c =>
          c.id === compId
            ? { ...c, layers: c.layers.map(l => l.id === layerId ? { ...l, ...updates } : l) }
            : c
        ),
      };
    });
  }, []);

  return (
    <BannerContext.Provider value={{
      project,
      setProject,
      initProject,
      setStage,
      resetProject,
      addExtractedElement,
      removeExtractedElement,
      togglePreset,
      setSelectedPresets,
      addComposition,
      updateComposition,
      updateLayer,
      activeCompositionId,
      setActiveCompositionId,
      generateCompositions,
      bannerSkins, setBannerSkins,
      activeBannerSkinId, setActiveBannerSkinId,
      bannerSkinIndex, setBannerSkinIndex,
    }}>
      {children}
    </BannerContext.Provider>
  );
};
