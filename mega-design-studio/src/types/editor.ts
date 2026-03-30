export interface ExtractedFrame {
  id: string;
  timestamp: number;
  dataUrl: string;
  cleanedDataUrl?: string;
  modifiedDataUrl?: string;
  lastModificationPrompt?: string;
  lastModificationMode?: 'edit' | 'reskin';
  baseImageForLastModification?: string;
  lastModificationReferenceUrl?: string | null;
  isKeyframe?: boolean;
  transitionPrompt?: string;
}

export interface GeneratedClip {
  id: string;
  url: string;
  startFrameId: string;
  endFrameId: string;
  index: number;
  originalDuration?: number;
  trimStart: number;
  trimEnd: number;
  speed: number;
  inTimeline?: boolean; // false = removed from timeline but kept in library (default true)
}

export interface VideoSegment {
  id: string;
  start: number;
  end: number;
  description: string;
  cameraMotion?: string;
  shotType?: string;
  prompt: string;
  frames: ExtractedFrame[];
  generatedClips: GeneratedClip[];
  isGenerating?: boolean;
}

export type Crop = { x: number; y: number; w: number; h: number };

export interface SlotState {
  sourceImage: string | null;
  resultSymbolImage: string | null;
  resultFrameImage: string | null;
  rows: number;
  cols: number;
  prompt: string;
  crop: Crop | null;
  isProcessing: boolean;
}

export interface CharacterState {
  sourceImage: string | null;
  generatedImage: string | null;
  characterSheet: string | null;
  isolatedImage: string | null;
  prompt: string;
  videoPrompts: string[]; // up to 4 prompts
  videoCount: number; // 1-4 videos per prompt
  crop: Crop | null;
  bgColor: string; // hex color e.g. '#00fa15', or preset name
  aspectRatio: '1:1' | '9:16' | '16:9' | '4:3';
  generatedVideos: { url: string; id: string; prompt?: string }[];
  isProcessingReskin: boolean;
  isProcessingSheet: boolean;
  isProcessingIsolation: boolean;
  isProcessingVideo: boolean;
}
