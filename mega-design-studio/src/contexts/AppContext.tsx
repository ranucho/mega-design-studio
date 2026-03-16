import React, { createContext, useContext, useState, useCallback } from 'react';
import { AppTab, ReferenceAsset } from '@/types';

interface AppContextType {
  // Navigation
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;

  // Global loading
  loadingAction: string | null;
  setLoadingAction: (action: string | null) => void;

  // Shared asset library (accessible from all modules)
  assetLibrary: ReferenceAsset[];
  addAsset: (asset: ReferenceAsset) => void;
  removeAsset: (id: string) => void;
  setAssetLibrary: (assets: ReferenceAsset[]) => void;

  // Notifications
  notifyTopic: string;
  setNotifyTopic: (topic: string) => void;

  // Aspect ratio (shared preference)
  aspectRatio: string;
  setAspectRatio: (ratio: string) => void;
}

const AppContext = createContext<AppContextType | null>(null);

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
};

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeTab, setActiveTab] = useState<AppTab>('concept');
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [assetLibrary, setAssetLibrary] = useState<ReferenceAsset[]>([]);
  const [notifyTopic, setNotifyTopicState] = useState(() =>
    localStorage.getItem('megastudio_ntfy_topic') || ''
  );
  const [aspectRatio, setAspectRatio] = useState('16:9');

  const addAsset = useCallback((asset: ReferenceAsset) => {
    setAssetLibrary(prev => {
      const filtered = prev.filter(a => a.id !== asset.id);
      return [...filtered, asset];
    });
  }, []);

  const removeAsset = useCallback((id: string) => {
    setAssetLibrary(prev => prev.filter(a => a.id !== id));
  }, []);

  const setNotifyTopic = useCallback((topic: string) => {
    setNotifyTopicState(topic);
    localStorage.setItem('megastudio_ntfy_topic', topic);
  }, []);

  return (
    <AppContext.Provider value={{
      activeTab, setActiveTab,
      loadingAction, setLoadingAction,
      assetLibrary, addAsset, removeAsset, setAssetLibrary,
      notifyTopic, setNotifyTopic,
      aspectRatio, setAspectRatio,
    }}>
      {children}
    </AppContext.Provider>
  );
};
