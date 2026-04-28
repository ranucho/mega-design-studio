export type AppTab = 'concept' | 'storyboard' | 'movie' | 'capture' | 'lab' | 'studio' | 'toolkit' | 'editor' | 'banners';
export type ToolkitSubTab = 'slots' | 'character' | 'symbol-gen' | 'background' | 'compositor';

export type AssetType = 'character_primary' | 'character_secondary' | 'background' | 'style' | 'object' | 'game_symbol' | 'long_game_tile' | 'wild_symbol';

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4';

export type TimeFormat = 'seconds' | 'frames';

export interface ReferenceAsset {
  id: string;
  url: string;
  type: AssetType;
  name?: string;
  /** 'video' for generated video assets; defaults to 'image' when omitted */
  mediaType?: 'image' | 'video';
}

export interface BackgroundState {
  sourceImage: string | null;
  generatedImage: string | null;
  prompt: string;
  aspectRatio: AspectRatio;
  crop: { x: number; y: number; w: number; h: number } | null;
  isProcessing: boolean;
  // Animation
  videoPrompt: string;
  videoCount: number; // 1-4
  generatedVideos: { url: string; id: string }[];
  isProcessingVideo: boolean;
}

export interface SymbolItem {
  id: string;
  name: string;
  sourceUrl: string;
  rawCropDataUrl?: string | null;
  isolatedUrl: string | null;
  isProcessing: boolean;
  /** Crop coordinates (as % of source image) for auto-re-extraction after reskin */
  cropCoordinates?: { x: number; y: number; w: number; h: number } | null;
  /** Which master view the crop was taken from */
  cropSourceView?: 'source' | 'reskinned';
  /** How many grid rows this symbol spans (1 = normal, 3 = long tile). Default 1. */
  spanRows?: number;
  /** If true, extract/isolate the symbol WITH its frame/border (keeps decorative frame). */
  withFrame?: boolean;
  /** Role: 'low' (card/letter), 'high' (themed/illustrated), 'wild', 'scatter'. High/wild/scatter default to withFrame=true. */
  symbolRole?: 'low' | 'high' | 'wild' | 'scatter';
  /** Per-symbol horizontal scale override (percentage, default 100). */
  scaleX?: number;
  /** Per-symbol vertical scale override (percentage, default 100). */
  scaleY?: number;
  /** If true, scaleX and scaleY are locked together (uniform scaling). */
  lockScale?: boolean;
  /** Which source frame this symbol was extracted from (optional, for display) */
  sourceFrameId?: string;
  /** True while AI upscaling is running */
  isUpscaling?: boolean;
  /** Upscaled image URLs keyed by scale factor — both can coexist */
  upscaledUrls?: { 2?: string; 3?: string };
}

export interface SourceFrame {
  id: string;
  name: string;
  masterImage: string | null;
  reskinResult: string | null;
  reelsFrame: string | null;
  reelsFrameCropCoordinates?: { x: number; y: number; w: number; h: number } | null;
  masterPrompt: string;
  isProcessingMaster: boolean;
  activeMasterView: 'source' | 'reskinned';
}

export interface SlotLayout {
  id: string;
  name: string;
  sourceFrameId: string | null;  // which frame's reelsFrame to use as background
  gridRows: number;
  gridCols: number;
  gridState: string[][];
  layoutOffsetX: number;
  layoutOffsetY: number;
  layoutWidth: number;
  layoutHeight: number;
  layoutGutterHorizontal: number;
  layoutGutterVertical: number;
  symbolScale: number;
  hideReelsBg: boolean;
  useLongTiles: boolean;
}

export interface ReelGridAnalysis {
  isReelContent: boolean;
  rows: number;
  cols: number;
  symbols: Array<{ row: number; col: number; description: string }>;
  cabinetDescription: string;
  gridLayoutNotes: string;
}

export interface SymbolConsistencyMap {
  originalDescription: string;
  reskinDescription: string;
}

export interface MergedFrame {
  id: string;
  dataUrl: string;
  label: string;
  timestamp?: number;
  hideReelsBg?: boolean;
}

export interface SymbolGeneratorState {
  // Master workflow
  masterImage: string | null;
  reskinResult: string | null;
  masterPrompt: string;
  isProcessingMaster: boolean;
  activeMasterView: 'source' | 'reskinned';

  // Extraction
  symbols: SymbolItem[];
  reelsFrame: string | null;
  /** Stored crop coordinates (as %) for auto-re-extracting background after reskin */
  reelsFrameCropCoordinates?: { x: number; y: number; w: number; h: number } | null;

  // Layout
  hideReelsBg?: boolean;
  useLongTiles?: boolean;
  gridRows: number;
  gridCols: number;
  gridState: string[][];
  layoutOffsetX: number;
  layoutOffsetY: number;
  layoutWidth: number;
  layoutHeight: number;
  layoutGutterHorizontal: number;
  layoutGutterVertical: number;
  symbolScale: number;

  // Animation & Merging
  mergedFrames: MergedFrame[];
  savedFrames: MergedFrame[];
  selectedStartFrameId: string | null;
  selectedEndFrameId: string | null;
  animationPrompt: string;
  animationPrompts: string[];
  animationVideoCount: number;
  generatedVideos: { url: string; id: string; prompt?: string }[];
  isGeneratingVideo: boolean;

  prompt: string;
  isProcessing: boolean;
  activeSubTab: 'master' | 'extract' | 'layout';

  // Multi-frame support
  sourceFrames: SourceFrame[];
  activeSourceFrameId: string | null;
  // Multi-layout support
  layouts: SlotLayout[];
  activeLayoutId: string | null;
}

// --- Compositor ---
export interface CompositorLayer {
  id: string;
  type: 'video' | 'image';
  name: string;
  src: string;
  x: number;       // position in canvas pixels
  y: number;
  scaleX: number;  // 1 = original size
  scaleY: number;
  opacity: number;  // 0-1
  chromaKey: {
    enabled: boolean;
    color: string; // hex color e.g. '#00fa15', or preset name
    tolerance: number; // 0-100
    spillSuppression: number; // 0-100 — desaturate key-color spill on edge pixels
    clipBlack: number; // 0-100 — below this alpha → fully transparent
    clipWhite: number; // 0-100 — above this alpha → fully opaque
  };
  visible: boolean;
  locked: boolean;
  // Timeline properties
  timelineStart: number;    // When layer appears on timeline (seconds)
  mediaDuration: number;    // Source media total duration (seconds). Images default to 10
  trimIn: number;           // In-point in source (seconds)
  trimOut: number;          // Out-point in source (seconds)
  loop: boolean;            // Loop the trimmed region
  loopDuration: number;     // Total timeline duration when looping (seconds)
  playbackRate: number;     // Speed multiplier (default 1)
  freezeLastFrame?: boolean; // Hold last frame after clip ends (for videos)
  freezeDuration?: number;   // How long to hold the freeze frame (seconds)
  color?: string;            // Custom clip/track accent color (hex)
  muted?: boolean;           // Mute audio for this layer (default false)
}

export interface CompositorState {
  layers: CompositorLayer[];
  selectedLayerId: string | null;
  canvasWidth: number;
  canvasHeight: number;
  isPlaying: boolean;
  isExporting: boolean;
  playheadTime: number;       // Current composition time (seconds)
  compositionDuration: number; // Auto-computed total duration
  timelineZoom: number;       // Pixels per second (default 20)
}

// --- Banners ---

export type BannerMode = 'resize' | 'reskin';
export type BannerStage = 'upload' | 'reskin' | 'extract' | 'presets' | 'edit' | 'sparkle' | 'export';

export interface BannerLayer {
  id: string;
  type: 'image' | 'text' | 'shape';
  name: string;
  src?: string;            // data URL for image layers
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;        // degrees
  flipX: boolean;
  flipY: boolean;
  opacity: number;         // 0-1
  visible: boolean;
  locked: boolean;
  role: 'background' | 'character' | 'text' | 'cta' | 'logo' | 'decoration' | 'other';
  nativeWidth: number;
  nativeHeight: number;
  // Text layer properties
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  fontColor?: string;
  textStroke?: string;
  textShadow?: string;
  textAlign?: 'left' | 'center' | 'right';
  /** When set, this layer was swapped from a CTA image layer. Stores the original extractedElement id for toggle-off restoration. */
  shortenedFromElementId?: string;
}

export interface QualityWarning {
  type: 'safe-zone' | 'upscale' | 'readability' | 'file-size' | 'missing-element';
  severity: 'error' | 'warning' | 'info';
  layerId?: string;
  message: string;
}

export interface BannerComposition {
  id: string;
  name: string;
  presetKey: string;
  width: number;
  height: number;
  layers: BannerLayer[];
  selectedLayerId: string | null;
  /** Multi-selection: all currently selected layer IDs (includes selectedLayerId) */
  selectedLayerIds?: string[];
  backgroundColor: string;
  warnings: QualityWarning[];
  status: 'pending' | 'generating' | 'ready' | 'edited' | 'approved' | 'error';
  /** Error message if status === 'error' (AI layout generation failed). */
  errorMessage?: string;
  /** When true, this banner is protected from bulk regeneration (Match Layout). */
  locked?: boolean;
  /** Data URL of sparkle-enhanced version (if applied) */
  sparkleDataUrl?: string;
}

export interface ExtractedElement {
  id: string;
  dataUrl: string;
  role: BannerLayer['role'];
  label: string;
  nativeWidth: number;
  nativeHeight: number;
  detectedText?: string;
  /** Original bounding box in source image (percentage 0-100) — used for layout generation */
  sourceBbox?: { x: number; y: number; w: number; h: number };
  /** If this element is a variant of another, the parent's id. */
  variantOfId?: string;
  /** Kind of variant — 'short' = shortened CTA copy; 'multiline' = headline reflowed to 2 lines. */
  variantKind?: 'short' | 'multiline';
  /** True while this variant is being generated by AI. */
  isGeneratingVariant?: boolean;
}

export interface DetectedElement {
  label: string;
  role: BannerLayer['role'];
  bbox: { x: number; y: number; w: number; h: number };
  detectedText?: string;
}

/** High-level category for grouping detected elements */
export type ElementCategory = 'text' | 'ui' | 'images';

export const ROLE_TO_CATEGORY: Record<BannerLayer['role'], ElementCategory> = {
  text: 'text',
  cta: 'ui',
  logo: 'ui',
  decoration: 'ui',
  background: 'images',
  character: 'images',
  other: 'images',
};

export const CATEGORY_META: Record<ElementCategory, { label: string; icon: string; color: string }> = {
  text: { label: 'Text', icon: 'fa-font', color: '#22c55e' },
  ui: { label: 'UI Elements', icon: 'fa-layer-group', color: '#f97316' },
  images: { label: 'Images', icon: 'fa-image', color: '#3b82f6' },
};

export interface BannerProject {
  id: string;
  name: string;              // user-editable project name (used for export filenames)
  sourceImage: string;       // data URL of uploaded banner (or reskinned)
  originalImage?: string;    // original before reskin (for before/after comparison)
  sourceWidth: number;
  sourceHeight: number;
  detectedElements: DetectedElement[];  // persisted detection results
  extractedElements: ExtractedElement[];
  compositions: BannerComposition[];
  selectedPresets: string[];  // preset keys
  mode: BannerMode;
  stage: BannerStage;
  isExtracting: boolean;
  isGenerating: boolean;
  extractionProcessedCount: number;  // tracks progress during current extraction run
  /** When true, AI abbreviates CTAs on narrow/slim banners. Default true. */
  shortenCTAs?: boolean;
}

export type BannerPresetCategory = 'app-stores' | 'facebook' | 'instagram' | 'google-display' | 'social' | 'web-email' | 'print';

export interface BannerPreset {
  key: string;
  name: string;
  width: number;
  height: number;
  category: BannerPresetCategory;
  safeZone?: { top: number; right: number; bottom: number; left: number };
}

export const BANNER_PRESETS: BannerPreset[] = [
  // App Stores
  { key: 'ios-screenshot', name: 'iOS Screenshot', width: 1290, height: 2796, category: 'app-stores' },
  { key: 'google-play-feature', name: 'Google Play Feature', width: 1024, height: 500, category: 'app-stores' },
  { key: 'ipad-screenshot', name: 'iPad Screenshot', width: 2048, height: 2732, category: 'app-stores' },
  { key: 'app-icon', name: 'App Icon', width: 1024, height: 1024, category: 'app-stores' },
  { key: 'google-play-icon', name: 'Play Store Icon', width: 512, height: 512, category: 'app-stores' },
  { key: 'ipad-portrait', name: 'iPad Portrait', width: 768, height: 1024, category: 'app-stores' },
  // Facebook / Meta
  { key: 'fb-feed', name: 'Facebook Feed', width: 1200, height: 628, category: 'facebook' },
  { key: 'fb-square', name: 'Facebook Square', width: 1080, height: 1080, category: 'facebook' },
  { key: 'fb-stories', name: 'Facebook Stories', width: 1080, height: 1920, category: 'facebook' },
  { key: 'fb-carousel', name: 'Facebook Carousel', width: 1080, height: 1080, category: 'facebook' },
  // Instagram
  { key: 'ig-square', name: 'Instagram Square', width: 1080, height: 1080, category: 'instagram' },
  { key: 'ig-portrait', name: 'Instagram Portrait', width: 1080, height: 1350, category: 'instagram' },
  { key: 'ig-stories', name: 'Instagram Stories', width: 1080, height: 1920, category: 'instagram' },
  // Google Display Network
  { key: 'gdn-medium-rect', name: 'Medium Rectangle', width: 300, height: 250, category: 'google-display' },
  { key: 'gdn-large-rect', name: 'Large Rectangle', width: 336, height: 280, category: 'google-display' },
  { key: 'gdn-leaderboard', name: 'Leaderboard', width: 728, height: 90, category: 'google-display' },
  { key: 'gdn-mobile-banner', name: 'Mobile Banner', width: 320, height: 50, category: 'google-display' },
  { key: 'gdn-mobile-large', name: 'Mobile Large', width: 320, height: 100, category: 'google-display' },
  { key: 'gdn-wide-sky', name: 'Wide Skyscraper', width: 160, height: 600, category: 'google-display' },
  { key: 'gdn-half-page', name: 'Half Page', width: 300, height: 600, category: 'google-display' },
  { key: 'gdn-billboard', name: 'Billboard', width: 970, height: 250, category: 'google-display' },
  { key: 'gdn-large-leader', name: 'Large Leaderboard', width: 970, height: 90, category: 'google-display' },
  { key: 'gdn-portrait', name: 'Portrait', width: 300, height: 1050, category: 'google-display' },
  { key: 'gdn-square', name: 'Square', width: 250, height: 250, category: 'google-display' },
  { key: 'mobile-landscape-480', name: 'Mobile Landscape', width: 480, height: 320, category: 'google-display' },
  { key: 'mobile-portrait-320', name: 'Mobile Portrait', width: 320, height: 480, category: 'google-display' },
  { key: 'square-480', name: 'Square 480', width: 480, height: 480, category: 'google-display' },
  { key: 'full-banner-468', name: 'Full Banner', width: 468, height: 60, category: 'google-display' },
  { key: 'small-mobile-300', name: 'Small Mobile Banner', width: 300, height: 50, category: 'google-display' },
  // Social
  { key: 'x-post', name: 'X / Twitter Post', width: 1200, height: 675, category: 'social' },
  { key: 'linkedin-post', name: 'LinkedIn Post', width: 1200, height: 627, category: 'social' },
  { key: 'youtube-thumb', name: 'Landscape HD', width: 1280, height: 720, category: 'social' },
  { key: 'fullhd-landscape', name: 'Full HD Landscape', width: 1920, height: 1080, category: 'social' },
  { key: 'portrait-hd-720', name: 'Portrait HD', width: 720, height: 1280, category: 'social' },
  { key: 'pinterest-pin', name: 'Pinterest Pin', width: 1000, height: 1500, category: 'social' },
  { key: 'tiktok-cover', name: 'TikTok Cover', width: 1080, height: 1920, category: 'social' },
  { key: 'snapchat-ad', name: 'Snapchat Ad', width: 1080, height: 1920, category: 'social' },
  // Web / Email
  { key: 'web-hero', name: 'Web Hero', width: 1920, height: 600, category: 'web-email' },
  { key: 'email-header', name: 'Email Header', width: 600, height: 200, category: 'web-email' },
  { key: 'popup-banner', name: 'Popup Banner', width: 800, height: 600, category: 'web-email' },
  { key: 'web-banner', name: 'Web Banner', width: 1440, height: 400, category: 'web-email' },
  // Print
  { key: 'print-a4', name: 'A4 Portrait', width: 2480, height: 3508, category: 'print' },
  { key: 'print-rollup', name: 'Roll-up Banner', width: 2362, height: 7087, category: 'print' },
  { key: 'print-backdrop', name: 'Exhibition Backdrop', width: 7087, height: 3543, category: 'print' },
];

// --- Skins ---

export interface SkinSymbolSnapshot {
  id: string;
  name: string;
  isolatedUrl: string;
  rawCropDataUrl: string | null;
  cropCoordinates: { x: number; y: number; w: number; h: number } | null;
  spanRows?: number;
  withFrame?: boolean;
  symbolRole?: 'low' | 'high' | 'wild' | 'scatter';
  scaleX?: number;
  scaleY?: number;
}

export interface SlotSkin {
  id: string;
  name: string;
  createdAt: string;
  thumbnailUrl: string;
  masterPrompt: string;
  masterImage: string;
  reskinResult: string;
  reelsFrame: string | null;
  reelsFrameCropCoordinates?: { x: number; y: number; w: number; h: number } | null;
  symbols: SkinSymbolSnapshot[];
  gridState: string[][];
  gridRows: number;
  gridCols: number;
  layoutOffsetX: number;
  layoutOffsetY: number;
  layoutWidth: number;
  layoutHeight: number;
  layoutGutterHorizontal: number;
  layoutGutterVertical: number;
  symbolScale: number;
  /** Multi-frame snapshot (optional for backwards compat with older skins) */
  sourceFrames?: SourceFrame[];
  activeSourceFrameId?: string | null;
  /** Multi-layout snapshot (optional for backwards compat with older skins) */
  layouts?: SlotLayout[];
  activeLayoutId?: string | null;
  /** Compositor snapshot: layers (with colors, trims, chroma), canvas, timeline zoom */
  compositorState?: CompositorState;
  /** Character Studio snapshot — reskin/sheet/isolated images + generated videos */
  characterState?: import('@/types/editor').CharacterState;
  /** Background Studio snapshot — source/generated images + generated videos */
  backgroundState?: BackgroundState;
  /** Slot Generator's reel-animation videos (Veo outputs) — blob URLs baked to data URLs */
  generatedVideos?: { id: string; url: string; prompt?: string }[];
  firebaseUrls?: Record<string, string>;
  isUploaded: boolean;
  isUploading: boolean;
}

export interface BannerSkin {
  id: string;
  name: string;
  createdAt: string;
  thumbnailUrl: string;
  reskinTheme: string;
  sourceImage: string;
  sourceWidth: number;
  sourceHeight: number;
  detectedElements: DetectedElement[];
  extractedElements: ExtractedElement[];
  compositions: BannerComposition[];
  firebaseUrls?: Record<string, string>;
  isUploaded: boolean;
  isUploading: boolean;
}

export interface SkinIndexEntry {
  id: string;
  name: string;
  thumbnailUrl: string;
  createdAt: string;
}

export const BANNER_PRESET_CATEGORIES: { key: BannerPresetCategory; label: string }[] = [
  { key: 'app-stores', label: 'App Stores' },
  { key: 'facebook', label: 'Facebook / Meta' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'google-display', label: 'Google Display' },
  { key: 'social', label: 'Social' },
  { key: 'web-email', label: 'Web / Email' },
  { key: 'print', label: 'Print' },
];
