import React, { createContext, useContext, useState, useCallback } from 'react';
import { Character, StoryScene, AppStep } from '@/types';

interface AnimatixContextType {
  // Characters
  characters: Character[];
  setCharacters: React.Dispatch<React.SetStateAction<Character[]>>;

  // Story
  style: string;
  setStyle: (style: string) => void;
  brief: string;
  setBrief: (brief: string) => void;
  sceneCount: number;
  setSceneCount: (count: number) => void;
  storyTitle: string;
  setStoryTitle: (title: string) => void;

  // Scenes
  scenes: StoryScene[];
  setScenes: React.Dispatch<React.SetStateAction<StoryScene[]>>;

  // Workflow
  step: AppStep;
  setStep: (step: AppStep) => void;
  isApproved: boolean;
  setIsApproved: (approved: boolean) => void;

  // Video queue
  videoQueue: number[];
  setVideoQueue: React.Dispatch<React.SetStateAction<number[]>>;

  // Aspect Ratio
  aspectRatio: string;
  setAspectRatio: (ar: string) => void;

  // Status
  statusMessage: string;
  setStatusMessage: (msg: string) => void;
}

const AnimatixContext = createContext<AnimatixContextType | null>(null);

export const useAnimatix = () => {
  const ctx = useContext(AnimatixContext);
  if (!ctx) throw new Error("useAnimatix must be used within AnimatixProvider");
  return ctx;
};

export const AnimatixProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [characters, setCharacters] = useState<Character[]>([
    { id: '1', type: 'character', name: '', description: '', inputReferences: [] }
  ]);
  const [style, setStyle] = useState('');
  const [brief, setBrief] = useState('');
  const [sceneCount, setSceneCount] = useState(4);
  const [storyTitle, setStoryTitle] = useState('');
  const [scenes, setScenes] = useState<StoryScene[]>([]);
  const [step, setStep] = useState<AppStep>(AppStep.INPUT);
  const [isApproved, setIsApproved] = useState(false);
  const [videoQueue, setVideoQueue] = useState<number[]>([]);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [statusMessage, setStatusMessage] = useState('');

  return (
    <AnimatixContext.Provider value={{
      characters, setCharacters,
      style, setStyle,
      brief, setBrief,
      sceneCount, setSceneCount,
      storyTitle, setStoryTitle,
      scenes, setScenes,
      step, setStep,
      isApproved, setIsApproved,
      videoQueue, setVideoQueue,
      aspectRatio, setAspectRatio,
      statusMessage, setStatusMessage,
    }}>
      {children}
    </AnimatixContext.Provider>
  );
};
