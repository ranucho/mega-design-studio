# Mega Design Studio

AI-powered design tool for gaming assets — banner reskinning, slot machine symbol extraction, character/background studios, and animation generation.

## Quick Start

```bash
cd mega-design-studio
npm run dev        # Vite dev server on http://localhost:3000
npm run build      # Production build
```

Port: **3000** (configured in vite.config.ts, bound to 0.0.0.0)

## Tech Stack

- React 19 + TypeScript 5.8 + Vite 6
- Tailwind CSS (utility classes, dark theme, zinc/slate palette)
- Google Gemini API (`@google/genai`) for all AI generation
- Firebase (storage + anonymous auth) — not yet configured with a project
- IndexedDB for local skin/asset persistence
- JSZip for export

## Project Structure

```
mega-design-studio/
├── src/
│   ├── App.tsx                      # Root — wraps everything in context providers
│   ├── components/
│   │   ├── animatix/                # Story concept → storyboard → movie pipeline
│   │   ├── extractor/               # SymbolGenerator, CharacterStudio, BackgroundStudio, Compositor
│   │   ├── banners/                 # BannerUpload → Extract → Sizes → Edit → Export
│   │   ├── shared/                  # SkinSelector, AspectRatioSelector, Toast, Particles
│   │   └── ui/                      # Button, Card, Modal, TabBar, TextInput, Select
│   ├── contexts/
│   │   ├── AppContext.tsx            # Global: nav tabs, asset library, notifications
│   │   ├── AnimatixContext.tsx       # Story/concept/movie state
│   │   ├── ExtractorContext.tsx      # Symbol gen, character, background, compositor state + slot skins
│   │   └── BannerContext.tsx         # Banner project state + banner skins
│   ├── services/
│   │   ├── gemini/                   # AI calls: client.ts, image.ts, video.ts, banner.ts, story.ts, analysis.ts
│   │   │   └── banner-rules.ts      # Composition + reskin rules (source of truth for AI layout)
│   │   ├── firebase.ts              # Cloud storage (not yet configured)
│   │   ├── skinDb.ts                # IndexedDB for skin persistence
│   │   ├── skinStorage.ts           # Save/load/delete skins (local + cloud)
│   │   ├── parallelBatch.ts         # Concurrent AI call batching
│   │   └── export.ts                # ZIP export
│   ├── types/                       # shared.ts (main types), editor.ts, story.ts
│   ├── hooks/                       # useAsyncOperation, useBatchProcessor, useCropTool, useTimeline
│   └── utils/                       # constants.ts (nav config, tab registry), imageUtils.ts
```

## Architecture

**State management:** React Context (AppContext, ExtractorContext, BannerContext, AnimatixContext). No Redux.

**Tab system:** All tabs stay mounted (hidden via CSS). Active tab toggled by state in AppContext. Nav groups defined in `utils/constants.ts`.

**Main navigation tabs:**
- **Animatix** — Concept → Storyboard → Movie (video generation pipeline)
- **Capture & Reskin** — Video capture → image extraction → editing
- **Slots Generator** — Symbol Gen → Character → Background → Compositor
- **Banners** — Upload → Extract → Sizes → Edit → Fine Tune → Export

**AI service pattern:** All Gemini calls go through `services/gemini/client.ts` (singleton, retry with exponential backoff). Each domain has its own module (image.ts, banner.ts, video.ts, story.ts).

**Skin system:** Multi-skin versioning for both slots and banners. Skins stored in IndexedDB (skinDb.ts), with optional Firebase cloud sync. SkinSelector component shared between both flows.

## Path Alias

`@` → `./src` (configured in vite.config.ts and tsconfig.json)

## Environment

```bash
# .env.local (not committed)
GEMINI_API_KEY=...              # Also stored in localStorage as gemini_api_key

# Firebase (not yet configured)
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

## Key Conventions

- Screen colors for chroma key: `#00fa15` (green), `#0072ff` (blue), `#ff4dfd` (pink)
- Banner composition rules live in `services/gemini/banner-rules.ts` — edit there to change AI layout behavior
- Reskin rules (layout preservation, character consistency, brand logos sacred) are in the same file
- Asset extraction uses crop-based AI isolation with white-to-alpha conversion for transparency
- All tabs use the same dark theme: zinc-900 backgrounds, rounded-2xl cards, uppercase tracking-widest headers

## Sibling Projects

These live alongside this project in `D:\Dropbox\ONGOING\Claude test\`:
- `00 App Hub` — Landing page for all apps (port 3333)
- `01 Agents Dashboard` — Python HTTP server (port 8080)
- `03 SmallTalkGraphics` — Infographics from meeting notes (port 3001)
- `04 Figma Assistant` — Design system generation
- `05 Presentations` — Generated slide decks

## Deployment

Previously deployed to Netlify (not currently up to date).
