import type { SlotSkin, BannerSkin } from '@/types/shared';

export async function fetchAllSlotSkinsFromFiles(): Promise<SlotSkin[]> {
  const res = await fetch('/api/skins/slots');
  if (!res.ok) throw new Error(`Failed to fetch slot skins: ${res.status}`);
  return res.json();
}

export async function fetchAllBannerSkinsFromFiles(): Promise<BannerSkin[]> {
  const res = await fetch('/api/skins/banners');
  if (!res.ok) throw new Error(`Failed to fetch banner skins: ${res.status}`);
  return res.json();
}

export async function saveSlotSkinToFile(skin: SlotSkin): Promise<void> {
  const res = await fetch(`/api/skins/slots/${encodeURIComponent(skin.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(skin),
  });
  if (!res.ok) throw new Error(`Failed to save slot skin: ${res.status}`);
}

export async function saveBannerSkinToFile(skin: BannerSkin): Promise<void> {
  const res = await fetch(`/api/skins/banners/${encodeURIComponent(skin.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(skin),
  });
  if (!res.ok) throw new Error(`Failed to save banner skin: ${res.status}`);
}

export async function deleteSlotSkinFromFile(id: string): Promise<void> {
  const res = await fetch(`/api/skins/slots/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Failed to delete slot skin: ${res.status}`);
}

export async function deleteBannerSkinFromFile(id: string): Promise<void> {
  const res = await fetch(`/api/skins/banners/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Failed to delete banner skin: ${res.status}`);
}
