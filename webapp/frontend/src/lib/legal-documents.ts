// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

export type LegalDocumentKind = "license" | "notices";

/** Read an allowlisted legal text from the signed application bundle. */
export async function readBundledLegalDocument(
  document: LegalDocumentKind,
): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("read_legal_document", { document });
}
