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
LAYOUT RULES (follow these strictly):
1. REFERENCE THE SOURCE: Always look at the source banner positions. If elements are aligned in the source (e.g. CTA aligned with game shot), they should remain aligned in resizes.
2. CORNER RIBBONS — NEVER HIDDEN: If a "NEW" ribbon or any ribbon appears in a corner of the source image, it MUST be placed flush against that same corner in ALL resizes. No gap between ribbon and corner edge. CRITICAL: No other element may overlap or cover the ribbon — it must always be fully visible on top. Reduce the size of neighboring elements if needed to keep the ribbon unobstructed.
3. COMPANY LOGO — NEVER HIDDEN: The company/brand logo MUST always be fully visible in every size. No element may overlap, cover, or obscure the logo. If the logo is in a corner, keep it in that corner. Scale neighboring elements DOWN if they would overlap the logo. The logo is sacred — treat it as untouchable.
4. CTA PROMINENCE + MARGINS: The CTA button must always be clearly visible, never obscured by other elements. CRITICAL: The CTA must have at least 5% margin from ALL canvas edges — it must NEVER touch or nearly touch the border. On portrait/tall banners, the CTA sits in the lower third but NOT at the very bottom edge.
5. CHARACTER COMPLETENESS: On standard (non-strip) banners, the character should not be cropped. Show the full character.
6. COINS — GROUND LEVEL, NEVER FLOATING: Coin piles MUST be placed at the BOTTOM of the canvas, sitting on the ground. Their y position must place them in the bottom ~20% of the canvas height. Coins should NEVER float in the middle or upper area of the canvas. They are decorative background elements — keep them small (no more than ~25% of canvas width) and behind all foreground elements. Think of coins as scattered on the floor beneath the main composition.
7. CHARACTER FACE VISIBILITY — NEVER HIDDEN: A character's face must NEVER be hidden or covered by ANY other element (text, logo, CTA, decorations, speech bubbles, game shots, slot machines). The face is approximately the top 30% of the character element. Speech bubbles must be positioned ABOVE or BESIDE the character's head — never overlapping the face area. Other elements CAN overlap the character's body/torso/legs, but the FACE must remain 100% visible. If a speech bubble would cover the face, move it higher or to the side. This is non-negotiable.
8. CTA COUNT: Typically one CTA per design, but choice-based concepts may have 2 CTAs. Style/shape/color must match across CTAs within the same concept.
9. ELEMENT SIZING — NO OVERSIZED ELEMENTS: When adapting to a smaller canvas, scale elements DOWN proportionally. Do NOT let any single element (especially game shots or characters) take up more than ~50% of the canvas width or ~50% of the canvas height (except background). The character should be ~30-40% of canvas height on standard banners, ~25-35% on small banners. The logo should be ~10-15% of canvas width — NEVER oversized. Leave room for all elements to breathe. Elements should be sized relative to the canvas so the composition looks balanced, not cramped or oversized.
10. OVERLAP CONTROL: Elements should overlap minimally. If two foreground elements would overlap more than ~20% of either's area, reduce the size of the less important one. Priority order for space: Text > Character > Game Shot > CTA > Decorations > Logo. On portrait banners (768x1024, 1080x1350, etc.) elements must be stacked vertically with clear separation — do NOT pile elements on top of each other.
11. ALL ELEMENTS MUST FIT WITHIN CANVAS: Every element must be fully visible within the canvas boundaries. No element's visible content should extend beyond the canvas edges. If an element would be cropped, scale it DOWN or reposition it inward. The only exception is background (which uses cover-crop mode).
12. HEADLINE MUST NOT COVER RIBBONS: If there is a corner ribbon (e.g. "NEW"), the headline text must be positioned below or away from it — never overlapping. Reduce headline size or shift it down if it would conflict with the ribbon.
13. CHARACTER MUST NOT COVER SLOT MACHINE: The character should be positioned beside the slot machine, not in front of it. On square and landscape banners, character goes to the right of the slot. On portrait banners, character can be above or beside the slot. The slot/game screenshot must always be clearly visible.
`;

// ════════════════════════════════════════════════════════════════
// LAYOUT RULES — WIDE STRIP BANNERS
// ════════════════════════════════════════════════════════════════
export const LAYOUT_RULES_STRIP = `
STRIP BANNER LAYOUT (for 300x50, 320x50, 468x60, 728x90):
These banners follow a strict LEFT-TO-RIGHT structure. All elements are vertically centered.

LEFT-TO-RIGHT ORDER:
1. RIBBON (if present): Flush against TOP-LEFT corner, scaled to take most of the banner height. On these tiny sizes the ribbon is a key brand marker.
2. LOGO: Immediately to the RIGHT of the ribbon. Scaled to fit the strip height (~70-80% of height).
3. HEADLINE + CHARACTER CLOSEUP: In the CENTER area. The headline text is prominent and readable. The character is shown as a BUST/FACE CLOSEUP only — cropped from chest up. Character and headline can overlap slightly (character behind text).
4. SPEECH BUBBLE: ONLY on 728x90 (the largest strip). On 300x50, 320x50, 468x60 there is NO speech bubble — hide it (visible: false).
5. CTA: RIGHT edge. SHORT text version (e.g. "SPIN" not "SPIN NOW"). Vertically centered.

STRIP BANNER EXCLUSIONS (these elements are HIDDEN on ALL strip banners):
- Game shot / slot machine / screenshot → visible: false
- Coin piles → visible: false
- Decorations → visible: false
- Speech bubble → visible: false EXCEPT on 728x90

CRITICAL STRIP RULES:
- NO slot machine or game screenshot on ANY strip banner
- NO coins on strip banners
- Character is ALWAYS cropped to face/bust — never full body
- All elements vertically centered within the strip height
- Text must be readable at the small strip height — scale it to ~60-80% of banner height
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
