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
LAYER ORDER (bottom to top — this is MANDATORY):
1. Background — always the BOTTOM layer. Uses COVER mode (uniform scale, centered, may crop edges but NEVER stretched/distorted)
2. Coins/coin piles — one layer above background (if present)
3. Game shot / screenshot — above coins, below character
4. Decorations (ribbons, badges, sparkles) — mid layers
5. Character — high priority, always above game shots and decorations
6. Text/headlines — above character
7. Logo — near top
8. Speech bubbles — near top
9. CTA button — always the TOP layer, above everything

This order must be followed in every composition regardless of canvas size.
`;

// ════════════════════════════════════════════════════════════════
// LAYOUT RULES — GENERAL
// ════════════════════════════════════════════════════════════════
export const LAYOUT_RULES_GENERAL = `
LAYOUT RULES (follow these strictly):
1. REFERENCE THE SOURCE: Always look at the source banner positions. If elements are aligned in the source (e.g. CTA aligned with game shot), they should remain aligned in resizes.
2. CORNER RIBBONS: If a "NEW" ribbon or any ribbon appears in a top corner of the source image, it must be placed flush against that same corner in all resizes. No gap between ribbon and corner edge.
3. LOGO POSITION: If the logo appears in the top-right corner in the source, it must appear in the top-right corner in all resizes.
4. CTA PROMINENCE: The CTA button must always be clearly visible, never obscured by other elements.
5. CHARACTER COMPLETENESS: On standard (non-strip) banners, the character should not be cropped. Show the full character.
6. COINS IN BACKGROUND: Coin piles should be placed behind foreground elements, close to the background layer. They add visual richness but should not compete with the main message.
7. CHARACTER FACE VISIBILITY: A character's face must NEVER be hidden or covered by other assets (text, logo, CTA, decorations, speech bubbles). Position overlapping elements so the character's face remains fully visible. If necessary, move or resize other elements to avoid obscuring the face.
`;

// ════════════════════════════════════════════════════════════════
// LAYOUT RULES — WIDE STRIP BANNERS
// ════════════════════════════════════════════════════════════════
export const LAYOUT_RULES_STRIP = `
WIDE STRIP BANNER LAYOUT (for banners where width/height ratio > 4, e.g. 468x60, 728x90, 320x50):
The layout must follow this LEFT-TO-RIGHT structure:
1. LEFT EDGE: Ribbon (if present), flush against the left edge
2. NEXT TO RIBBON: Logo
3. CENTER: Main text/headline — should be centered in the available space
4. MID-RIGHT: Character (the character CAN be cropped on strip banners — this is OK)
5. RIGHT SIDE: CTA button

STRIP BANNER EXCEPTIONS:
- Game shot / screenshot is NOT needed on strip banners — hide it or scale it very small behind other elements
- Character CAN be cropped (shown from waist up or chest up) to fit the limited height
- All elements should be vertically centered within the strip height
- Text should be scaled to be readable at the small strip height
`;

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
