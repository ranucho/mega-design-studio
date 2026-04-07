import { BannerComposition } from '@/types';

/**
 * Render a BannerComposition to a data URL via offscreen canvas.
 * Used for both export and for sending reference images to AI.
 */
export const renderCompositionToDataUrl = async (
  comp: BannerComposition,
  maxDimension = 1024,
): Promise<string> => {
  // Scale down very large canvases for AI reference use
  const scale = Math.min(1, maxDimension / Math.max(comp.width, comp.height));
  const w = Math.round(comp.width * scale);
  const h = Math.round(comp.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // Background
  ctx.fillStyle = comp.backgroundColor || '#000';
  ctx.fillRect(0, 0, w, h);

  // Preload all images
  const imageMap = new Map<string, HTMLImageElement>();
  await Promise.all(
    comp.layers
      .filter(l => l.type === 'image' && l.src)
      .map(
        l =>
          new Promise<void>(resolve => {
            const img = new Image();
            img.onload = () => {
              imageMap.set(l.id, img);
              resolve();
            };
            img.onerror = () => resolve();
            img.src = l.src!;
          }),
      ),
  );

  for (const layer of comp.layers) {
    if (!layer.visible) continue;

    ctx.save();
    ctx.globalAlpha = layer.opacity;

    const x = layer.x * scale;
    const y = layer.y * scale;
    const dw = layer.nativeWidth * layer.scaleX * scale;
    const dh = layer.nativeHeight * layer.scaleY * scale;
    const cx = x + dw / 2;
    const cy = y + dh / 2;

    ctx.translate(cx, cy);
    if (layer.rotation) ctx.rotate((layer.rotation * Math.PI) / 180);
    if (layer.flipX) ctx.scale(-1, 1);
    if (layer.flipY) ctx.scale(1, -1);
    ctx.translate(-cx, -cy);

    if (layer.type === 'text') {
      const fontSize = (layer.fontSize || 24) * scale;
      ctx.font = `${layer.fontWeight || 700} ${fontSize}px ${layer.fontFamily || 'sans-serif'}`;
      ctx.textAlign = (layer.textAlign || 'left') as CanvasTextAlign;
      ctx.textBaseline = 'top';
      if (layer.textStroke) {
        ctx.strokeStyle = layer.textStroke;
        ctx.lineWidth = Math.max(1, fontSize / 12);
        ctx.strokeText(layer.text || '', x, y);
      }
      ctx.fillStyle = layer.fontColor || '#ffffff';
      ctx.fillText(layer.text || '', x, y);
    } else if (layer.type === 'image' && layer.src) {
      const img = imageMap.get(layer.id);
      if (img) ctx.drawImage(img, x, y, dw, dh);
    }

    ctx.restore();
  }

  return canvas.toDataURL('image/png');
};
