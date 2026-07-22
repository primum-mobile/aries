import { daemonBaseUrl, daemonFetch } from "@/lib/daemon/client";

export type StyleLabFontAsset = {
  id: string;
  family: string;
  cssFamily?: string;
  subfamily?: string;
  role?: "text" | "symbols";
  axes?: Array<{
    tag: string;
    minimum: number;
    maximum: number;
    default: number;
    name?: string;
  }>;
};

export const STYLE_FONT_ASSETS_READY_EVENT = "aries-style-font-assets-ready";

const loadedFontAssets = new Map<string, Promise<string>>();

async function checked(response: Response): Promise<Response> {
  if (response.ok) return response;
  throw new Error((await response.text()).trim() || `Font request failed (${response.status})`);
}

export async function uploadStyleLabFont(
  file: File,
  options: { role: "text" | "symbols"; licenseNote: string },
): Promise<StyleLabFontAsset> {
  const query = new URLSearchParams({
    fileName: file.name,
    role: options.role,
    licenseNote: options.licenseNote,
  });
  const response = await checked(await daemonFetch(
    `${daemonBaseUrl()}/api/style-lab/fonts?${query.toString()}`,
    {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/octet-stream" },
      body: file,
    },
  ));
  return (await response.json()) as StyleLabFontAsset;
}

export async function listStyleLabFonts(signal?: AbortSignal): Promise<StyleLabFontAsset[]> {
  const response = await checked(await daemonFetch(
    `${daemonBaseUrl()}/api/style-lab/fonts`,
    { cache: "no-store", signal },
  ));
  const payload = (await response.json()) as { assets?: StyleLabFontAsset[] };
  return payload.assets ?? [];
}

export async function loadStyleLabFontFace(
  asset: StyleLabFontAsset,
  signal?: AbortSignal,
): Promise<string> {
  const existing = loadedFontAssets.get(asset.id);
  if (existing) return existing;
  const pending = (async () => {
  const response = await checked(await daemonFetch(
    `${daemonBaseUrl()}/api/style-lab/fonts/${encodeURIComponent(asset.id)}/file`,
    { cache: "no-store", signal },
  ));
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  try {
    const cssFamily = asset.cssFamily || `AriesFont_${asset.id.replace(/[^a-z0-9_]/gi, "_")}`;
    const face = new FontFace(cssFamily, `url(${JSON.stringify(url)})`);
    await face.load();
    document.fonts.add(face);
    return JSON.stringify(cssFamily);
  } finally {
    URL.revokeObjectURL(url);
  }
  })();
  loadedFontAssets.set(asset.id, pending);
  try {
    return await pending;
  } catch (error) {
    loadedFontAssets.delete(asset.id);
    throw error;
  }
}

export async function loadStoredStyleLabFonts(signal?: AbortSignal): Promise<void> {
  const assets = await listStyleLabFonts(signal);
  await Promise.all(assets.map((asset) => loadStyleLabFontFace(asset, signal)));
}
