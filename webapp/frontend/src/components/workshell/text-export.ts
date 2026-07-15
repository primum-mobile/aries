// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { exportTextFile as daemonExportTextFile } from "@/lib/daemon/client";
import { resolveShellHost } from "@/lib/shell-host";

type TextExportOptions = {
  filename: string;
  text: string;
  path?: string;
  mimeType?: string;
  extension?: string;
  title?: string;
  filters?: { name: string; extensions: string[] }[];
};

export function exportFileBaseName(title: string, fallback = "aries-export"): string {
  const raw = title.replace(/\s*\*$/, "").trim() || fallback;
  return raw.replace(/[\\/:*?"<>|]+/g, "_") || fallback;
}

export function ensureFilenameExtension(filename: string, extension: string): string {
  const cleanExtension = extension.replace(/^\./, "") || "txt";
  return filename.toLowerCase().endsWith(`.${cleanExtension.toLowerCase()}`)
    ? filename
    : `${filename}.${cleanExtension}`;
}

export async function exportTextContent({
  filename,
  text,
  path,
  mimeType = "text/plain;charset=utf-8",
  extension = "txt",
  title = "Export Text...",
  filters,
}: TextExportOptions): Promise<boolean> {
  const host = resolveShellHost();
  const defaultPath = ensureFilenameExtension(filename, extension);
  if (path) {
    await daemonExportTextFile({ path, text, extension });
    return true;
  }
  if (!host.capabilities.nativeFileDialogs) {
    await host.downloadBytes(defaultPath, new TextEncoder().encode(text), mimeType);
    return true;
  }
  const selectedPath = await host.selectSavePath({
    title,
    defaultPath,
    filters: filters ?? [{ name: `${extension.toUpperCase()} Files`, extensions: [extension] }],
  });
  if (!selectedPath) return false;
  await daemonExportTextFile({ path: selectedPath, text, extension });
  return true;
}
