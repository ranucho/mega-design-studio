// Client utilities
export { getAI, resetAI, parseDataUrl, parseImageBase64, retryOperation, runWithRetry, rewritePromptForSafety, pollVideoOperation, createImageParts, delay } from './client';

// Story generation (Animatix)
export { generateRandomStoryConcept, generateStoryStructure } from './story';

// Image generation & manipulation
export {
  generateCharacterSheetFromStory,
  generateCharacterSheetFromReferences,
  generateSceneImage,
  editSceneImage,
  cleanImage,
  modifyImage,
  generateFromCrop,
  generateSlotGridReskin,
  isolateSymbol,
  isolateSymbolWithFrame,
  cleanLongTile,
  extractReelsFrame,
  cleanReelsFrameWithReference,
  generateBackgroundImage,
  SYMBOL_WIDTH,
  SYMBOL_HEIGHT,
  LONG_TILE_WIDTH,
  LONG_TILE_HEIGHT,
} from './image';

// Video generation
export {
  generateSceneVideo,
  generateAnimation,
  generateGreenScreenVideo,
  extendAnimation,
} from './video';

// Analysis
export {
  refineVideoPrompt,
  describeVideoSegment,
  analyzeMotionInterval,
  analyzeReelGrid,
  analyzeReskinResult,
  detectSymbolPositions,
} from './analysis';

export type { DetectedSymbol } from './analysis';

// Banner
export {
  analyzeBanner,
  extractElement,
  chromaKeyToAlpha,
  whiteToAlpha,
  autoTrimTransparent,
  cropImageToRegion,
  canvasCropElement,
  composeBannerAtSize,
  resizeImageExact,
  generateBannerLayout,
  reskinBanner,
} from './banner';
