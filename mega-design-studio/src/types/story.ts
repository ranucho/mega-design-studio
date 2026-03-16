export enum AppStep {
    INPUT = 0,
    STORY_GENERATION = 1,
    IMAGE_GENERATION = 2,
    VIDEO_GENERATION = 3,
    PLAYBACK = 4
}

export interface Character {
    id: string;
    type: 'character' | 'object' | 'background';
    name: string;
    description: string;
    masterBlueprint?: string;
    referenceImage?: string;
    inputReferences?: string[];
    preserveOriginal?: boolean;
}

export interface StoryScene {
    id: number;
    title: string;
    dialogue: string;
    visual_prompt: string;
    action_prompt: string;
    camera_angle: string;
    imageUrl?: string;
    videoUrl?: string;
    audioUrl?: string;
    isGeneratingImage?: boolean;
    isGeneratingVideo?: boolean;
    error?: string;
    videoDuration?: number;
    trimStart?: number;
    trimEnd?: number;
    includeInVideo?: boolean;
    isHiddenFromStoryboard?: boolean;
    aspectRatio?: string;
}

export interface StoryData {
    title: string;
    style: string;
    scenes: StoryScene[];
    key_elements?: KeyElement[];
}

export interface KeyElement {
    name: string;
    description: string;
}

export interface GeneratedSceneRaw {
    title: string;
    dialogue: string;
    visual_prompt: string;
    video_prompt: string;
    camera_angle: string;
}
