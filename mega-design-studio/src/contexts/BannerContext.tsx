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
import { renderCompositionToDataUrl } from '@/utils/renderComposition';
import { getLayerZOrder } from '@/services/gemini/banner-rules';
import { parallelBatch } from '@/services/parallelBatch';
import { getBannerSkinIndex, getAllBannerSkins, putBannerSkin } from '@/services/skinDb';
import { fetchAllBannerSkinsFromFiles, saveBannerSkinToFile } from '@/services/skinFileSync';

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
  generateCompositions: (opts?: { regenerateUntouched?: boolean; onlyKeys?: string[]; forceAll?: boolean }) => Promise<void>;
  applyCtaShorteningToExisting: (shortenOn: boolean) => void;

  // Banner Skins
  bannerSkins: BannerSkin[];
  setBannerSkins: React.Dispatch<React.SetStateAction<BannerSkin[]>>;
  activeBannerSkinId: string | null;
  setActiveBannerSkinId: (id: string | null) => void;
  bannerSkinIndex: SkinIndexEntry[];
  setBannerSkinIndex: React.Dispatch<React.SetStateAction<SkinIndexEntry[]>>;
}

const BannerContext = createContext<BannerContextType | null>(null);

/**
 * Find a composition to use as a layout reference for `targetComp`.
 * Prefers Facebook kickoff sizes (fb-feed, fb-stories, fullhd-landscape) that the user
 * has edited/approved, then any other edited/approved composition with matching aspect class.
 */
const FB_KICKOFF_KEYS = ['fb-feed', 'fb-square', 'fb-stories', 'fullhd-landscape'];

export const findLayoutTemplate = (
  targetComp: BannerComposition,
  allComps: BannerComposition[],
): BannerComposition | null => {
  const targetRatio = targetComp.width / targetComp.height;
  const isUserTouched = (c: BannerComposition) =>
    c.status === 'edited' || c.status === 'approved';
  const hasLayers = (c: BannerComposition) => c.layers.length > 0;

  // Collect all viable templates (touched with layers, not self)
  const candidates = allComps.filter(
    c => c.id !== targetComp.id && (isUserTouched(c) || c.status === 'ready') && hasLayers(c),
  );
  if (candidates.length === 0) return null;

  // Score each candidate by how close its aspect ratio is to the target.
  // Prefer FB kickoffs over others, and exact aspect match above all.
  const scored = candidates.map(c => {
    const cRatio = c.width / c.height;
    const aspectDiff = Math.abs(cRatio - targetRatio) / Math.max(cRatio, targetRatio);
    const isFbKickoff = FB_KICKOFF_KEYS.includes(c.presetKey);
    const isTouched = isUserTouched(c);
    // Lower score = better match
    // Aspect diff is weighted most heavily, then prefer touched kickoffs
    return {
      comp: c,
      score: aspectDiff * 100 + (isFbKickoff && isTouched ? 0 : isTouched ? 1 : 2),
    };
  });

  scored.sort((a, b) => a.score - b.score);
  return scored[0].comp;
};

/**
 * Check if two sizes are similar enough for deterministic proportional scaling.
 * Requirements:
 * 1. Same orientation class (both landscape, both portrait, both square-ish)
 * 2. Aspect ratios within 40% of each other (prevents scaling 1920x1080→728x90)
 *
 * If ratios differ too much, AI layout is needed even within the same orientation.
 */
const isSameOrientation = (w1: number, h1: number, w2: number, h2: number): boolean => {
  const r1 = w1 / h1;
  const r2 = w2 / h2;
  // Must be same general orientation
  const orient = (r: number) => r > 1.1 ? 'landscape' : r < 0.9 ? 'portrait' : 'square';
  if (orient(r1) !== orient(r2)) return false;
  // Must have similar aspect ratios — otherwise proportional scaling distorts layout
  // 25% threshold: allows 1920x1080→1280x720 (0%), 1080x1920→720x1280 (0%),
  // but pushes 1080x1350, 336x280, 300x250 to AI for better composition
  const ratioDiff = Math.abs(r1 - r2) / Math.max(r1, r2);
  return ratioDiff < 0.25;
};

/**
 * Deterministically scale a template layout to a new canvas size.
 * ONLY used when template and target have similar aspect ratios.
 *
 * Strategy: FILL + clamp (no dead space).
 * - Scale by max(sx, sy) so the composition FILLS the target canvas entirely
 * - Center the scaled composition (overflow on one axis)
 * - Clamp each element so it stays within canvas bounds
 * - Background uses cover mode (fill canvas)
 * - Layer order and visibility preserved exactly
 */
const scaleLayoutFromTemplate = (
  template: BannerComposition,
  targetW: number,
  targetH: number,
  elements: ExtractedElement[],
): Array<{
  elementId: string;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  visible: boolean;
}> => {
  const sx = targetW / template.width;
  const sy = targetH / template.height;
  // Use MAX to FILL the canvas (no dead space). Some elements may overflow,
  // so we clamp positions afterwards.
  const uniformScale = Math.max(sx, sy);

  // Offset to center the scaled composition (will be negative on the overflow axis)
  const scaledW = template.width * uniformScale;
  const scaledH = template.height * uniformScale;
  const offsetX = (targetW - scaledW) / 2;
  const offsetY = (targetH - scaledH) / 2;

  return template.layers
    .filter(l => l.type === 'image' && l.src)
    .map(l => {
      const el = elements.find(e => e.label === l.name && e.role === l.role)
        || elements.find(e => e.label === l.name)
        || elements.find(e => e.role === l.role && e.dataUrl === l.src);
      if (!el) return null;

      if (l.role === 'background') {
        const coverScale = Math.max(targetW / el.nativeWidth, targetH / el.nativeHeight);
        return {
          elementId: el.id,
          x: Math.round((targetW - el.nativeWidth * coverScale) / 2),
          y: Math.round((targetH - el.nativeHeight * coverScale) / 2),
          scaleX: coverScale,
          scaleY: coverScale,
          visible: l.visible,
        };
      }

      // Scale position and size
      let rawX = l.x * uniformScale + offsetX;
      let rawY = l.y * uniformScale + offsetY;
      const elW = el.nativeWidth * l.scaleX * uniformScale;
      const elH = el.nativeHeight * l.scaleY * uniformScale;

      // Clamp: ensure the element stays within canvas bounds
      // Don't let it start before 0 or end after canvas edge
      rawX = Math.max(0, Math.min(rawX, targetW - elW));
      rawY = Math.max(0, Math.min(rawY, targetH - elH));

      return {
        elementId: el.id,
        x: Math.round(rawX),
        y: Math.round(rawY),
        scaleX: l.scaleX * uniformScale,
        scaleY: l.scaleY * uniformScale,
        visible: l.visible,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
};

/**
 * Enforce the template's layer order on a generated composition.
 * Uses robust matching: exact name first, then name+role, then role-only fallback.
 * This guarantees the character stays behind the slot reel (or wherever the user placed it).
 */
const enforceTemplateLayerOrder = (comp: BannerComposition, template: BannerComposition) => {
  const templateLayers = template.layers;

  // Build a lookup: for each template layer, store its index
  // Use both name and role for matching to handle variants and name mismatches
  const getTemplateIndex = (layer: BannerLayer): number => {
    // 1. Exact name match
    const exactIdx = templateLayers.findIndex(tl => tl.name === layer.name);
    if (exactIdx !== -1) return exactIdx;

    // 2. Name contains match (e.g., "Headline Text" matches "Headline Text (2-line)")
    // Place variants next to their parent
    const partialIdx = templateLayers.findIndex(tl =>
      layer.name.startsWith(tl.name) || tl.name.startsWith(layer.name),
    );
    if (partialIdx !== -1) return partialIdx + 0.5; // +0.5 to place right after parent

    // 3. Role-based fallback — place at the FIRST occurrence of this role in template
    const roleIdx = templateLayers.findIndex(tl => tl.role === layer.role);
    if (roleIdx !== -1) return roleIdx;

    // 4. Absolute fallback by role type (background at bottom, cta at top)
    const rolePriority: Record<string, number> = {
      background: 0, decoration: 2, character: 4, other: 6, text: 8, logo: 9, cta: 10,
    };
    return (rolePriority[layer.role] ?? 5) * templateLayers.length / 10;
  };

  comp.layers.sort((a, b) => getTemplateIndex(a) - getTemplateIndex(b));
};

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

  // Load skins: merge file-synced skins (Dropbox) + IndexedDB, file wins on conflict
  useEffect(() => {
    Promise.all([
      fetchAllBannerSkinsFromFiles().catch(() => [] as BannerSkin[]),
      getAllBannerSkins().catch(() => [] as BannerSkin[]),
    ]).then(([fileSkins, dbSkins]) => {
      const merged = new Map<string, BannerSkin>();
      // DB skins first (lower priority)
      dbSkins.forEach(s => merged.set(s.id, s));
      // File skins overwrite (higher priority - these sync via Dropbox)
      fileSkins.forEach(s => merged.set(s.id, s));
      const all = Array.from(merged.values()).sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      if (all.length > 0) {
        setBannerSkins(all);
        // Sync file skins back to IndexedDB for fast future loads
        const fileIds = new Set(fileSkins.map(s => s.id));
        fileSkins.forEach(s => putBannerSkin(s).catch(console.error));
        // Sync DB-only skins to files (so they sync to other machines via Dropbox)
        dbSkins.filter(s => !fileIds.has(s.id)).forEach(s => saveBannerSkinToFile(s).catch(console.error));
      }
      // Build index
      const index = all.map(s => ({ id: s.id, name: s.name, thumbnailUrl: s.thumbnailUrl, createdAt: s.createdAt }));
      setBannerSkinIndex(index);
    }).catch(console.error);
  }, []);

  // One-time cleanup: any existing text-style shortened CTA layers → restore to image form.
  // (Legacy from the image→text conversion that created huge bare text.)
  useEffect(() => {
    setProject(prev => {
      if (!prev) return prev;
      const elements = prev.extractedElements;
      let anyChanged = false;
      const newComps = prev.compositions.map(comp => {
        let changed = false;
        const newLayers = comp.layers.map(layer => {
          if (!layer.shortenedFromElementId) return layer;
          const el = elements.find(e => e.id === layer.shortenedFromElementId);
          if (!el) return layer;
          changed = true;
          const origW = layer.nativeWidth;
          const origH = layer.nativeHeight;
          const scaleX = origW / el.nativeWidth;
          const scaleY = origH / el.nativeHeight;
          return {
            ...layer,
            type: 'image' as const,
            name: layer.name.replace(/ \(shortened\)$/, ''),
            src: el.dataUrl,
            scaleX,
            scaleY,
            nativeWidth: el.nativeWidth,
            nativeHeight: el.nativeHeight,
            text: el.detectedText,
            shortenedFromElementId: undefined,
          };
        });
        if (!changed) return comp;
        anyChanged = true;
        return { ...comp, layers: newLayers };
      });
      if (!anyChanged) return prev;
      return { ...prev, compositions: newComps };
    });
    // Only run once on mount — cleanup legacy state from previous sessions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initProject = useCallback((sourceImage: string, width: number, height: number, mode: BannerMode) => {
    const defaultName = `banner-${new Date().toISOString().slice(0, 10)}`;
    setProject({
      id: crypto.randomUUID(),
      name: defaultName,
      sourceImage,
      sourceWidth: width,
      sourceHeight: height,
      detectedElements: [],
      extractedElements: [],
      compositions: [],
      selectedPresets: ['fb-feed', 'fb-square', 'fb-stories', 'fullhd-landscape'],
      mode,
      stage: 'upload',
      isExtracting: false,
      isGenerating: false,
      extractionProcessedCount: 0,
      shortenCTAs: true,
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
  const generateCompositions = useCallback(async (opts?: { regenerateUntouched?: boolean; onlyKeys?: string[]; forceAll?: boolean }) => {
    const proj = projectRef.current;
    if (!proj || proj.selectedPresets.length === 0) return;

    const regenerateUntouched = opts?.regenerateUntouched ?? false;
    const onlyKeys = opts?.onlyKeys;
    const forceAll = opts?.forceAll ?? false;
    const allComps = proj.compositions || [];

    // "Untouched" = not edited/approved by user. These can be regenerated.
    const isTouched = (c: BannerComposition) => c.status === 'edited' || c.status === 'approved';
    const untouchedKeys = new Set(
      allComps.filter(c => !isTouched(c)).map(c => c.presetKey).filter(Boolean),
    );
    // Keep any touched compositions — they become the new existingComps set
    const existingComps = forceAll
      ? [] // forceAll: discard everything and regenerate from scratch
      : regenerateUntouched || onlyKeys
        ? allComps.filter(c => isTouched(c) && !(onlyKeys?.includes(c.presetKey)))
        : allComps;
    const existingKeys = new Set(existingComps.map(c => c.presetKey).filter(Boolean));

    // Decide which preset keys to (re)generate
    let keysToGenerate: string[];
    if (forceAll) {
      keysToGenerate = proj.selectedPresets;
    } else if (onlyKeys) {
      keysToGenerate = onlyKeys;
    } else if (regenerateUntouched) {
      keysToGenerate = proj.selectedPresets.filter(
        key => !existingKeys.has(key) || untouchedKeys.has(key),
      );
    } else {
      keysToGenerate = proj.selectedPresets.filter(key => !existingKeys.has(key));
    }
    const presetsToGenerate = keysToGenerate
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

    // Render user-touched FB kickoff compositions to PNG data URLs for AI reference
    const kickoffComps = existingComps.filter(
      c => FB_KICKOFF_KEYS.includes(c.presetKey) &&
        (c.status === 'edited' || c.status === 'approved') &&
        c.layers.length > 0,
    );
    let kickoffReferences: Array<{ label: string; dataUrl: string; width: number; height: number }> = [];
    if (kickoffComps.length > 0) {
      try {
        kickoffReferences = await Promise.all(
          kickoffComps.map(async c => ({
            label: c.name,
            dataUrl: await renderCompositionToDataUrl(c, 768),
            width: c.width,
            height: c.height,
          })),
        );
      } catch (err) {
        console.warn('Failed to render kickoff references:', err);
      }
    }

    const newCompositions: BannerComposition[] = [];

    // Helper: build a composition from a layout result
    const buildComposition = (
      preset: { name: string; key: string; width: number; height: number },
      layoutResult: Array<{ elementId: string; x: number; y: number; scaleX: number; scaleY: number; visible: boolean }>,
    ): BannerComposition => {
      // Post-process: for each variant-group, make all members share the VISIBLE
      // member's on-canvas footprint so toggling visibility swaps assets in place.
      const layoutByElId = new Map(layoutResult.map(l => [l.elementId, l]));
      const elById = new Map(elements.map(e => [e.id, e]));
      const groups = new Map<string, typeof layoutResult>();
      for (const el of elements) {
        const groupKey = el.variantOfId || el.id;
        const item = layoutByElId.get(el.id);
        if (!item) continue;
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey)!.push(item);
      }
      for (const group of groups.values()) {
        if (group.length < 2) continue;
        const anchor = group.find(g => g.visible) || group[0];
        const anchorEl = elById.get(anchor.elementId);
        if (!anchorEl) continue;
        const anchorW = anchorEl.nativeWidth * anchor.scaleX;
        const anchorH = anchorEl.nativeHeight * anchor.scaleY;
        for (const item of group) {
          if (item === anchor) continue;
          const itemEl = elById.get(item.elementId);
          if (!itemEl) continue;
          item.x = anchor.x;
          item.y = anchor.y;
          item.scaleX = anchorW / itemEl.nativeWidth;
          item.scaleY = anchorH / itemEl.nativeHeight;
        }
      }

      const layers: BannerLayer[] = layoutResult.map((item): BannerLayer | null => {
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

      // Do NOT sort here — preserve the order from layoutResult.
      // For deterministic layouts, layoutResult follows template layer order.
      // For AI layouts, layoutResult follows AI response order (which is told to match template z-order).
      // Callers re-sort by template order when needed.

      return {
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
      };
    };

    // --- Minimal post-process: only enforce critical constraints, let AI decisions stand ---
    const postProcessComposition = (comp: BannerComposition) => {
      const W = comp.width;
      const H = comp.height;
      const isStrip = H <= 100 && W / H >= 3;
      if (isStrip) return; // strips handled in banner.ts

      const layersByRole = (role: string) => comp.layers.filter(l => l.visible !== false && l.role === role);
      const layerByName = (match: string) => comp.layers.find(l => l.visible !== false && l.name.toLowerCase().includes(match));

      // CTA: ensure not touching canvas edges (3% margin minimum)
      for (const l of layersByRole('cta')) {
        const ctaW = l.nativeWidth * l.scaleX;
        const ctaH = l.nativeHeight * l.scaleY;
        const m = Math.max(4, W * 0.03);
        if (l.y + ctaH > H - m) l.y = Math.round(H - ctaH - m);
        if (l.x < m) l.x = Math.round(m);
        if (l.x + ctaW > W - m) l.x = Math.round(W - ctaW - m);
      }

      // Ribbon: flush to corner
      const ribbon = layerByName('badge') || layerByName('new');
      if (ribbon && ribbon.role === 'decoration') {
        ribbon.x = 0;
        ribbon.y = 0;
      }

      // Let AI handle element placement — no further corrections needed
      // The AI receives reference images and detailed composition rules
    };

    // --- Phase 1: ALL sizes go through AI layout ---
    // AI layout understands composition rules, element hierarchy, and can properly
    // rearrange elements for each target size. Deterministic scaling just shrinks
    // the template which doesn't adapt the composition.
    const needsAI: typeof presetsToGenerate = [...presetsToGenerate];

    // Single state update after all deterministic layouts are done (avoids N re-renders)
    if (newCompositions.length > 0) {
      setProject(prev => prev ? {
        ...prev,
        compositions: [...existingComps, ...newCompositions],
      } : null);
    }

    console.log(`[Banners] ${presetsToGenerate.length - needsAI.length} sizes scaled deterministically, ${needsAI.length} need AI layout`);

    // --- Phase 2: AI layout generation in parallel batches of 4 ---
    // For sizes that need orientation change (landscape→portrait, etc.) or have no template.
    if (needsAI.length > 0) {
      await parallelBatch(
        needsAI,
        async (preset) => {
          const pseudoTarget: BannerComposition = {
            id: '__pending__', name: preset.name, presetKey: preset.key,
            width: preset.width, height: preset.height, layers: [],
            selectedLayerId: null, backgroundColor: '#000000', warnings: [], status: 'pending',
          };
          const template = findLayoutTemplate(pseudoTarget, [...existingComps, ...newCompositions]);
          const templatePayload = template
            ? {
                width: template.width,
                height: template.height,
                layers: template.layers.map(l => ({
                  name: l.name, role: l.role, x: l.x, y: l.y,
                  scaleX: l.scaleX, scaleY: l.scaleY,
                  nativeWidth: l.nativeWidth, nativeHeight: l.nativeHeight,
                })),
              }
            : null;

          const layoutResult = await generateBannerLayout(
            elements,
            preset.width,
            preset.height,
            proj.sourceWidth,
            proj.sourceHeight,
            templatePayload,
            kickoffReferences.filter(r => !(r.width === preset.width && r.height === preset.height)),
            proj.shortenCTAs,
          );
          return { preset, layoutResult, template };
        },
        (result) => {
          const comp = buildComposition(result.preset, result.layoutResult);
          // Enforce template layer order (z-index stacking) — robust matching
          if (result.template) {
            enforceTemplateLayerOrder(comp, result.template);
          }
          postProcessComposition(comp);
          newCompositions.push(comp);
          // Update state after each result so the gallery shows progress
          // Use setTimeout(0) to yield to the renderer between heavy updates
          setTimeout(() => {
            setProject(prev => prev ? {
              ...prev,
              compositions: [...existingComps, ...newCompositions],
            } : null);
          }, 0);
        },
        4,    // batch size — 4 concurrent AI calls
        300,  // delay between batches
        (err, preset) => {
          console.error(`Failed to generate layout for ${preset.name}:`, err);
        },
      );
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

  // Only these updates should NOT promote status to 'edited' (they're metadata/quality/status themselves)
  const META_ONLY_KEYS = new Set(['warnings', 'sparkleDataUrl', 'status', 'selectedLayerId']);
  const isContentUpdate = (updates: Partial<BannerComposition>): boolean =>
    Object.keys(updates).some(k => !META_ONLY_KEYS.has(k));

  /**
   * Toggle CTA shortening flag. This flag is passed to the AI during NEW composition
   * generation so it can request shorter CTA copy on narrow banners. For any existing
   * text-style shortened CTAs (legacy), restore them back to image CTAs.
   */
  const applyCtaShorteningToExisting = useCallback((shortenOn: boolean) => {
    setProject(prev => {
      if (!prev) return null;
      const elements = prev.extractedElements;
      const newComps = prev.compositions.map(comp => {
        let changed = false;
        const newLayers = comp.layers.map(layer => {
          // Restore any legacy text-CTA layers back to image form
          if (!layer.shortenedFromElementId) return layer;
          const el = elements.find(e => e.id === layer.shortenedFromElementId);
          if (!el) return layer;
          changed = true;
          const origW = layer.nativeWidth;
          const origH = layer.nativeHeight;
          const scaleX = origW / el.nativeWidth;
          const scaleY = origH / el.nativeHeight;
          return {
            ...layer,
            type: 'image' as const,
            name: layer.name.replace(/ \(shortened\)$/, ''),
            src: el.dataUrl,
            scaleX,
            scaleY,
            nativeWidth: el.nativeWidth,
            nativeHeight: el.nativeHeight,
            text: el.detectedText,
            shortenedFromElementId: undefined,
          };
        });
        return changed ? { ...comp, layers: newLayers } : comp;
      });
      return { ...prev, compositions: newComps, shortenCTAs: shortenOn };
    });
  }, []);

  const updateComposition = useCallback((id: string, updates: Partial<BannerComposition>) => {
    setProject(prev => {
      if (!prev) return null;
      const promote = isContentUpdate(updates);
      return {
        ...prev,
        compositions: prev.compositions.map(c =>
          c.id === id
            ? {
                ...c,
                ...updates,
                status: promote && c.status !== 'approved' ? ('edited' as const) : (updates.status ?? c.status),
              }
            : c,
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
            ? {
                ...c,
                layers: c.layers.map(l => l.id === layerId ? { ...l, ...updates } : l),
                // Any layer edit promotes composition to 'edited' (unless already approved)
                status: c.status === 'approved' ? c.status : ('edited' as const),
              }
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
      applyCtaShorteningToExisting,
      bannerSkins, setBannerSkins,
      activeBannerSkinId, setActiveBannerSkinId,
      bannerSkinIndex, setBannerSkinIndex,
    }}>
      {children}
    </BannerContext.Provider>
  );
};
