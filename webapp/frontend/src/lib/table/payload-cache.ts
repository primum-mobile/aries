// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { GenericTablePayload } from "@/lib/daemon/client";

const MAX_TABLE_PAYLOADS = 40;
const tablePayloadCache = new Map<string, GenericTablePayload>();
const retainedPayloadCache = new Map<string, unknown>();

function tablePayloadKey(tableId: string, documentId: string): string {
  return `${documentId}\u0000${tableId}`;
}

function retainedPayloadKey(namespace: string, key: string): string {
  return `${namespace}\u0000${key}`;
}

/**
 * Build one collision-safe identity for a retained list's semantic query
 * world. Presentation lenses (for example TAB hiding a comparison ring) must
 * be omitted unless they actually change the list query. Callers can then
 * return to an already visited world without discarding its rows or derived
 * detail.
 */
export function retainedListWorldKey(
  parts: readonly (string | number | boolean | null | undefined)[],
): string {
  return JSON.stringify(parts.map((part) => part ?? null));
}

export function getCachedGenericTablePayload(
  tableId: string,
  documentId: string,
): GenericTablePayload | null {
  return tablePayloadCache.get(tablePayloadKey(tableId, documentId)) ?? null;
}

export function rememberGenericTablePayload(
  tableId: string,
  documentId: string,
  payload: GenericTablePayload,
): void {
  const key = tablePayloadKey(tableId, documentId);
  if (tablePayloadCache.has(key)) {
    tablePayloadCache.delete(key);
  }
  tablePayloadCache.set(key, payload);
  while (tablePayloadCache.size > MAX_TABLE_PAYLOADS) {
    const oldest = tablePayloadCache.keys().next().value as string | undefined;
    if (!oldest) break;
    tablePayloadCache.delete(oldest);
  }
}

export function getCachedListPayload<T>(namespace: string, key: string): T | null {
  return (retainedPayloadCache.get(retainedPayloadKey(namespace, key)) as T | undefined) ?? null;
}

export function rememberListPayload<T>(namespace: string, key: string, payload: T): void {
  const cacheKey = retainedPayloadKey(namespace, key);
  if (retainedPayloadCache.has(cacheKey)) {
    retainedPayloadCache.delete(cacheKey);
  }
  retainedPayloadCache.set(cacheKey, payload);
  while (retainedPayloadCache.size > MAX_TABLE_PAYLOADS) {
    const oldest = retainedPayloadCache.keys().next().value as string | undefined;
    if (!oldest) break;
    retainedPayloadCache.delete(oldest);
  }
}

export function forgetListPayload(namespace: string, key: string): void {
  retainedPayloadCache.delete(retainedPayloadKey(namespace, key));
}
