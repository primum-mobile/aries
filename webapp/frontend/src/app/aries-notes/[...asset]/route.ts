// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const dynamic = "force-static";
export const dynamicParams = false;

const assets = new Map([
  ["index.html", "text/html; charset=utf-8"],
  ["assets/editor.css", "text/css; charset=utf-8"],
  ["assets/editor.js", "text/javascript; charset=utf-8"],
]);

export function generateStaticParams() {
  return [...assets.keys()].map((file) => ({ asset: file.split("/") }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ asset: string[] }> }) {
  const file = (await params).asset.join("/");
  const contentType = assets.get(file);
  if (!contentType) return new Response(null, { status: 404 });

  // The static export places the editor on the app's origin in Tauri and the browser.
  const content = await readFile(resolve(process.cwd(), "../../Res/notes", file), "utf8");
  return new Response(content, { headers: { "Content-Type": contentType } });
}
