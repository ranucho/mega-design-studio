import React, { useState, useEffect } from 'react';
import { AppTab } from '@/types';
import { NAV_GROUPS } from '@/utils/constants';

interface TabBarProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
}

// Color styles per group
const CS: Record<string, {
  mainActive: string;
  mainHover: string;
  subActive: string;
  subHover: string;
}> = {
  orange: {
    mainActive: 'bg-orange-500 text-white shadow-lg shadow-orange-500/25',
    mainHover: 'text-zinc-400 hover:text-orange-300 hover:bg-zinc-800',
    subActive: 'bg-orange-600 text-white',
    subHover: 'text-zinc-400 hover:text-orange-400 hover:bg-zinc-800',
  },
  blue: {
    mainActive: 'bg-blue-500 text-white shadow-lg shadow-blue-500/25',
    mainHover: 'text-zinc-400 hover:text-blue-300 hover:bg-zinc-800',
    subActive: 'bg-blue-600 text-white',
    subHover: 'text-zinc-400 hover:text-blue-400 hover:bg-zinc-800',
  },
  emerald: {
    mainActive: 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/25',
    mainHover: 'text-zinc-400 hover:text-emerald-300 hover:bg-zinc-800',
    subActive: 'bg-emerald-600 text-white',
    subHover: 'text-zinc-400 hover:text-emerald-400 hover:bg-zinc-800',
  },
  cyan: {
    mainActive: 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/25',
    mainHover: 'text-zinc-400 hover:text-cyan-300 hover:bg-zinc-800',
    subActive: 'bg-cyan-600 text-white',
    subHover: 'text-zinc-400 hover:text-cyan-400 hover:bg-zinc-800',
  },
  purple: {
    mainActive: 'bg-purple-500 text-white shadow-lg shadow-purple-500/25',
    mainHover: 'text-zinc-400 hover:text-purple-300 hover:bg-zinc-800',
    subActive: 'bg-purple-600 text-white',
    subHover: 'text-zinc-400 hover:text-purple-400 hover:bg-zinc-800',
  },
};

const TabBar: React.FC<TabBarProps> = ({ activeTab, onTabChange }) => {
  // Find which group owns the active tab
  const activeGroup = NAV_GROUPS.find(g =>
    g.children.some(c => c.id === activeTab)
  );

  // Remember the last-active child per group so clicking back restores it
  const [lastChild, setLastChild] = useState<Record<string, string>>({});

  useEffect(() => {
    if (activeGroup) {
      setLastChild(prev => ({ ...prev, [activeGroup.id]: activeTab }));
    }
  }, [activeTab, activeGroup]);

  return (
    <div>
      {/* ── Main nav row ── */}
      <div className="flex items-center gap-1 px-4 py-2 bg-zinc-900/80 border-b border-zinc-800 overflow-x-auto">
        {NAV_GROUPS.map((group, gi) => {
          const isGroupActive = activeGroup?.id === group.id;
          const c = CS[group.color] || CS.blue;

          return (
            <React.Fragment key={group.id}>
              {/* Push Assets to far right */}
              {group.id === 'assets' && <div className="flex-1" />}
              {/* Separator between non-assets groups */}
              {gi > 0 && group.id !== 'assets' && (
                <div className="w-px h-6 bg-zinc-700/50 mx-1 flex-shrink-0" />
              )}
              <button
                onClick={() => {
                  const target = lastChild[group.id] || group.children[0].id;
                  onTabChange(target as AppTab);
                }}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all whitespace-nowrap ${
                  isGroupActive ? c.mainActive : c.mainHover
                }`}
              >
                <i className={`fa-solid ${group.icon} text-xs`} />
                {group.label}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {/* ── Sub-tab row (only for multi-child groups) ── */}
      {activeGroup && activeGroup.children.length > 1 && (
        <div className="flex items-center gap-1 px-6 py-2 bg-zinc-900/50 border-b border-zinc-800 shrink-0">
          {activeGroup.children.map(child => {
            const isActive = activeTab === child.id;
            const c = CS[activeGroup.color] || CS.blue;
            return (
              <button
                key={child.id}
                onClick={() => onTabChange(child.id as AppTab)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold uppercase transition-all ${
                  isActive ? c.subActive : c.subHover
                }`}
              >
                <i className={`fas ${child.icon}`} />
                {child.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TabBar;
