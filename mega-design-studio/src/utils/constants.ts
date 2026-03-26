// Gemini model names
export const MODELS = {
  FLASH: 'gemini-3-flash-preview',
  PRO_IMAGE: 'gemini-3.1-flash-image-preview',
  FLASH_IMAGE_FALLBACK: 'gemini-2.5-flash-image',
  VEO_FAST: 'veo-3.1-fast-generate-preview',
  VEO_EXTENDED: 'veo-3.1-generate-preview',
} as const;

// Retry configuration
export const RETRY = {
  MAX_RETRIES: 3,
  BASE_DELAY_MS: 2000,
  RETRYABLE_ERRORS: ['internal server issue', '500', '503', 'timed out', 'quota', 'reason: OTHER'],
} as const;

// Video generation
export const VIDEO = {
  POLL_INTERVAL_MS: 10000,
  POLL_TIMEOUT_MS: 600000,
  BATCH_CONCURRENCY: 2,
  BATCH_DELAY_MS: 1500,
} as const;

// Timeline
export const TIMELINE = {
  PIXELS_PER_SECOND: 40,
  MIN_SEGMENT_DURATION: 0.5,
  DEFAULT_ZOOM: 20,
} as const;

// Navigation groups — each group is a single main nav button; children appear as sub-tabs
export const NAV_GROUPS = [
  {
    id: 'animatix',
    label: 'Animatix',
    icon: 'fa-clapperboard',
    color: 'orange',
    children: [
      { id: 'concept', label: 'Concept', icon: 'fa-lightbulb' },
      { id: 'storyboard', label: 'Storyboard', icon: 'fa-film' },
      { id: 'movie', label: 'Movie', icon: 'fa-clapperboard' },
    ],
  },
  {
    id: 'extractor',
    label: 'Capture & Reskin',
    icon: 'fa-camera-retro',
    color: 'blue',
    children: [
      { id: 'capture', label: 'Capture', icon: 'fa-camera' },
      { id: 'studio', label: 'Studio', icon: 'fa-wand-magic-sparkles' },
      { id: 'editor', label: 'Editor', icon: 'fa-scissors' },
    ],
  },
  {
    id: 'slots',
    label: 'Slots Generator',
    icon: 'fa-gem',
    color: 'emerald',
    children: [
      { id: 'toolkit', label: 'Slots Generator', icon: 'fa-gem' },
    ],
  },
  {
    id: 'banner-studio',
    label: 'Banners',
    icon: 'fa-images',
    color: 'cyan',
    children: [
      { id: 'banners', label: 'Banners', icon: 'fa-images' },
    ],
  },
  {
    id: 'assets',
    label: 'Assets',
    icon: 'fa-box-archive',
    color: 'purple',
    children: [
      { id: 'lab', label: 'Assets', icon: 'fa-box-archive' },
    ],
  },
] as const;
