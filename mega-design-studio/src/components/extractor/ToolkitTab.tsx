import React, { useState } from 'react';
import { SlotMachineStudio } from './SlotMachineStudio';
import { CharacterStudio } from './CharacterStudio';
import { BackgroundStudio } from './BackgroundStudio';
import { SymbolGenerator } from './SymbolGenerator';
import { Compositor } from './Compositor';
import { ToolkitSubTab } from '@/types';

const SUB_TABS: { id: ToolkitSubTab; label: string; icon: string; color: string }[] = [
  { id: 'symbol-gen', label: 'Symbol Gen', icon: 'fa-shapes', color: 'emerald' },
  { id: 'character', label: 'Character', icon: 'fa-user-ninja', color: 'emerald' },
  { id: 'background', label: 'Background', icon: 'fa-image', color: 'emerald' },
  { id: 'compositor', label: 'Compositor', icon: 'fa-layer-group', color: 'emerald' },
  // { id: 'slots', label: 'Slot Machine', icon: 'fa-border-all', color: 'emerald' },  // hidden for now
];

export const ToolkitTab: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<ToolkitSubTab>('symbol-gen');

  return (
    <div className="flex flex-col h-full">
      {/* Sub-tab bar */}
      <div className="flex items-center gap-1 px-6 py-2 bg-zinc-900/50 border-b border-zinc-800 shrink-0">
        {SUB_TABS.map(tab => {
          const isActive = activeSubTab === tab.id;
          const colorClasses: Record<string, string> = {
            indigo: isActive ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-indigo-400 hover:bg-zinc-800',
            amber: isActive ? 'bg-amber-600 text-white' : 'text-zinc-400 hover:text-amber-400 hover:bg-zinc-800',
            pink: isActive ? 'bg-pink-600 text-white' : 'text-zinc-400 hover:text-pink-400 hover:bg-zinc-800',
            emerald: isActive ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:text-emerald-400 hover:bg-zinc-800',
            blue: isActive ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-blue-400 hover:bg-zinc-800',
            violet: isActive ? 'bg-violet-600 text-white' : 'text-zinc-400 hover:text-violet-400 hover:bg-zinc-800',
          };
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold uppercase transition-all ${colorClasses[tab.color]}`}
            >
              <i className={`fas ${tab.icon}`} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content - all sub-tabs stay mounted, toggled via hidden */}
      <div className="flex-1 overflow-hidden">
        <div className={`h-full ${activeSubTab === 'slots' ? '' : 'hidden'}`}><SlotMachineStudio /></div>
        <div className={`h-full ${activeSubTab === 'character' ? '' : 'hidden'}`}><CharacterStudio /></div>
        <div className={`h-full ${activeSubTab === 'symbol-gen' ? '' : 'hidden'}`}><SymbolGenerator /></div>
        <div className={`h-full ${activeSubTab === 'background' ? '' : 'hidden'}`}><BackgroundStudio /></div>
        <div className={`h-full ${activeSubTab === 'compositor' ? '' : 'hidden'}`}><Compositor /></div>
      </div>
    </div>
  );
};
