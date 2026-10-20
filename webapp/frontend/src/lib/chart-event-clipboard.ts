// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

const CLIPBOARD_MAGIC = "# ARIES_EVENT 1";

function normalizeClipboardText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

export function chartEventClipboardLooksValid(text: string): boolean {
  try {
    parseChartEventClipboard(text);
    return true;
  } catch {
    return false;
  }
}

export function parseChartEventClipboard(text: string): { name: string; nodes: unknown[]; tagNames?: string[]; notes?: string }[] {
  const raw = normalizeClipboardText(text);
  if (!raw.startsWith(CLIPBOARD_MAGIC)) {
    throw new Error("Not an Aries events clipboard");
  }
  const body = raw.slice(CLIPBOARD_MAGIC.length).replace(/^\n+/, "");
  if (!body) {
    throw new Error("Missing payload");
  }
  const data = JSON.parse(body) as { v?: number; events?: unknown };
  if (data?.v !== 1 || !Array.isArray(data.events) || data.events.length === 0) {
    throw new Error("Invalid events payload");
  }
  return data.events.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("Invalid event");
    }
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const nodes = record.nodes;
    if (!name || !Array.isArray(nodes) || nodes.length === 0) {
      throw new Error("Invalid event shape");
    }
    const out: { name: string; nodes: unknown[]; tagNames?: string[]; notes?: string } = { name, nodes };
    if (record.tagNames !== undefined) {
      if (!Array.isArray(record.tagNames)) {
        throw new Error("Invalid tagNames");
      }
      out.tagNames = record.tagNames.map(String);
    }
    if (record.notes !== undefined) {
      out.notes = String(record.notes ?? "");
    }
    return out;
  });
}
