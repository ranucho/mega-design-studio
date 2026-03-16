/** Convert a File to a base64 data URL */
export const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

/** Deduplicate images for export - returns map of unique images and references */
export const deduplicateImages = (images: string[]): { library: Map<string, string>; refs: string[] } => {
  const library = new Map<string, string>();
  const hashMap = new Map<string, string>();
  const refs: string[] = [];
  let counter = 0;

  for (const img of images) {
    const hash = img.substring(img.length - 40);
    if (hashMap.has(hash)) {
      refs.push(hashMap.get(hash)!);
    } else {
      const id = `img_${counter++}`;
      library.set(id, img);
      hashMap.set(hash, id);
      refs.push(id);
    }
  }

  return { library, refs };
};

/** Detect aspect ratio from video dimensions */
export const detectAspectRatio = (width: number, height: number): string => {
  const ratio = width / height;
  if (Math.abs(ratio - 16 / 9) < 0.1) return '16:9';
  if (Math.abs(ratio - 9 / 16) < 0.1) return '9:16';
  if (Math.abs(ratio - 1) < 0.1) return '1:1';
  if (Math.abs(ratio - 4 / 3) < 0.1) return '4:3';
  if (Math.abs(ratio - 3 / 4) < 0.1) return '3:4';
  return ratio > 1 ? '16:9' : '9:16';
};
