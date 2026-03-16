import React, { createContext, useContext, useState } from 'react';
import { VideoSegment, GeneratedClip, ReferenceAsset, SlotState, CharacterState, Crop, BackgroundState, SymbolGeneratorState, CompositorState, TimeFormat } from '@/types';

interface ExtractorContextType {
  // Video source
  videoUrl: string | null;
  setVideoUrl: (url: string | null) => void;
  videoDuration: number;
  setVideoDuration: (d: number) => void;
  videoAspectRatio: number;
  setVideoAspectRatio: (ratio: number) => void;

  // Segments & frames
  segments: VideoSegment[];
  setSegments: React.Dispatch<React.SetStateAction<VideoSegment[]>>;
  activeSegmentId: string | null;
  setActiveSegmentId: (id: string | null) => void;

  // Modifications
  modificationPrompt: string;
  setModificationPrompt: (prompt: string) => void;
  referenceAssets: ReferenceAsset[];
  setReferenceAssets: React.Dispatch<React.SetStateAction<ReferenceAsset[]>>;

  // Generated clips (for editor)
  clips: GeneratedClip[];
  setClips: React.Dispatch<React.SetStateAction<GeneratedClip[]>>;

  // Slot Machine Studio state
  slotState: SlotState;
  setSlotState: React.Dispatch<React.SetStateAction<SlotState>>;

  // Character Studio state
  characterState: CharacterState;
  setCharacterState: React.Dispatch<React.SetStateAction<CharacterState>>;

  // Background Studio state
  backgroundState: BackgroundState;
  setBackgroundState: React.Dispatch<React.SetStateAction<BackgroundState>>;

  // Symbol Generator Studio state
  symbolGenState: SymbolGeneratorState;
  setSymbolGenState: React.Dispatch<React.SetStateAction<SymbolGeneratorState>>;

  // Compositor state
  compositorState: CompositorState;
  setCompositorState: React.Dispatch<React.SetStateAction<CompositorState>>;

  // Capture time unit
  captureTimeUnit: TimeFormat;
  setCaptureTimeUnit: (unit: TimeFormat) => void;

  // Loading
  loadingAction: string | null;
  setLoadingAction: (action: string | null) => void;
}

const ExtractorContext = createContext<ExtractorContextType | null>(null);

export const useExtractor = () => {
  const ctx = useContext(ExtractorContext);
  if (!ctx) throw new Error("useExtractor must be used within ExtractorProvider");
  return ctx;
};

const DEFAULT_SLOT_STATE: SlotState = {
  sourceImage: null,
  resultSymbolImage: null,
  resultFrameImage: null,
  rows: 3,
  cols: 5,
  prompt: '',
  crop: null,
  isProcessing: false,
};

const DEFAULT_CHARACTER_STATE: CharacterState = {
  sourceImage: null,
  generatedImage: null,
  characterSheet: null,
  isolatedImage: null,
  prompt: '',
  videoPrompts: [''],
  videoCount: 1,
  crop: null,
  bgColor: 'green',
  aspectRatio: '9:16',
  generatedVideos: [],
  isProcessingReskin: false,
  isProcessingSheet: false,
  isProcessingIsolation: false,
  isProcessingVideo: false,
};

const DEFAULT_BACKGROUND_STATE: BackgroundState = {
  sourceImage: null,
  generatedImage: null,
  prompt: '',
  aspectRatio: '16:9',
  crop: null,
  isProcessing: false,
  videoPrompt: '',
  videoCount: 1,
  generatedVideos: [],
  isProcessingVideo: false,
};

const DEFAULT_SYMBOL_GEN_STATE: SymbolGeneratorState = {
  masterImage: null,
  reskinResult: null,
  masterPrompt: '',
  isProcessingMaster: false,
  activeMasterView: 'source',
  symbols: [],
  reelsFrame: null,
  gridRows: 3,
  gridCols: 5,
  gridState: Array(3).fill(null).map(() => Array(5).fill('')),
  layoutOffsetX: 0,
  layoutOffsetY: 0,
  layoutWidth: 90,
  layoutHeight: 81,
  layoutGutterHorizontal: 10,
  layoutGutterVertical: 10,
  symbolScale: 105,
  mergedFrames: [],
  savedFrames: [],
  selectedStartFrameId: null,
  selectedEndFrameId: null,
  animationPrompt: 'Slot machine reels spinning with motion blur and then stopping',
  generatedVideos: [],
  isGeneratingVideo: false,
  prompt: '',
  isProcessing: false,
  activeSubTab: 'master',
};

const DEFAULT_COMPOSITOR_STATE: CompositorState = {
  layers: [],
  selectedLayerId: null,
  canvasWidth: 1920,
  canvasHeight: 1080,
  isPlaying: false,
  isExporting: false,
  playheadTime: 0,
  compositionDuration: 10,
  timelineZoom: 20,
};

export const ExtractorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoAspectRatio, setVideoAspectRatio] = useState(16 / 9);
  const [segments, setSegments] = useState<VideoSegment[]>([]);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [modificationPrompt, setModificationPrompt] = useState('');
  const [referenceAssets, setReferenceAssets] = useState<ReferenceAsset[]>([]);
  const [clips, setClips] = useState<GeneratedClip[]>([]);
  const [slotState, setSlotState] = useState<SlotState>(DEFAULT_SLOT_STATE);
  const [characterState, setCharacterState] = useState<CharacterState>(DEFAULT_CHARACTER_STATE);
  const [backgroundState, setBackgroundState] = useState<BackgroundState>(DEFAULT_BACKGROUND_STATE);
  const [symbolGenState, setSymbolGenState] = useState<SymbolGeneratorState>(DEFAULT_SYMBOL_GEN_STATE);
  const [compositorState, setCompositorState] = useState<CompositorState>(DEFAULT_COMPOSITOR_STATE);
  const [captureTimeUnit, setCaptureTimeUnit] = useState<TimeFormat>('seconds');
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  return (
    <ExtractorContext.Provider value={{
      videoUrl, setVideoUrl,
      videoDuration, setVideoDuration,
      videoAspectRatio, setVideoAspectRatio,
      segments, setSegments,
      activeSegmentId, setActiveSegmentId,
      modificationPrompt, setModificationPrompt,
      referenceAssets, setReferenceAssets,
      clips, setClips,
      slotState, setSlotState,
      characterState, setCharacterState,
      backgroundState, setBackgroundState,
      symbolGenState, setSymbolGenState,
      compositorState, setCompositorState,
      captureTimeUnit, setCaptureTimeUnit,
      loadingAction, setLoadingAction,
    }}>
      {children}
    </ExtractorContext.Provider>
  );
};
