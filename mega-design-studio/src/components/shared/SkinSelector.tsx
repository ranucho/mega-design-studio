import React, { useState, useRef, useEffect } from 'react';
import type { SlotSkin, BannerSkin } from '@/types/shared';
import { useExtractor } from '@/contexts/ExtractorContext';
import { useBanner } from '@/contexts/BannerContext';
import {
  saveSlotSkin, updateSlotSkin, loadSlotSkinIntoState, deleteSlotSkin,
  saveBannerSkin, updateBannerSkin, loadBannerSkinIntoProject, deleteBannerSkin,
} from '@/services/skinStorage';

interface SkinSelectorProps {
  type: 'slots' | 'banner';
}

// --- Inner component for Slot skins ---
const SlotSkinSelector: React.FC = () => {
  const {
    slotSkins, setSlotSkins, activeSlotSkinId, setActiveSlotSkinId, setSlotSkinIndex,
    symbolGenState, setSymbolGenState,
    compositorState, setCompositorState,
    characterState, setCharacterState,
    backgroundState, setBackgroundState,
  } = useExtractor();

  const canSave = !!(symbolGenState.masterImage && symbolGenState.symbols.length > 0);

  return (
    <SkinSelectorUI
      skins={slotSkins}
      activeSkinId={activeSlotSkinId}
      canSave={canSave}
      onSave={async (name) => {
        const skin = await saveSlotSkin(name, symbolGenState, compositorState, characterState, backgroundState);
        setSlotSkins(prev => [skin, ...prev]);
        setActiveSlotSkinId(skin.id);
        setSlotSkinIndex(prev => [{ id: skin.id, name: skin.name, thumbnailUrl: skin.thumbnailUrl, createdAt: skin.createdAt }, ...prev]);
      }}
      onLoad={(skin) => {
        loadSlotSkinIntoState(skin as SlotSkin, setSymbolGenState, setCompositorState, setCharacterState, setBackgroundState);
        setActiveSlotSkinId(skin.id);
      }}
      onUpdate={async () => {
        const active = slotSkins.find(s => s.id === activeSlotSkinId);
        if (!active) return;
        const updated = await updateSlotSkin(active as SlotSkin, symbolGenState, compositorState, characterState, backgroundState);
        setSlotSkins(prev => prev.map(s => s.id === updated.id ? updated : s));
        setSlotSkinIndex(prev => prev.map(s => s.id === updated.id ? { ...s, thumbnailUrl: updated.thumbnailUrl } : s));
      }}
      onRename={(id, newName) => {
        setSlotSkins(prev => prev.map(s => s.id === id ? { ...s, name: newName } : s));
        setSlotSkinIndex(prev => prev.map(s => s.id === id ? { ...s, name: newName } : s));
      }}
      onDelete={async (id) => {
        await deleteSlotSkin(id);
        setSlotSkins(prev => prev.filter(s => s.id !== id));
        setSlotSkinIndex(prev => prev.filter(s => s.id !== id));
        if (activeSlotSkinId === id) setActiveSlotSkinId(null);
      }}
      label="Slot Skins"
    />
  );
};

// --- Inner component for Banner skins ---
const BannerSkinSelector: React.FC = () => {
  const { bannerSkins, setBannerSkins, activeBannerSkinId, setActiveBannerSkinId, setBannerSkinIndex, project, setProject } = useBanner();

  const canSave = !!(project?.extractedElements.length);

  return (
    <SkinSelectorUI
      skins={bannerSkins}
      activeSkinId={activeBannerSkinId}
      canSave={canSave}
      onSave={async (name) => {
        if (!project) return;
        const theme = project.originalImage ? 'Reskin' : 'Original';
        const skin = await saveBannerSkin(name, theme, project);
        setBannerSkins(prev => [skin, ...prev]);
        setActiveBannerSkinId(skin.id);
        setBannerSkinIndex(prev => [{ id: skin.id, name: skin.name, thumbnailUrl: skin.thumbnailUrl, createdAt: skin.createdAt }, ...prev]);
      }}
      onLoad={(skin) => {
        loadBannerSkinIntoProject(skin as BannerSkin, setProject);
        setActiveBannerSkinId(skin.id);
      }}
      onUpdate={async () => {
        const active = bannerSkins.find(s => s.id === activeBannerSkinId);
        if (!active || !project) return;
        const updated = await updateBannerSkin(active as BannerSkin, project);
        setBannerSkins(prev => prev.map(s => s.id === updated.id ? updated : s));
        setBannerSkinIndex(prev => prev.map(s => s.id === updated.id ? { ...s, thumbnailUrl: updated.thumbnailUrl } : s));
      }}
      onRename={(id, newName) => {
        setBannerSkins(prev => prev.map(s => s.id === id ? { ...s, name: newName } : s));
        setBannerSkinIndex(prev => prev.map(s => s.id === id ? { ...s, name: newName } : s));
      }}
      onDelete={async (id) => {
        await deleteBannerSkin(id);
        setBannerSkins(prev => prev.filter(s => s.id !== id));
        setBannerSkinIndex(prev => prev.filter(s => s.id !== id));
        if (activeBannerSkinId === id) setActiveBannerSkinId(null);
      }}
      label="Banner Skins"
    />
  );
};

// --- Main export ---
export const SkinSelector: React.FC<SkinSelectorProps> = ({ type }) => {
  return type === 'slots' ? <SlotSkinSelector /> : <BannerSkinSelector />;
};

// --- Shared presentational component ---
interface SkinSelectorUIProps {
  skins: (SlotSkin | BannerSkin)[];
  activeSkinId: string | null;
  canSave: boolean;
  onSave: (name: string) => Promise<void>;
  onUpdate: () => Promise<void>;
  onLoad: (skin: SlotSkin | BannerSkin) => void;
  onRename: (id: string, newName: string) => void;
  onDelete: (id: string) => Promise<void>;
  label: string;
}

const SkinSelectorUI: React.FC<SkinSelectorUIProps> = ({
  skins, activeSkinId, canSave, onSave, onUpdate, onLoad, onRename, onDelete, label,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isNaming, setIsNaming] = useState(false);
  const [skinName, setSkinName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [justUpdated, setJustUpdated] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const activeSkin = skins.find(s => s.id === activeSkinId);

  // Reset justUpdated when skin changes
  useEffect(() => { setJustUpdated(false); }, [activeSkinId]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setIsNaming(false);
        setRenamingId(null);
      }
    };
    if (isOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  useEffect(() => {
    if (isNaming && inputRef.current) inputRef.current.focus();
  }, [isNaming]);

  useEffect(() => {
    if (renamingId && renameInputRef.current) renameInputRef.current.focus();
  }, [renamingId]);

  const handleSave = async () => {
    if (!skinName.trim() || isSaving) return;
    setIsSaving(true);
    try {
      await onSave(skinName.trim());
      setSkinName('');
      setIsNaming(false);
    } catch (err) {
      console.error('Failed to save skin:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoad = (skin: SlotSkin | BannerSkin) => {
    onLoad(skin);
    setIsOpen(false);
    setJustUpdated(false);
  };

  const handleDelete = async (e: React.MouseEvent, skinId: string) => {
    e.stopPropagation();
    try {
      await onDelete(skinId);
    } catch (err) {
      console.error('Failed to delete skin:', err);
    }
  };

  const handleRenameSubmit = (skinId: string) => {
    if (renameValue.trim() && renameValue.trim() !== skins.find(s => s.id === skinId)?.name) {
      onRename(skinId, renameValue.trim());
    }
    setRenamingId(null);
  };

  if (skins.length === 0 && !canSave) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900/50 border border-zinc-800 rounded-lg">
        {/* Dropdown toggle */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 text-sm hover:text-white transition-colors min-w-0"
        >
          {activeSkin?.thumbnailUrl && (
            <img src={activeSkin.thumbnailUrl} alt="" className="w-6 h-6 rounded object-cover flex-shrink-0" />
          )}
          <i className="fa-solid fa-palette text-xs text-indigo-400" />
          <span className="text-zinc-300 truncate max-w-[120px]">
            {activeSkin?.name || 'Skins'}
          </span>
          {/* Only show count when no skin is selected */}
          {!activeSkin && (
            <span className={`text-xs font-semibold ${skins.length > 0 ? 'text-indigo-400' : 'text-zinc-400'}`}>({skins.length})</span>
          )}
          <i className={`fa-solid fa-chevron-down text-xs text-zinc-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {/* Save / Update buttons */}
        {canSave && (
          <>
            <div className="w-px h-4 bg-zinc-700" />
            {isNaming ? (
              <div className="flex items-center gap-1">
                <input
                  ref={inputRef}
                  type="text"
                  value={skinName}
                  onChange={e => setSkinName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSave();
                    if (e.key === 'Escape') { setIsNaming(false); setSkinName(''); }
                  }}
                  placeholder="Skin name..."
                  className="w-28 bg-zinc-800 border border-zinc-600 rounded px-2 py-0.5 text-xs text-white outline-none focus:border-indigo-500"
                />
                <button
                  onClick={handleSave}
                  disabled={!skinName.trim() || isSaving}
                  className="text-xs text-emerald-400 hover:text-emerald-300 disabled:opacity-50 px-1"
                >
                  {isSaving ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-check" />}
                </button>
                <button
                  onClick={() => { setIsNaming(false); setSkinName(''); }}
                  className="text-xs text-zinc-400 hover:text-zinc-300 px-1"
                >
                  <i className="fa-solid fa-xmark" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {activeSkin && (
                  <button
                    onClick={async () => {
                      setIsUpdating(true);
                      try { await onUpdate(); setJustUpdated(true); } catch (err) { console.error('Failed to update skin:', err); }
                      finally { setIsUpdating(false); }
                    }}
                    disabled={isUpdating || justUpdated}
                    className={`flex items-center gap-1 text-xs transition-colors whitespace-nowrap disabled:opacity-50 ${
                      justUpdated ? 'text-zinc-400' : 'text-indigo-400 hover:text-indigo-300'
                    }`}
                    title={justUpdated ? 'Skin is up to date' : `Update "${activeSkin.name}" with current state`}
                  >
                    {isUpdating ? <i className="fa-solid fa-spinner fa-spin" /> : justUpdated ? <i className="fa-solid fa-check" /> : <i className="fa-solid fa-arrow-up-from-bracket" />}
                    <span>{justUpdated ? 'Saved' : 'Update'}</span>
                  </button>
                )}
                <button
                  onClick={() => setIsNaming(true)}
                  className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors whitespace-nowrap"
                  title="Save current state as a new skin"
                >
                  <i className="fa-solid fa-plus" />
                  <span>Save New</span>
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Dropdown panel */}
      {isOpen && skins.length > 0 && (
        <div className="absolute top-full right-0 mt-1 z-50 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl overflow-hidden min-w-[280px] max-w-[380px]">
          <div className="p-2 border-b border-zinc-800">
            <span className="text-xs text-zinc-400 font-medium uppercase tracking-wide">
              {label}
            </span>
          </div>
          <div className="max-h-[340px] overflow-y-auto">
            {skins.map(skin => (
              <div
                key={skin.id}
                onClick={() => renamingId !== skin.id && handleLoad(skin)}
                className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors group ${
                  skin.id === activeSkinId
                    ? 'bg-indigo-500/10 border-l-2 border-indigo-500'
                    : 'hover:bg-zinc-800/50 border-l-2 border-transparent'
                }`}
              >
                {skin.thumbnailUrl ? (
                  <img src={skin.thumbnailUrl} alt="" className="w-14 h-14 rounded-lg object-cover flex-shrink-0 border border-zinc-700" />
                ) : (
                  <div className="w-14 h-14 rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0">
                    <i className="fa-solid fa-image text-zinc-400" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  {renamingId === skin.id ? (
                    <input
                      ref={renameInputRef}
                      type="text"
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={() => handleRenameSubmit(skin.id)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleRenameSubmit(skin.id);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      onClick={e => e.stopPropagation()}
                      className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-0.5 text-sm text-white outline-none focus:border-indigo-500"
                    />
                  ) : (
                    <div className="text-sm text-white truncate">{skin.name}</div>
                  )}
                  <div className="text-xs text-zinc-400">
                    {new Date(skin.createdAt).toLocaleDateString()}
                    {skin.isUploaded && <i className="fa-solid fa-cloud text-emerald-500 ml-1.5" title="Synced to cloud" />}
                  </div>
                </div>
                {skin.id === activeSkinId && (
                  <i className="fa-solid fa-check text-indigo-400 text-xs" />
                )}
                {/* Rename button */}
                <button
                  onClick={(e) => { e.stopPropagation(); setRenamingId(skin.id); setRenameValue(skin.name); }}
                  className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-zinc-300 transition-all p-1"
                  title="Rename"
                >
                  <i className="fa-solid fa-pen text-xs" />
                </button>
                {/* Delete button */}
                <button
                  onClick={(e) => handleDelete(e, skin.id)}
                  className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-400 transition-all p-1"
                  title="Delete skin"
                >
                  <i className="fa-solid fa-trash-can text-xs" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
