/**
 * BANNER COMPOSITION RULES — Source of Truth
 *
 * These rules govern how extracted elements are composed into banner layouts.
 * The AI layout engine reads these rules and follows them strictly.
 * Edit this file to update composition behavior globally.
 */

// ════════════════════════════════════════════════════════════════
// LAYER ORDER RULES
// ════════════════════════════════════════════════════════════════
export const LAYER_ORDER_RULES = `
LAYER ORDER — DEFAULT (bottom to top):
1. Background — always the BOTTOM layer. Uses COVER mode (uniform scale, centered, may crop edges but NEVER stretched/distorted)
2. Coins/coin piles — one layer above background (if present)
3. Game shot / screenshot — above coins
4. Decorations (ribbons, badges, sparkles) — mid layers
5. Character — can be ABOVE or BELOW game shots, depending on the design
6. Text/headlines — above most elements
7. Logo — near top
8. Speech bubbles — near top
9. CTA button — always the TOP layer, above everything

CRITICAL: When a REFERENCE LAYOUT is provided, its layer order is the GROUND TRUTH. Follow the reference's stacking exactly. If the reference puts the character BEHIND the game shot, you MUST do the same. Do NOT apply the default order above — the reference overrides it.
`;

// ════════════════════════════════════════════════════════════════
// LAYOUT RULES — GENERAL
// ════════════════════════════════════════════════════════════════
export const LAYOUT_RULES_GENERAL = `
LAYOUT RULES — follow these EXACT position templates measured from professional reference banners.
Each element position is given as percentage of canvas (xPct, yPct = top-left corner; wPct, hPct = size).
Place each element AT these positions. This is NOT a suggestion — these are measured from real designs.

LANDSCAPE TEMPLATE (for banners wider than tall, ratio > 1.2):
  Ribbon:         x:0%   y:0%   w:8%   h:13%  (flush top-left corner)
  Logo:           x:86%  y:0%   w:13%  h:11%  (top-right corner, small)
  Headline:       x:14%  y:0%   w:57%  h:19%  (top, spanning above slot)
  Speech Bubble:  x:71%  y:11%  w:19%  h:18%  (near character head)
  Character:      x:72%  y:21%  w:28%  h:73%  (RIGHT side, large, overlapping slot from front)
  Slot/Reel:      x:5%   y:21%  w:54%  h:65%  (LEFT-CENTER, prominent)
  CTA:            x:18%  y:85%  w:42%  h:13%  (bottom-center)
  Coins:          x:54%  y:69%  w:21%  h:31%  (bottom, decorative, can overflow)

PORTRAIT TEMPLATE (for banners taller than wide, ratio < 0.9):
  Ribbon:         x:0%   y:0%   w:12%  h:6%   (flush top-left corner)
  Logo:           x:42%  y:1%   w:20%  h:5%   (top area, can be top-right)
  Headline:       x:5%   y:4%   w:89%  h:13%  (top, wide, bold)
  Speech Bubble:  x:48%  y:16%  w:32%  h:9%   (near character head)
  Character:      x:40%  y:13%  w:50%  h:31%  (upper-mid, RIGHT of slot, large)
  Slot/Reel:      x:2%   y:40%  w:67%  h:37%  (center area, prominent)
  CTA:            x:12%  y:86%  w:76%  h:9%   (bottom, wide)
  Coins:          x:60%  y:68%  w:34%  h:20%  (bottom-right, decorative)

SQUARE TEMPLATE (for banners with ratio 0.9-1.2, including 300x250, 336x280):
  Ribbon:         x:0%   y:0%   w:11%  h:11%  (flush top-left)
  Logo:           x:82%  y:0%   w:17%  h:10%  (top-right, small)
  Headline:       x:9%   y:2%   w:74%  h:18%  (top, bold)
  Speech Bubble:  x:71%  y:18%  w:24%  h:13%  (right side, near character)
  Character:      x:70%  y:28%  w:30%  h:55%  (RIGHT side, overlapping slot)
  Slot/Reel:      x:3%   y:24%  w:65%  h:54%  (center-left, large)
  CTA:            x:15%  y:82%  w:68%  h:14%  (bottom, wide)
  Coins:          x:53%  y:67%  w:38%  h:33%  (bottom, decorative overflow)

CRITICAL RULES:
- Character is ALWAYS on the RIGHT side, in front of/overlapping the slot. This is intentional.
- Slot/reel is ALWAYS left or center-left. It is the main visual element.
- The composition should feel FULL and DENSE — this is a gaming ad.
- Coins can overflow the bottom canvas edge.
- Ribbon is ALWAYS at (0,0) flush to top-left corner.
- Logo is small (10-17% width). NEVER make the logo large.
- Character face must NOT be covered by other elements.
`;

// ════════════════════════════════════════════════════════════════
// LAYOUT RULES — WIDE STRIP BANNERS
// ════════════════════════════════════════════════════════════════
export const LAYOUT_RULES_STRIP = `
STRIP BANNER LAYOUT — measured from professional reference banners:

STRIP TEMPLATE (for 300x50, 320x50, 468x60, 728x90):
  Ribbon:     x:0%   y:0%   w:8%   h:46%  (top-left corner)
  Logo:       x:8%   y:3%   w:13%  h:54%  (right of ribbon)
  Headline:   x:22%  y:5%   w:44%  h:77%  (center, LARGE and readable)
  Character:  x:64%  y:7%   w:21%  h:89%  (bust/closeup, right of headline)
  CTA:        x:85%  y:13%  w:14%  h:72%  (right edge, SHORT text)

728x90 ONLY — also show:
  Speech Bubble: x:60% y:0% w:18% h:65% (between headline and character)

HIDDEN on ALL strip banners:
- Slot machine / game screenshots → visible: false
- Coin piles → visible: false (except 728x90 and 468x60 where decorative coins at bottom-center are OK)
- Decorations (except ribbon) → visible: false
- Speech bubble → visible: false EXCEPT on 728x90

320x100 SPECIAL — wider strip, slightly different layout:
  Ribbon:     x:0%   y:0%   w:8%   h:30%
  Logo:       x:82%  y:0%   w:16%  h:25%  (top-right, NOT left like other strips)
  Headline:   x:15%  y:5%   w:50%  h:50%
  Character:  x:65%  y:10%  w:25%  h:85%
  CTA:        x:20%  y:60%  w:25%  h:30%  (below headline, not right-edge)
`;

// ════════════════════════════════════════════════════════════════
// LAYOUT RULES — SLIM BANNERS (very wide, very short)
// ════════════════════════════════════════════════════════════════
export const LAYOUT_RULES_SLIM = `SLIM BANNER RULES (for 728x90, 468x60, 320x50, 300x50, 320x100):
- NO slot machine, NO game screenshot, NO coins — hide these elements
- Character: FACE/BUST closeup only, cropped from chest up
- Layout: Ribbon (left) → Logo (left) → Headline + Character closeup (center) → CTA (right)
- Logo: LEFT-ALIGNED, next to ribbon
- CTA: RIGHT-ALIGNED, with shortened text (e.g. "SPIN NOW" → "SPIN")
- Speech bubble: ONLY on 728x90, hidden on all smaller strips
- Text is centered and short (1 line max on 300x50/320x50, 1-2 lines on larger)
- Background: simple, cover-cropped`;

export const LAYOUT_RULES_320x100 = `SPECIAL RULE FOR 320x100:
- Logo position: placed ABOVE the CTA (can be left/center/right)
- CTA: center or right aligned
- Character optional — only bust if used`;

export const LAYOUT_RULES_MOBILE = `MOBILE RULES (for widths < 600px, non-slim):
- Larger touch targets for CTA
- Simpler composition
- Character scaled larger (face visible)
- Text readable at small size (shorter headlines)`;

// ════════════════════════════════════════════════════════════════
// SIZE-SPECIFIC LAYOUT HINTS (from designer reference)
// ════════════════════════════════════════════════════════════════
export const SIZE_SPECIFIC_HINTS: Record<string, string> = {
  '480x320': `480x320 LANDSCAPE LAYOUT:
- Slot machine: LEFT side, ~50% width, vertically centered
- Character: RIGHT side, beside the slot (not covering it)
- Headline: TOP area, above the slot
- NEW ribbon: TOP-LEFT corner, flush — headline must not overlap it
- Logo: TOP-RIGHT, small
- Speech bubble: near character head, NOT on face
- CTA: BOTTOM CENTER, wide, with padding from edges
- Coins: bottom edge, small, decorative`,

  '300x600': `300x600 HALF-PAGE PORTRAIT LAYOUT:
- This is a TALL, NARROW banner — stack vertically
- Headline: TOP (~5-20%), below ribbon
- NEW ribbon: TOP-LEFT flush
- Logo: TOP-RIGHT, small (~12% width)
- Character: UPPER-MID (~20-45%), to the right of or overlapping slot
- Slot machine: MIDDLE (~25-55%), must be FULLY WITHIN canvas — scale down if needed
- Speech bubble: near character head area
- CTA: LOWER area (~70-80%), centered, with clear margins
- Coins: BOTTOM (~85-100%), on the ground`,

  '320x480': `320x480 MOBILE PORTRAIT LAYOUT:
- Stack vertically with clear zones
- Headline: TOP area
- Slot + Character: MIDDLE zone
- CTA: LOWER area but NOT touching the bottom border — at least 5% margin
- Keep all elements scaled small enough to fit the narrow 320px width`,

  '480x480': `480x480 SQUARE LAYOUT:
- Slot machine: LEFT-CENTER area, ~45% width
- Character: RIGHT side, BESIDE the slot — NOT in front of it
- Headline: TOP area
- Speech bubble: positioned near character head, NOT covering face
- CTA: BOTTOM CENTER, wide
- Coins: bottom edge, small
- Logo: TOP-RIGHT corner`,

  '1080x1350': `1080x1350 INSTAGRAM PORTRAIT LAYOUT:
- CRITICAL: Do NOT make elements oversized just because the canvas is large
- Character: ~30% of canvas height, positioned to RIGHT of slot
- Logo: small (~12% width), top-right corner — must NOT overlap headline
- Headline: TOP area (~5-15%), must NOT overlap the NEW ribbon
- NEW ribbon: TOP-LEFT flush, always fully visible
- Slot machine: MIDDLE area, ~40% width
- CTA: centered, ~30% width, positioned at ~70-80% height — NOT at bottom edge
- Coins: bottom, small, decorative`,

  '768x1024': `768x1024 iPad PORTRAIT — CRITICAL SPACING RULES:
- This is a TALL canvas — elements must be spread across the full height
- DO NOT cluster elements in the center — use the full vertical space
- TOP ZONE (0-15%): NEW ribbon (top-left) + Headline
- UPPER (15-30%): Logo (small, corner) + Speech bubble
- MIDDLE (25-60%): Character (right side) + Slot machine (left/center)
- LOWER (65-80%): CTA button (centered, with margins)
- BOTTOM (80-100%): Coins on the ground
- Each element must have clear breathing room — no piling or stacking on top of each other`,

  '300x250': `300x250 MEDIUM RECTANGLE LAYOUT:
- Compact layout — every pixel counts
- Headline: TOP area, bold, readable
- Slot: CENTER-LEFT, ~45% width
- Character: RIGHT side, beside slot
- CTA: BOTTOM CENTER but NOT below canvas — position at ~75-85% height with margins
- Slot/screenshot: must be sized to fit within canvas, not cropped outside
- Coins: bottom edge or omit on this small size`,

  '300x50': `300x50 TINY STRIP — LEFT TO RIGHT:
- Ribbon: top-left, ~80% of height
- Logo: next to ribbon, ~40px wide
- Headline: center, 1 line, readable
- Character: face closeup only, behind/beside headline
- CTA: right edge, short text ("SPIN")
- HIDDEN: slot, coins, speech bubble, decorations`,

  '320x50': `320x50 MOBILE STRIP — LEFT TO RIGHT:
- Ribbon: top-left, ~80% of height
- Logo: next to ribbon, ~40px wide
- Headline: center, 1 line, readable
- Character: face closeup only, behind/beside headline
- CTA: right edge, short text ("SPIN")
- HIDDEN: slot, coins, speech bubble, decorations`,

  '468x60': `468x60 FULL BANNER STRIP — LEFT TO RIGHT:
- Ribbon: top-left, ~80% of height
- Logo: next to ribbon
- Headline: center area, prominent, 1-2 lines
- Character: bust/face closeup, beside headline
- CTA: right edge, short text
- HIDDEN: slot, coins, speech bubble, decorations`,

  '728x90': `728x90 LEADERBOARD — LEFT TO RIGHT:
- Ribbon: top-left, ~70% of height
- Logo: next to ribbon
- Headline: center-left area, large and readable
- Character: bust/face closeup, center-right, beside headline
- Speech bubble: YES — can appear near character head (only strip size with bubble)
- CTA: right edge, short text
- HIDDEN: slot, coins, decorations`,

  '336x280': `336x280 LARGE RECTANGLE LAYOUT:
- Similar to 300x250 but slightly more room
- Headline: TOP, must be READABLE — at least 14-16px equivalent, spanning most of the width
- Slot: CENTER area
- Character: RIGHT side
- CTA: BOTTOM CENTER at ~75-85% height — NOT touching bottom edge
- Title text must be large enough to read at a glance`,
};

export const LAYOUT_RULES_PORTRAIT_CONVERSION = `HORIZONTAL → VERTICAL CONVERSION:
When converting from landscape to portrait:
- Do NOT just scale elements; REARRANGE the composition into clear vertical zones
- TOP ZONE (~0-15%): Ribbon (flush corner) + Headline text
- UPPER-MID ZONE (~15-35%): Logo (small, in corner) + Speech bubble
- MIDDLE ZONE (~25-65%): Character + Slot machine side by side (character beside slot, NOT covering it)
- LOWER ZONE (~65-85%): CTA button (centered, with clear padding from edges)
- BOTTOM ZONE (~80-100%): Coins (on the ground, decorative)
- Each zone must have BREATHING ROOM — at least 3-5% gap between major elements
- CRITICAL: Do NOT cluster all elements in the center — spread them vertically across the full canvas
- Character can be moved/repositioned — not anchored to horizontal position`;

export const ASSET_PRIORITY_RULES = `ASSET PRIORITY (when space is limited, drop/shrink in this order, keeping HIGHEST first):
1. Text (highest — always visible)
2. Slot/Main Character
3. CTA (always visible, text can shorten)
4. Decorative Elements
5. Logo
6. Background (lowest — cover-crops)`;

// ════════════════════════════════════════════════════════════════
// CTA ABBREVIATION MAP — for slim banners
// ════════════════════════════════════════════════════════════════
export const CTA_ABBREVIATION_MAP: Record<string, string> = {
  'SPIN NOW': 'SPIN',
  'SPIN NOW!': 'SPIN',
  'GRAB A BONUS': 'GRAB',
  'GRAB A BONUS!': 'GRAB',
  'GRAB BONUS': 'GRAB',
  'GRAB NOW': 'GRAB',
  'CLAIM NOW!': 'CLAIM',
  'CLAIM NOW': 'CLAIM',
  'CLAIM BONUS': 'CLAIM',
  'CLAIM REWARD': 'CLAIM',
  'COLLECT NOW': 'COLLECT',
  'COLLECT NOW!': 'COLLECT',
  'COLLECT BONUS': 'COLLECT',
  'PLAY NOW': 'PLAY',
  'PLAY NOW!': 'PLAY',
  'PLAY FREE': 'PLAY',
  'GET NOW': 'GET',
  'GET NOW!': 'GET',
  'GET BONUS': 'GET',
  'WIN NOW': 'WIN',
  'WIN NOW!': 'WIN',
  'WIN BIG': 'WIN',
  'SPIN TO WIN': 'SPIN',
  'SPIN & WIN': 'SPIN',
  'DOWNLOAD NOW': 'GET',
  'INSTALL NOW': 'GET',
  'TRY NOW': 'TRY',
  'START NOW': 'START',
  'JOIN NOW': 'JOIN',
  'TAP TO PLAY': 'PLAY',
  'TAP TO SPIN': 'SPIN',
  'LEARN MORE': 'MORE',
  'SHOP NOW': 'SHOP',
  'BUY NOW': 'BUY',
};

/**
 * Returns true when the banner is a slim/strip ad format
 * (very wide, very short — e.g. 728x90, 320x50, 468x60, 320x100).
 */
export function isSlimBanner(width: number, height: number): boolean {
  return height <= 100 && width / height >= 3;
}

/**
 * Returns true when the banner is SLIM or TOWER — its aspect ratio is so extreme
 * (very wide or very tall) that a short CTA copy fits much better than the full phrase.
 * This is decided by ASPECT RATIO, not by dimensions. Standard/landscape/portrait/
 * square banners return false even when physically small.
 *
 *   aspect = width / height
 *   aspect >= 2.2  → slim / strip / leaderboard (e.g. 728x90, 320x50, 970x250)
 *   aspect <= 0.45 → tower / skyscraper / tall (e.g. 160x600, 300x600, 120x600)
 *   otherwise      → standard (square, landscape, portrait) → keep original CTA
 */
export function isNarrowBanner(width: number, height: number): boolean {
  const aspect = width / height;
  if (aspect >= 2.2) return true;   // slim / strip
  if (aspect <= 0.45) return true;  // tower / skyscraper
  return false;
}

/**
 * Returns true when the banner is TALL (portrait). Used to prefer 2-line headline
 * variants for better text wrapping.
 */
export function isTallBanner(width: number, height: number): boolean {
  return height / width >= 1.4;
}

/**
 * Abbreviate CTA text for narrow banners. Returns the original text unchanged
 * when the banner is not narrow, or when no abbreviation exists.
 */
export function abbreviateCTA(text: string, width: number, height: number): string {
  if (!text) return text;
  if (!isNarrowBanner(width, height)) return text;
  const upper = text.trim().toUpperCase();
  return CTA_ABBREVIATION_MAP[upper] ?? text;
}

/**
 * Returns the size-specific composition rules that apply to a given
 * target banner width/height.
 */
export function getSizeSpecificRules(width: number, height: number): string {
  const ratio = width / height;
  const rules: string[] = [];

  // Slim banners (very wide, low height)
  const isSlim = height <= 100 && ratio >= 3;
  if (isSlim) rules.push(LAYOUT_RULES_SLIM);

  // Special 320x100
  if (width === 320 && height === 100) rules.push(LAYOUT_RULES_320x100);

  // Mobile (< 600px width, not slim)
  if (width < 600 && !isSlim) rules.push(LAYOUT_RULES_MOBILE);

  // Portrait conversion
  if (ratio < 1) rules.push(LAYOUT_RULES_PORTRAIT_CONVERSION);

  // Size-specific designer hints
  const sizeKey = `${width}x${height}`;
  if (SIZE_SPECIFIC_HINTS[sizeKey]) {
    rules.push(SIZE_SPECIFIC_HINTS[sizeKey]);
  }

  return rules.join('\n\n');
}

// ════════════════════════════════════════════════════════════════
// COMBINED RULES — fed to the AI layout engine
// ════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════
// RESKIN RULES — governs how reskinned images must match the source
// ════════════════════════════════════════════════════════════════
export const RESKIN_RULES = `
RESKIN COMPOSITION RULES (these are MANDATORY):
1. LAYOUT PRESERVATION: The reskinned image must maintain the exact same composition, layout, and element placement as the source image. Every element must be in the same position, same size, and same proportions.
2. CHARACTER/OBJECT CONSISTENCY: If the source image has a large character or object (e.g. above the slot area or as the main visual), the reskin MUST have a character or object of the SAME SIZE, LAYOUT, and COMPOSITION. You CANNOT shrink a face into a full torso, or turn a close-up into a wide shot. Match the framing exactly.
3. NO INVENTED TEXT: If the source image does NOT contain decorative text or a title/headline, the reskin MUST NOT generate any text. Only reskin text that already exists in the source.
4. BRAND LOGOS ARE SACRED: Company/brand logos in the corners (not game-specific logos on the reel itself) MUST NOT be changed, removed, or replaced. These are brand identities and are off-limits for reskinning. If a logo appears in a corner, keep it exactly as-is or omit that area from generation.
5. STYLE MATCHING: The reskin should match the art style, rendering quality, and visual fidelity of the source. If the source is highly detailed 3D-rendered art, the reskin must also be highly detailed 3D-rendered art. Do not downgrade quality.
6. ELEMENT COUNT: The number of distinct visual elements must match. If the source has 5 slot symbols, the reskin must also produce exactly 5 slot symbols. Do not add or remove elements.
`;

export const ALL_COMPOSITION_RULES = `${LAYER_ORDER_RULES}
${LAYOUT_RULES_GENERAL}
${LAYOUT_RULES_STRIP}
${ASSET_PRIORITY_RULES}
${RESKIN_RULES}`;

/**
 * Determine the layer z-order index for a given role.
 * Lower number = further back. Used to sort layers after AI generates positions.
 */
export const ROLE_Z_ORDER: Record<string, number> = {
  background: 0,
  decoration: 10,  // coins, sparkles, etc.
  other: 20,       // game shots, screenshots
  character: 40,
  text: 50,
  logo: 60,
  cta: 70,         // always on top
};

/**
 * Get z-order for a layer based on its role and label.
 * Special cases: coins get z=5 (just above bg), game shots get z=15.
 */
export function getLayerZOrder(role: string, label: string): number {
  const lowerLabel = label.toLowerCase();

  // Coins/gold piles — just above background
  if (lowerLabel.includes('coin') || lowerLabel.includes('gold pile')) {
    return 5;
  }

  // Game shots / screenshots — below character but above coins
  if (lowerLabel.includes('game') || lowerLabel.includes('screenshot') || lowerLabel.includes('slot') || lowerLabel.includes('reel') || lowerLabel.includes('tray')) {
    return 15;
  }

  // Ribbons — above game shots, below character
  if (lowerLabel.includes('ribbon') || lowerLabel.includes('badge') || lowerLabel.includes('new')) {
    return 30;
  }

  // Speech bubbles — near top
  if (lowerLabel.includes('speech') || lowerLabel.includes('bubble')) {
    return 55;
  }

  return ROLE_Z_ORDER[role] ?? 20;
}

/**
 * Check if a banner is a "wide strip" format.
 * Wide strips have width/height ratio > 4.
 */
export function isWideStrip(width: number, height: number): boolean {
  return width / height > 4;
}
