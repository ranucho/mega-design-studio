import { getAI, parseDataUrl, parseImageBase64, retryOperation, runWithRetry, createImageParts } from "./client";
import { Character, StoryScene, ReferenceAsset, ReelGridAnalysis, SymbolConsistencyMap } from "@/types";

// ---- Canonical slot symbol dimensions ----
// Regular symbol: 180 × 170 px.  X3 tall tile: 180 × 510 px (3 rows).
export const SYMBOL_WIDTH  = 180;
export const SYMBOL_HEIGHT = 170;
export const LONG_TILE_WIDTH  = 180;
export const LONG_TILE_HEIGHT = 510;   // 170 × 3

/**
 * Fit a data-URL image into exact pixel dimensions WITHOUT stretching.
 *
 * mode 'contain' — fits entirely inside, pads with bgColor (default for regular symbols).
 * mode 'cover'   — fills the entire canvas, crops overflow (default for long tiles).
 */
const resizeToExact = (
    dataUrl: string, w: number, h: number,
    bgColor = '#FFFFFF', mode: 'contain' | 'cover' = 'contain',
): Promise<string> =>
    new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            const ctx = c.getContext('2d')!;

            if (mode === 'cover') {
                const scale = Math.max(w / img.width, h / img.height);
                const dw = Math.round(img.width * scale);
                const dh = Math.round(img.height * scale);
                ctx.drawImage(img, Math.round((w - dw) / 2), Math.round((h - dh) / 2), dw, dh);
            } else {
                // Contain: fit inside, pad remaining space
                // If bgColor is empty, sample edge colours from the source image
                if (!bgColor) {
                    const tmp = document.createElement('canvas');
                    tmp.width = img.width; tmp.height = img.height;
                    const tCtx = tmp.getContext('2d')!;
                    tCtx.drawImage(img, 0, 0);
                    const edges = [
                        ...Array.from(tCtx.getImageData(0, 0, img.width, 1).data),
                        ...Array.from(tCtx.getImageData(0, img.height - 1, img.width, 1).data),
                        ...Array.from(tCtx.getImageData(0, 0, 1, img.height).data),
                        ...Array.from(tCtx.getImageData(img.width - 1, 0, 1, img.height).data),
                    ];
                    let r = 0, g = 0, b = 0, n = 0;
                    for (let i = 0; i < edges.length; i += 4) { r += edges[i]; g += edges[i+1]; b += edges[i+2]; n++; }
                    ctx.fillStyle = `rgb(${Math.round(r/n)},${Math.round(g/n)},${Math.round(b/n)})`;
                } else {
                    ctx.fillStyle = bgColor;
                }
                ctx.fillRect(0, 0, w, h);
                const scale = Math.min(w / img.width, h / img.height);
                const dw = Math.round(img.width * scale);
                const dh = Math.round(img.height * scale);
                ctx.drawImage(img, Math.round((w - dw) / 2), Math.round((h - dh) / 2), dw, dh);
            }
            resolve(c.toDataURL('image/png'));
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
    });

/**
 * Animatix variant: Generate character master blueprint from story context.
 * Uses model fallback chain: Pro → Flash.
 */
export const generateCharacterSheetFromStory = async (
  character: Character,
  style: string,
  inputImages?: string[]
): Promise<string> => {
  const ai = getAI();
  const parts: any[] = [];

  if (inputImages && inputImages.length > 0) {
    inputImages.forEach(img => {
      const m = img.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
    });
  }

  if ((character as any).type === 'background') {
    parts.push({
      text: `
      TECHNICAL PRODUCTION DIRECTIVE: CREATE AN ESTABLISHING SHOT / BACKGROUND PLATE.
      MEDIUM/STYLE: ${style}. (STRICT COMPLIANCE REQUIRED.)
      LOCATION IDENTITY:
      NAME: ${character.name}.
      DESCRIPTION: ${character.description}.
      LAYOUT REQUIREMENTS:
      - Generate ONE wide 16:9 establishing shot of this location.
      - NO CHARACTERS OR PEOPLE. This is a pure environment/background plate.
      - Focus on atmosphere, lighting, and spatial depth.
      STRICT CONSTRAINTS:
      - STYLE LOCK: Maintain a consistent "${style}" aesthetic.
      - NO HALLUCINATIONS: Only include elements described in the description.
    `
    });
  } else if ((character as any).type === 'object') {
    parts.push({
      text: `
      TECHNICAL PRODUCTION DIRECTIVE: CREATE AN OBJECT STUDY SHEET.
      MEDIUM/STYLE: ${style}. (STRICT COMPLIANCE REQUIRED.)
      OBJECT IDENTITY:
      NAME: ${character.name}.
      DESCRIPTION: ${character.description}.
      LAYOUT REQUIREMENTS:
      - Generate ONE single image showing a 3-view object study: [ISOMETRIC VIEW], [FRONT VIEW], [SIDE VIEW].
      - Use a clean, plain white background.
      STRICT CONSTRAINTS:
      - CONSISTENCY: The object must be identical in all 3 views.
      - STYLE LOCK: Maintain a consistent "${style}" aesthetic throughout the entire image.
      - NO HALLUCINATIONS: Only include details described in the description.
    `
    });
  } else {
    parts.push({
      text: `
      TECHNICAL PRODUCTION DIRECTIVE: CREATE A CHARACTER MASTER SHEET.
      MEDIUM/STYLE: ${style}. (STRICT COMPLIANCE REQUIRED. If style is illustrated, do not make it realistic. If realistic, do not make it illustrated.)
      CHARACTER IDENTITY:
      NAME: ${character.name}.
      DESCRIPTION: ${character.description}.
      LAYOUT REQUIREMENTS:
      - Generate ONE single image showing a 3-view character turnaround: [FRONT VIEW], [SIDE PROFILE], [CLOSE-UP FACE].
      - Use a clean, plain white background.
      STRICT CONSISTENCY & NEGATIVE CONSTRAINTS:
      - 1:1 IDENTITY LOCK: The character's face, hair, and build must be identical in all 3 views.
      - OUTFIT LOCK: The character MUST wear the exact same clothing in all 3 views.
      - NO HALLUCINATIONS: DO NOT add glasses, beards, hats, or jewelry unless they are explicitly in the text description.
      - STYLE LOCK: Maintain a consistent "${style}" aesthetic throughout the entire image.
    `
    });
  }

  const generate = async (model: string) => {
    const res = await ai.models.generateContent({
      model,
      contents: { parts },
      config: { imageConfig: { aspectRatio: "1:1", imageSize: "1K" } }
    });
    const p = res.candidates?.[0]?.content?.parts;
    if (p) {
      for (const part of p) {
        if (part.inlineData?.data) return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    }
    throw new Error("No image returned");
  };

  try {
    return await runWithRetry(() => generate("gemini-3.1-flash-image-preview"), 0);
  } catch {
    return await runWithRetry(() => generate("gemini-2.5-flash-image"), 1);
  }
};

/**
 * Video Extractor variant: Generate character reference sheet from image references.
 */
export const generateCharacterSheetFromReferences = async (referenceDataUrls: string[]): Promise<string> => {
  const ai = getAI();
  const parts: any[] = createImageParts(referenceDataUrls);

  parts.push({
    text: `
    TASK: Generate a "Concept Art Reference Sheet" based on the provided reference images.
    [CRITICAL STYLE INSTRUCTION]
    - YOU MUST ANALYZE THE ART STYLE OF THE INPUT IMAGES FIRST.
    - IF THE INPUT IS PHOTOREALISTIC, THE OUTPUT MUST BE PHOTOREALISTIC.
    - IF THE INPUT IS 3D RENDERED, THE OUTPUT MUST BE 3D RENDERED.
    - IF THE INPUT IS A DRAWING/ILLUSTRATION, THE OUTPUT MUST BE A DRAWING/ILLUSTRATION.
    - DO NOT CHANGE THE MEDIUM. PRESERVE THE TEXTURE AND RENDERING STYLE EXACTLY.
    [CRITICAL ANATOMY RULES - READ CAREFULLY]
    1. IF THE SUBJECT IS AN ANIMAL: Draw it standing on FOUR LEGS (Quadrupedal). DO NOT ANTHROPOMORPHIZE. Keep biologically accurate.
    2. IF THE SUBJECT IS A HUMAN: Use a standard Standing A-Pose.
    3. VIEW ANGLES: Include a Front view, Side view, and 3/4 view.
    4. STYLE: Neutral white background. Flat, even lighting. Static pose. This sheet is for texture reference only.
    OUTPUT: A single high-quality character sheet in the EXACT SAME STYLE as the reference.
    `
  });

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-image-preview',
    contents: { parts },
    config: { imageConfig: { aspectRatio: '16:9', imageSize: "1K" } }
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }
  throw new Error("Character sheet generation failed.");
};

/** Generate a scene image using character blueprints as anchors (Animatix) */
export const generateSceneImage = async (
  scene: StoryScene,
  style: string,
  characters: Character[],
  aspectRatio: string = "16:9"
): Promise<string> => {
  const ai = getAI();
  const parts: any[] = [];

  parts.push({
    text: `
    SCENE PRODUCTION DIRECTIVE.
    LOCKED STYLE: ${style}.
    CRITICAL: You are forbidden from using any other style.
  `
  });

  characters.forEach((c) => {
    const blueprint = c.masterBlueprint;
    if (blueprint) {
      const m = blueprint.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (m) {
        if (c.type === 'object') {
          parts.push({ text: `OBJECT REFERENCE IMAGE FOR "${c.name}":` });
          parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
          parts.push({ text: `OBJECT INCLUSION RULE: This object "${c.name}" (${c.description}) MUST appear in the scene if it is mentioned or implied in the scene description. Match its EXACT visual design, colors, shape, and proportions from this reference sheet. Place it naturally within the scene composition.` });
        } else if (c.type === 'background') {
          parts.push({ text: `ENVIRONMENT REFERENCE FOR "${c.name}":` });
          parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
          parts.push({ text: `ENVIRONMENT LOCK: Use this as the base environment/setting. Match the atmosphere, lighting, color palette, and spatial design from this reference.` });
        } else {
          parts.push({ text: `ACTOR SOURCE IMAGE FOR ${c.name}:` });
          parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
          parts.push({ text: `IDENTITY LOCK: Extract the character from the center of this blueprint. They must wear the EXACT same clothing and have the EXACT same facial features.` });
        }
      }
    }
  });

  // Build entity checklist based on what's defined
  const entityChecklist: string[] = [];
  entityChecklist.push(`1. Is the style 100% "${style}"?`);
  characters.forEach(c => {
    if (c.type === 'character' && c.masterBlueprint) {
      entityChecklist.push(`- CHARACTER "${c.name}": Is their clothing a 1:1 match to the provided BLUEPRINT? Are there added accessories NOT in the blueprint? Is the identity consistent?`);
    } else if (c.type === 'object' && c.masterBlueprint) {
      entityChecklist.push(`- OBJECT "${c.name}" (${c.description}): Does this object appear in the scene? Does it match the reference design exactly?`);
    } else if (c.type === 'background' && c.masterBlueprint) {
      entityChecklist.push(`- ENVIRONMENT "${c.name}": Does the setting match the environment reference?`);
    }
  });

  parts.push({
    text: `
    SCENE ACTION: ${scene.visual_prompt}.
    CINEMATOGRAPHY: ${scene.camera_angle}.
    ENTITIES IN THIS SCENE: ${characters.map(c => `${c.name} (${c.type})`).join(', ')}.
    FINAL PRODUCTION CHECKLIST:
    ${entityChecklist.join('\n    ')}
    CRITICAL: ALL defined entities with reference images MUST appear in the scene unless the scene description explicitly excludes them.
  `
  });

  const generate = async (model: string) => {
    const response = await ai.models.generateContent({
      model,
      contents: { parts },
      config: { imageConfig: { aspectRatio, imageSize: model.includes('pro') ? '1K' : undefined } }
    });
    const p = response.candidates?.[0]?.content?.parts;
    if (p) {
      for (const part of p) {
        if (part.inlineData?.data) return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    }
    throw new Error("Scene generation failed");
  };

  try {
    return await runWithRetry(() => generate("gemini-3.1-flash-image-preview"), 0);
  } catch {
    return await runWithRetry(() => generate("gemini-2.5-flash-image"), 1);
  }
};

/** Edit a scene image with in-painting (Animatix) */
export const editSceneImage = async (
  imageBase64: string,
  editPrompt: string,
  style: string,
  aspectRatio: string = "16:9"
): Promise<string> => {
  const ai = getAI();
  const { mimeType, data } = parseImageBase64(imageBase64);

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: {
      parts: [
        { inlineData: { mimeType, data } },
        { text: `Style: ${style}. Maintain absolute character identity. Action: ${editPrompt}` }
      ]
    },
    config: { imageConfig: { aspectRatio } }
  });

  const p = response.candidates?.[0]?.content?.parts;
  if (p) {
    for (const part of p) {
      if (part.inlineData?.data) return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
    }
  }
  throw new Error("Fix failed");
};

/** Clean UI overlays from a frame (Video Extractor) */
export const cleanImage = async (
  dataUrl: string,
  aspectRatio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' = '16:9'
): Promise<string> => {
  return retryOperation(async () => {
    const ai = getAI();
    const { mimeType, data } = parseDataUrl(dataUrl);

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: {
        parts: [
          { inlineData: { data, mimeType } },
          { text: "Identify and remove all UI overlays including: social media icons (likes, comments, shares), usernames, descriptions, iPhone status bars (time, battery, signal), notches, and navigation bars. Reconstruct the image content behind these elements perfectly. Provide only the cleaned image." }
        ]
      },
      config: { imageConfig: { imageSize: '1K', aspectRatio } }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    throw new Error("Cleaning failed.");
  });
};

/** Modify/reskin an image with reference assets (Video Extractor) */
export const modifyImage = async (
  dataUrl: string,
  prompt: string,
  aspectRatio: string,
  referenceAssets: ReferenceAsset[] = [],
  editMode: boolean = false,
  gridMetadata?: ReelGridAnalysis | null,
  symbolConsistencyMap?: SymbolConsistencyMap[]
): Promise<string> => {
  return retryOperation(async () => {
    const ai = getAI();
    const parts: any[] = [];
    const sourceObj = parseDataUrl(dataUrl);

    let textInstruction = "";

    if (editMode) {
      textInstruction = `
        TASK: Professional Image Editing / In-Painting.
        USER INSTRUCTION: "${prompt}"
        [STRICT EDITING RULES]
        1. IDENTIFY THE SUBJECT: Analyze the user instruction to find exactly what needs to change.
        2. FREEZE EVERYTHING ELSE: Everything not targeted must remain PIXEL-PERFECT identical.
        3. NO HALLUCINATIONS: Do not add random characters, animals, or objects unless explicitly asked.
        4. STYLE PRESERVATION: Keep the original art style, lighting, and camera angle.
        [INPUTS]
        Image 1: SOURCE IMAGE TO EDIT.
      `;
      if (referenceAssets.length > 0) {
        textInstruction += `\n[OPTIONAL STYLE REFERENCES]\nUse these images ONLY if the user instruction asks to apply their specific style.\n`;
      }
    } else {
      let referenceContext = "";
      if (referenceAssets.length > 0) {
        referenceContext = "\n[REFERENCE ASSET KIT]\n";
        referenceAssets.forEach((asset, i) => {
          const label = asset.name ? `"${asset.name}"` : `Asset ${i + 1}`;
          let behavior = "";
          if (asset.type === 'character_primary') {
            behavior = `PRIMARY CHARACTER SHEET: This is the master identity reference. Use this character's EXACT face, hair, clothing, proportions and colors for ANY human/character figure visible in Image 1. Match their identity precisely — do NOT invent new characters. If NO character/person appears in the source frame, do NOT add one.`;
          } else if (asset.type.includes('character')) {
            behavior = `CHARACTER REFERENCE: Apply this character's visual identity ONLY where a character/person already exists in the source frame. Match exact face features, hair style, clothing from this reference.`;
          } else if (asset.type === 'long_game_tile') {
            behavior = `TILE/SYMBOL REFERENCE: Apply this visual style ONLY to tall/vertical rectangular elements visible in Image 1. Preserve the exact position, size and shape of each element.`;
          } else if (asset.type === 'background') {
            behavior = `BACKGROUND REFERENCE: Apply this environment/background style. Only modify the background areas — preserve all foreground elements exactly.`;
          } else {
            behavior = `STYLE REFERENCE: Use as visual style guide for matching art direction, colors, and rendering quality.`;
          }
          if (asset.name) behavior += ` When user mentions "${asset.name}", this is the asset being referenced.`;
          referenceContext += `Image ${i + 2} — ${label}: ${behavior}\n`;
        });
      }

      textInstruction = `
        [TASK]: RESKIN / RE-STYLE Image 1 using the Reference Assets (Images 2+) while preserving EXACT layout.

        [CRITICAL — PIXEL-PERFECT LAYOUT RULES]
        1. EXACT GEOMETRY: The output image must have the IDENTICAL composition as Image 1:
           - Every element must remain at the SAME position (x,y coordinates)
           - Every element must maintain the SAME size (width, height) as in Image 1
           - All spacing, margins, padding between elements must be IDENTICAL
        2. ASPECT RATIO LOCK: The overall image dimensions and proportions must be exactly preserved.
        3. GRID/REEL STRUCTURE: If Image 1 contains a grid of symbols (like slot reels):
           - Count the exact number of rows and columns in Image 1
           - Each cell MUST remain the same size and position
           - Symbol content is reskinned but cell boundaries stay fixed
        4. FOREGROUND/BACKGROUND SEPARATION: Do NOT merge foreground elements into the background or vice versa.

        [CHARACTER IDENTITY RULES]
        1. If a human/character figure exists in Image 1, replace ONLY with the character from the Primary Character Sheet reference
        2. MATCH the character's EXACT: face shape, eye color, hair style/color, skin tone, clothing from the reference
        3. PRESERVE the character's EXACT: pose, posture, body angle, expression, gesture, and position from Image 1
        4. Do NOT add characters where none exist in Image 1
        5. Do NOT create multiple characters if only one exists in Image 1

        [ANTI-HALLUCINATION RULES]
        1. MOTION BLUR = KEEP AS BLUR. Do not interpret blurred areas as objects. Render them as motion lines or empty background.
        2. UNDEFINED SHAPES = LEAVE EMPTY. If a shape is unclear or ambiguous, leave it empty or use simple background fill.
        3. NO INVENTION: Do NOT add objects, characters, text, or decorations that don't exist in Image 1.
        4. EMPTY SPACE = STAYS EMPTY. Background areas without content remain as styled background.
        ${gridMetadata?.isReelContent ? `
        [STRUCTURAL GRID DATA — MANDATORY CONSTRAINTS]
        This source image contains a slot machine reel grid. You MUST reproduce this EXACT structure:
        - GRID DIMENSIONS: ${gridMetadata.rows} rows × ${gridMetadata.cols} columns (${gridMetadata.rows * gridMetadata.cols} cells total)
        - DO NOT change the number of rows or columns. The output MUST have exactly ${gridMetadata.rows} rows and ${gridMetadata.cols} columns.
        - CELL-BY-CELL SYMBOL MAP (row, col → symbol):
        ${gridMetadata.symbols.map(s => `  Row ${s.row}, Col ${s.col}: "${s.description}"`).join('\n        ')}
        - CABINET/FRAME: ${gridMetadata.cabinetDescription}
        - LAYOUT NOTES: ${gridMetadata.gridLayoutNotes}
        - Each symbol cell must maintain its EXACT position, size, and spacing from the source.
        - The cabinet/frame surrounding the grid must maintain its exact shape and proportions.
        ` : ''}${symbolConsistencyMap && symbolConsistencyMap.length > 0 ? `
        [SYMBOL CONSISTENCY MAP — MANDATORY]
        The following mapping defines how each original symbol type must be rendered in the new style.
        You MUST use these exact mappings — do NOT invent new symbol designs:
        ${symbolConsistencyMap.map(m => `  "${m.originalDescription}" → "${m.reskinDescription}"`).join('\n        ')}
        Every instance of the same original symbol MUST map to the SAME new design listed above.
        ` : ''}${referenceContext}
        [USER STYLE INSTRUCTION]
        ${prompt}

        [INPUTS]
        Image 1: SOURCE FRAME — This defines the EXACT layout. Copy its structure PIXEL-FOR-PIXEL, only changing visual style/skin.
      `;
    }

    parts.push({ text: textInstruction });
    parts.push({ inlineData: { data: sourceObj.data, mimeType: sourceObj.mimeType } });

    referenceAssets.forEach((asset) => {
      const refObj = parseDataUrl(asset.url);
      parts.push({ inlineData: { data: refObj.data, mimeType: refObj.mimeType } });
    });

    const safetySettings = [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
    ];

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: { parts },
      config: {
        imageConfig: { aspectRatio: aspectRatio as any, imageSize: "1K" },
        safetySettings: safetySettings as any
      }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }

    const candidate = response.candidates?.[0];
    if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
      throw new Error(`reason: ${candidate.finishReason}`);
    }
    throw new Error("No image returned by Pro model.");
  });
};

/** Generate isolated asset from crop (Video Extractor - TheLab) */
export const generateFromCrop = async (
  cropDataUrl: string,
  prompt: string,
  aspectRatio: '1:1' | '3:4' | '4:3' | '9:16' | '16:9' = '1:1'
): Promise<string> => {
  return retryOperation(async () => {
    const ai = getAI();
    const { mimeType, data } = parseDataUrl(cropDataUrl);

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: {
        parts: [
          { inlineData: { data, mimeType } },
          { text: `Redesign this specific graphic asset based on the instruction: "${prompt}". Output a high-quality, isolated game asset. Maintain the composition but improve fidelity.` }
        ]
      },
      config: { imageConfig: { aspectRatio, imageSize: "1K" } }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }

    const candidate = response.candidates?.[0];
    if (candidate?.finishReason === 'OTHER' || candidate?.finishReason === 'SAFETY') {
      throw new Error("Pro model blocked.");
    }
    throw new Error(`Model returned no image. Finish reason: ${candidate?.finishReason}`);
  });
};

/** Generate slot machine symbol sheet + frame (Video Extractor - SlotMachineStudio) */
export const generateSlotGridReskin = async (
  gridDataUrl: string,
  prompt: string,
  rows: number,
  cols: number
): Promise<{ symbols: string; frame: string }> => {
  return retryOperation(async () => {
    const ai = getAI();
    const { mimeType, data } = parseDataUrl(gridDataUrl);
    const imagePart = { inlineData: { data, mimeType } };

    const symbolPrompt = `
      TASK: Create a Game Asset Style Sheet by reskinning the provided Slot Machine Grid.
      INPUT CONTEXT: The image provided is a ${rows}x${cols} grid of slot machine symbols.
      DESIGN GOAL: ${prompt}
      CRITICAL RULES:
      1. Analyze the unique symbols in the input grid.
      2. Redesign EACH symbol found in the grid to match the "Design Goal".
      3. NO SOURCE PIXELS: Completely redraw every pixel.
      4. BACKGROUNDS: Symbols on SOLID BLACK BACKGROUND (#000000) for chroma keying.
      5. OUTPUT A CLEAN SHEET where the symbols are separated.
      6. Group Low Pays and High Pays.
      OUTPUT: High-quality sprite sheet of symbols on SOLID BLACK background.
    `;

    const framePrompt = `
      TASK: Create the "Slot Machine Interface Frame" and "Jackpot Headers" only.
      INPUT CONTEXT: The image provided is a ${rows}x${cols} grid.
      DESIGN GOAL: ${prompt}
      CRITICAL RULES:
      1. Generate the empty container/cabinet frame that holds the reels.
      2. Include the Jackpot Displays/Counters area above the reels if present.
      3. EMPTY REELS: The actual grid cells must be EMPTY.
      4. NO OLD ASSETS: Do NOT retain any characters, symbols, or text from the source.
      5. Focus on borders, metallic/wood/digital texture, and grid dividers.
      OUTPUT: High-quality empty slot machine frame/interface.
    `;

    const [symbolResponse, frameResponse] = await Promise.all([
      ai.models.generateContent({
        model: 'gemini-3.1-flash-image-preview',
        contents: { parts: [imagePart, { text: symbolPrompt }] },
        config: { imageConfig: { aspectRatio: '1:1', imageSize: "1K" } }
      }),
      ai.models.generateContent({
        model: 'gemini-3.1-flash-image-preview',
        contents: { parts: [imagePart, { text: framePrompt }] },
        config: { imageConfig: { aspectRatio: '1:1', imageSize: "1K" } }
      })
    ]);

    let symbols = "";
    let frame = "";
    for (const part of symbolResponse.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) symbols = `data:image/png;base64,${part.inlineData.data}`;
    }
    for (const part of frameResponse.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) frame = `data:image/png;base64,${part.inlineData.data}`;
    }

    if (!symbols || !frame) throw new Error("Slot asset generation failed to return both images.");
    return { symbols, frame };
  });
};

/** Isolate a game symbol on white background (Video Extractor - SymbolGenerator).
 *  Output is always resized to the canonical 180×170 px. */
export const isolateSymbol = async (image: string): Promise<string | null> => {
    const ai = getAI();
    const { mimeType, data } = parseDataUrl(image);

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-image-preview',
            contents: {
                parts: [
                    { inlineData: { mimeType, data } },
                    { text: `IMAGE PROCESSING TASK: Background Removal / Object Isolation.

INPUT: A crop containing a game symbol (letter, number, character, object, coin, jewel, etc.).
GOAL: Output the EXACT SAME symbol on a SOLID WHITE background RGB(255,255,255).

CRITICAL CONSTRAINTS:
1. BACKGROUND COLOR: Must be pure white #FFFFFF.
2. PRESERVE IDENTITY: Do not generate a new symbol. Maintain the original art style exactly.
3. CONSISTENCY: Output a 1:1 square. Center the symbol perfectly. Scale the symbol to occupy about 80% of the canvas width/height to ensure uniform sizing across all symbols.
4. COMPLETENESS — NEVER CUT OR CROP THE SYMBOL: The ENTIRE symbol must be fully visible. No edges, corners, curves, or parts may be cut off or cropped. If the symbol is circular (coin, medallion, orb), the full circle must be complete. If it has wings, flames, tails, or protruding elements, they must ALL be fully visible within the canvas.
5. SHAPE PRESERVATION: If the symbol is round/circular, it must remain a perfect complete circle — not clipped into a square. If it has a unique shape (star, diamond, hexagon), preserve the full shape outline.` }
                ]
            },
            config: {
                 imageConfig: { aspectRatio: '1:1' }
            }
        });

        for (const part of response.candidates?.[0]?.content?.parts || []) {
             if (part.inlineData) {
                 const raw = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                 return resizeToExact(raw, SYMBOL_WIDTH, SYMBOL_HEIGHT, '#FFFFFF');
             }
        }
        return null;
    } catch (e) {
        console.error("Isolation failed", e);
        return null;
    }
};

/** Clean up a long tile crop — AI generates clean version with perfect frame.
 *  Output is always resized to the canonical 180×510 px (3 rows).
 *
 *  Strategy:
 *  1. Pre-resize crop to exactly 180×510 (contain + edge-colour fill) so
 *     the frame proportions are already correct before AI sees it.
 *  2. Pad the 180×510 image to 9:16 (the closest tall API ratio) by adding
 *     edge-coloured bars on left/right. Record the tile width fraction.
 *  3. AI cleans/regenerates at 9:16 — only minor edge cleanup needed since
 *     proportions are already correct.
 *  4. Crop back using the stored fraction to remove padding.
 *  5. Final resize to 180×510.
 */
export const cleanLongTile = async (image: string): Promise<string | null> => {
    const ai = getAI();

    try {
        // Step 1: Pre-resize to canonical 180×510
        const presized = await resizeToExact(image, LONG_TILE_WIDTH, LONG_TILE_HEIGHT, '', 'contain');

        // Step 2: Pad to 9:16 — height stays 510, width becomes 510*(9/16) = ~287
        const padded = await new Promise<{ dataUrl: string; tileFraction: number }>((resolve) => {
            const img = new Image();
            img.onload = () => {
                const target916W = Math.round(img.height * (9 / 16));
                if (img.width >= target916W) {
                    resolve({ dataUrl: presized, tileFraction: 1 });
                    return;
                }
                const c = document.createElement('canvas');
                c.width = target916W;
                c.height = img.height;
                const ctx = c.getContext('2d')!;
                // Sample edge colour
                const tmp = document.createElement('canvas');
                tmp.width = img.width; tmp.height = img.height;
                const tCtx = tmp.getContext('2d')!;
                tCtx.drawImage(img, 0, 0);
                const left = tCtx.getImageData(0, 0, 1, img.height).data;
                const right = tCtx.getImageData(img.width - 1, 0, 1, img.height).data;
                let r = 0, g = 0, b = 0, n = 0;
                for (let i = 0; i < left.length; i += 4) { r += left[i]; g += left[i+1]; b += left[i+2]; n++; }
                for (let i = 0; i < right.length; i += 4) { r += right[i]; g += right[i+1]; b += right[i+2]; n++; }
                ctx.fillStyle = `rgb(${Math.round(r/n)},${Math.round(g/n)},${Math.round(b/n)})`;
                ctx.fillRect(0, 0, target916W, img.height);
                ctx.drawImage(img, Math.round((target916W - img.width) / 2), 0);
                resolve({ dataUrl: c.toDataURL('image/png'), tileFraction: img.width / target916W });
            };
            img.onerror = () => resolve({ dataUrl: presized, tileFraction: 1 });
            img.src = presized;
        });

        // Step 3: AI cleans at 9:16
        const { mimeType, data } = parseDataUrl(padded.dataUrl);
        const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-image-preview',
            contents: {
                parts: [
                    { inlineData: { mimeType, data } },
                    { text: `IMAGE PROCESSING TASK — TALL SLOT TILE CLEANUP

You are given a TALL game symbol tile (spans 3 rows) centred in this image with solid padding on left and right.

REQUIREMENTS:
1. Output a CLEAN version at 9:16 aspect ratio.
2. The tile must stay CENTRED — do not shift it.
3. FRAME: The tile has a decorative frame/border. It MUST have EQUAL thickness on all 4 sides — left = right, top = bottom. If the frame is uneven, FIX it to be perfectly symmetrical.
4. CHARACTER: Keep the character/figure EXACTLY as input — same proportions, no stretching.
5. Keep ALL decorative elements: gold ornaments, gradients, text, numbers.
6. DO NOT isolate on white — keep the tile's original background inside the frame.
7. The solid padding on the sides must stay as-is.
8. Clean up jagged edges and crop artifacts only.` }
                ]
            },
            config: { imageConfig: { aspectRatio: '9:16' } }
        });

        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) {
                const aiRaw = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                // Step 4: Crop back to remove padding
                const cropped = await new Promise<string>((resolve) => {
                    const aiImg = new Image();
                    aiImg.onload = () => {
                        const fraction = padded.tileFraction;
                        const cropW = Math.round(aiImg.width * fraction);
                        const cropX = Math.round((aiImg.width - cropW) / 2);
                        const cc = document.createElement('canvas');
                        cc.width = cropW;
                        cc.height = aiImg.height;
                        cc.getContext('2d')!.drawImage(aiImg, cropX, 0, cropW, aiImg.height, 0, 0, cropW, aiImg.height);
                        resolve(cc.toDataURL('image/png'));
                    };
                    aiImg.onerror = () => resolve(aiRaw);
                    aiImg.src = aiRaw;
                });
                // Step 5: Final resize to canonical 180×510
                return await resizeToExact(cropped, LONG_TILE_WIDTH, LONG_TILE_HEIGHT, '', 'contain');
            }
        }
        return null;
    } catch (e) {
        console.error("Long tile cleanup failed", e);
        return null;
    }
};

/**
 * Auto-trim white borders from a data-URL image, then re-expand to fill the target dimensions.
 * Scans for the bounding box of non-white pixels, crops to that box, then uses cover mode
 * to fill the target canvas. Guarantees zero dead/empty pixels around content.
 */
const autoTrimAndFill = (dataUrl: string, w: number, h: number): Promise<string> =>
    new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const tmp = document.createElement('canvas');
            tmp.width = img.width; tmp.height = img.height;
            const tCtx = tmp.getContext('2d')!;
            tCtx.drawImage(img, 0, 0);
            const id = tCtx.getImageData(0, 0, img.width, img.height);
            const d = id.data;

            // Find bounding box of non-white pixels (threshold: any channel < 245)
            let minX = img.width, minY = img.height, maxX = 0, maxY = 0;
            for (let y = 0; y < img.height; y++) {
                for (let x = 0; x < img.width; x++) {
                    const i = (y * img.width + x) * 4;
                    if (d[i] < 245 || d[i+1] < 245 || d[i+2] < 245) {
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
                }
            }

            // If no meaningful content found or trim is tiny, return as-is
            const bw = maxX - minX + 1;
            const bh = maxY - minY + 1;
            if (bw < 10 || bh < 10) { resolve(dataUrl); return; }

            // If already filling >95% of canvas, no trim needed
            if (bw > img.width * 0.95 && bh > img.height * 0.95) { resolve(dataUrl); return; }

            // Crop to bounding box
            const cropped = document.createElement('canvas');
            cropped.width = bw; cropped.height = bh;
            const cCtx = cropped.getContext('2d')!;
            cCtx.drawImage(img, minX, minY, bw, bh, 0, 0, bw, bh);

            // Re-expand to target dimensions using contain mode (never crop)
            const out = document.createElement('canvas');
            out.width = w; out.height = h;
            const oCtx = out.getContext('2d')!;
            oCtx.fillStyle = '#FFFFFF';
            oCtx.fillRect(0, 0, w, h);
            const scale = Math.min(w / bw, h / bh);
            const dw = Math.round(bw * scale);
            const dh = Math.round(bh * scale);
            oCtx.drawImage(cropped, Math.round((w - dw) / 2), Math.round((h - dh) / 2), dw, dh);
            resolve(out.toDataURL('image/png'));
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
    });

/** Isolate a symbol WITH its frame/border — keeps decorative frame elements, cleans edges */
export const isolateSymbolWithFrame = async (image: string): Promise<string | null> => {
    const ai = getAI();
    const { mimeType, data } = parseDataUrl(image);

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-image-preview',
            contents: {
                parts: [
                    { inlineData: { mimeType, data } },
                    { text: `IMAGE PROCESSING TASK: Clean a framed slot game symbol.

INPUT: A rough crop from a slot machine screenshot. The crop contains a game symbol inside a DECORATIVE FRAME (border, ornamental edges, glow, metallic rim, etc.).

GOAL: Output a CLEAN version of this EXACT framed symbol, filling the ENTIRE canvas edge-to-edge with the frame.

CRITICAL RULES — follow every single one:
1. FRAME FILLS THE CANVAS COMPLETELY: The frame's outer edges must touch ALL 4 sides of the output image. ZERO white space, ZERO margins, ZERO padding around the frame. Scale up so the frame fills everything edge to edge.
2. PRESERVE THE FRAME EXACTLY: Keep its exact style, thickness, colors, ornaments, and proportions. Do NOT redesign, simplify, thin out, redraw, or invent a new frame. The frame must look EXACTLY like the input — same thickness on all sides.
3. FRAME MUST BE COMPLETE: All 4 sides, all 4 corners must be fully visible. Nothing cropped or cut off.
4. SYMBOL INSIDE FRAME: The symbol artwork must be FULLY CONTAINED inside the frame. Nothing extends beyond the frame border.
5. NOTHING OUTSIDE THE FRAME: Remove all neighboring cell artifacts, reel strips, grid lines. The frame's outer edge IS the image edge.
6. PRESERVE IDENTITY: Keep the exact same symbol art, colors, and design. Do not redesign.
7. RECTANGULAR OUTPUT: The frame must be a clean rectangle filling the full canvas. Straighten if skewed.
8. OUTPUT: 1:1 square.` }
                ]
            },
            config: {
                imageConfig: { aspectRatio: '1:1' }
            }
        });

        for (const part of response.candidates?.[0]?.content?.parts || []) {
             if (part.inlineData) {
                 const raw = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                 // Frame should fill edge-to-edge — use cover to fill 180x170 completely
                 return resizeToExact(raw, SYMBOL_WIDTH, SYMBOL_HEIGHT, '#000000', 'cover');
             }
        }
        return null;
    } catch (e) {
        console.error("Symbol with frame isolation failed", e);
        return null;
    }
};

/** Extract empty reels frame from a slot machine screenshot (Video Extractor - SymbolGenerator)
 *  Returns result resized to match the exact pixel dimensions of the input image
 *  to guarantee no stretching/distortion.
 */
export const extractReelsFrame = async (image: string): Promise<string | null> => {
    const ai = getAI();
    const { mimeType, data } = parseDataUrl(image);

    // Measure the input image dimensions so we can force the output to match
    const inputDims = await new Promise<{w: number; h: number}>((resolve) => {
        if (typeof window !== 'undefined' && typeof Image !== 'undefined') {
            const img = new Image();
            img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
            img.onerror = () => resolve({ w: 0, h: 0 });
            img.src = image;
        } else {
            resolve({ w: 0, h: 0 });
        }
    });

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-image-preview',
            contents: {
                parts: [
                    { inlineData: { mimeType, data } },
                    { text: `TASK: Erase every slot machine symbol and icon from this image. The output must contain ZERO symbols, ZERO icons, ZERO game objects.

ABSOLUTE RULE: No slot machine symbols or icons may appear in the output image. Not even partially. Not even faintly. Every symbol — letters (A, K, Q, J, 10, 9), characters, animals, gems, coins, fruits, wilds, scatters, bonus icons, ANY game icon of any kind — must be completely erased and painted over.

WHAT TO DO:
1. Find every symbol/icon inside the reel grid area.
2. Erase each one completely — replace it with the smooth background colour behind it.
3. Also erase: grid lines, cell dividers, row separators, glows, halos, shadows of symbols.
4. The reel area must be a smooth, clean, empty surface with no objects on it.

WHAT TO KEEP: Only the outer decorative frame/border around the reel area.

CRITICAL CONSTRAINTS:
- Output MUST have EXACT same dimensions, proportions, and framing as input — no crop, zoom, or shift.
- Fill erased areas with the dominant background colour sampled from behind the symbols.
- If you are unsure whether something is a symbol — erase it.

FINAL CHECK: Scan every pixel of the output. If ANY recognizable shape, icon, letter, circle, or object remains inside the reel area, you have failed. Remove it.` }
                ]
            },
            config: {
                 imageConfig: { }
            }
        });

        for (const part of response.candidates?.[0]?.content?.parts || []) {
             if (part.inlineData) {
                 const aiResult = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;

                 // Resize AI output to match input dimensions exactly (prevents stretching)
                 if (inputDims.w > 0 && inputDims.h > 0 && typeof document !== 'undefined') {
                     try {
                         const aiImg = await new Promise<HTMLImageElement>((resolve) => {
                             const img = new Image();
                             img.onload = () => resolve(img);
                             img.onerror = () => resolve(img);
                             img.src = aiResult;
                         });
                         if (aiImg.naturalWidth > 0 && aiImg.naturalHeight > 0) {
                             const canvas = document.createElement('canvas');
                             canvas.width = inputDims.w;
                             canvas.height = inputDims.h;
                             const ctx = canvas.getContext('2d');
                             if (ctx) {
                                 ctx.drawImage(aiImg, 0, 0, inputDims.w, inputDims.h);
                                 return canvas.toDataURL('image/png');
                             }
                         }
                     } catch { /* fall through to raw AI result */ }
                 }
                 return aiResult;
             }
        }
        return null;
    } catch (e) {
        console.error("Reel frame extraction failed", e);
        return null;
    }
};

/**
 * Clean a reels frame using the original clean frame as a reference.
 * Sends both images so the AI knows exactly what "clean" looks like.
 */
export const cleanReelsFrameWithReference = async (
  dirtyImage: string,
  cleanReference: string
): Promise<string | null> => {
  const ai = getAI();
  const dirty = parseDataUrl(dirtyImage);
  const clean = parseDataUrl(cleanReference);

  const inputDims = await new Promise<{ w: number; h: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = dirtyImage;
  });

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: {
        parts: [
          { inlineData: { mimeType: clean.mimeType, data: clean.data } },
          { inlineData: { mimeType: dirty.mimeType, data: dirty.data } },
          { text: `TASK: Two images provided. Erase every slot machine symbol and icon from IMAGE 2. The output must contain ZERO symbols, ZERO icons, ZERO game objects.

IMAGE 1 = REFERENCE showing what a CLEAN result looks like (no symbols, perfectly empty reel area).
IMAGE 2 = The image you must CLEAN. It has the same layout but a different theme/skin, and it still has symbols that must be removed.

ABSOLUTE RULE: No slot machine symbols or icons may appear in the output. Not even partially. Not faintly. Every symbol — letters (A, K, Q, J, 10, 9), characters, animals, gems, coins, fruits, wilds, scatters, bonus icons, ANY game icon — must be completely erased and painted over with smooth background.

WHAT TO DO:
1. Look at IMAGE 1 to understand where the reel area is and what "clean" looks like.
2. In IMAGE 2, find every symbol/icon inside that same reel area.
3. Erase each one completely — replace with the smooth background colour of IMAGE 2.
4. Also erase: grid lines, cell dividers, glows, halos, shadows of symbols.

OUTPUT RULES:
- Use IMAGE 2's colours and theme — NOT IMAGE 1's colours.
- Keep IMAGE 2's exact dimensions and framing — no crop, zoom, or shift.
- Keep only the outer decorative frame/border.
- The reel area must be as smooth and empty as IMAGE 1.
- If unsure whether something is a symbol — erase it.

FINAL CHECK: If ANY recognizable shape, icon, letter, circle, or object remains inside the reel area, you have failed. Remove it.` }
        ]
      },
      config: { imageConfig: {} }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        const aiResult = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        if (inputDims.w > 0 && inputDims.h > 0) {
          try {
            const aiImg = await new Promise<HTMLImageElement>((resolve) => {
              const img = new Image();
              img.onload = () => resolve(img);
              img.onerror = () => resolve(img);
              img.src = aiResult;
            });
            if (aiImg.naturalWidth > 0 && aiImg.naturalHeight > 0) {
              const canvas = document.createElement('canvas');
              canvas.width = inputDims.w;
              canvas.height = inputDims.h;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(aiImg, 0, 0, inputDims.w, inputDims.h);
                return canvas.toDataURL('image/png');
              }
            }
          } catch { /* fall through */ }
        }
        return aiResult;
      }
    }
    return null;
  } catch (e) {
    console.error('Reference-based frame cleaning failed', e);
    return null;
  }
};

/** Generate a background image from a prompt (Video Extractor - BackgroundStudio) */
export const generateBackgroundImage = async (
  prompt: string,
  aspectRatio: string = '16:9',
  referenceImage?: string
): Promise<string | null> => {
    const ai = getAI();
    const parts: any[] = [];

    if (referenceImage) {
        const { mimeType, data } = parseDataUrl(referenceImage);
        parts.push({ inlineData: { mimeType, data } });
    }

    if (referenceImage) {
        // When reskinning from a reference (e.g. full slot screen), preserve the full composition
        parts.push({
            text: `${prompt}

IMPORTANT COMPOSITION RULES:
- If the reference image contains a character or mascot figure (e.g. in the header/banner area above the reels), you MUST include a NEW character that fits the new theme in the SAME position, at the SAME scale and pose. Do NOT replace characters with landscapes or scenery — replace them with a re-themed CHARACTER.
- BRAND LOGO PROTECTION: If there is a logo in the top corner of the image (e.g. a company or brand logo like "Club Vegas"), it MUST be kept EXACTLY as-is — same design, same text, same colors, same position. Do NOT rename, retheme, or replace brand logos. They are sacred and untouchable.
- Maintain the exact same composition, layout, and element placement as the reference image.`
        });
    } else {
        parts.push({
            text: `Generate a high-quality game background image. ${prompt}. The image should be suitable for use as a slot game or video game background. No UI elements, no text, no characters.`
        });
    }

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-image-preview',
            contents: { parts },
            config: {
                imageConfig: { aspectRatio: aspectRatio as any }
            }
        });

        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) {
                return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
            }
        }
        return null;
    } catch (e) {
        console.error("Background generation failed", e);
        return null;
    }
};
