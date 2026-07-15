// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WorkspaceOpenResult, WorkspaceStatePayload } from "@/lib/daemon/client";

export type WorkspaceCommandResult = (WorkspaceOpenResult | WorkspaceStatePayload) & {
  documentId?: string | null;
};

export type WorkspaceCommandOpenRow = {
  name: string;
  source: string;
  recordIndex: number;
};

export type WorkspaceCommandRequestPayload =
  | {
      kind: "open-radix";
      row: WorkspaceCommandOpenRow;
    }
  | {
      kind: "open-synastry-partner";
      parentRadixId: string;
      row: WorkspaceCommandOpenRow;
    }
  | {
      kind: "open-two-synastry";
      center: WorkspaceCommandOpenRow;
      partner: WorkspaceCommandOpenRow;
    };

export type WorkspaceCommandBusMessage =
  | {
      type: "workspace-command-started";
      id: string;
      senderId: string;
      at: number;
    }
  | {
      type: "workspace-command-request";
      id: string;
      senderId: string;
      at: number;
      payload: WorkspaceCommandRequestPayload;
    }
  | {
      type: "workspace-command-result";
      id: string;
      senderId: string;
      at: number;
      fallbackDocumentId?: string | null;
      result: WorkspaceCommandResult;
    }
  | {
      type: "workspace-command-failed";
      id: string;
      senderId: string;
      at: number;
      error: string;
    };

const CHANNEL_NAME = "aries-workspace-command-results";
const STORAGE_KEY = "aries.workspaceCommandResult.v1";
const REQUEST_ACK_TIMEOUT_MS = 180;
const REQUEST_RESULT_TIMEOUT_MS = 5000;
const senderId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

let channel: BroadcastChannel | null | undefined;

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return null;
  }
  if (channel === undefined) {
    channel = new BroadcastChannel(CHANNEL_NAME);
  }
  return channel;
}

function isMessage(value: unknown): value is WorkspaceCommandBusMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<WorkspaceCommandBusMessage>;
  return (
    (message.type === "workspace-command-started" ||
      message.type === "workspace-command-request" ||
      message.type === "workspace-command-result" ||
      message.type === "workspace-command-failed") &&
    typeof message.id === "string" &&
    typeof message.senderId === "string"
  );
}

function postMessage(message: WorkspaceCommandBusMessage): void {
  const activeChannel = getChannel();
  if (activeChannel) {
    activeChannel.postMessage(message);
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(message));
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage is a cross-webview fallback. BroadcastChannel is not reliable
    // across every Tauri WebView implementation.
  }
}

function commandId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function postWorkspaceCommandStarted(id: string): void {
  postMessage({ type: "workspace-command-started", id, senderId, at: now() });
}

export function postWorkspaceCommandResult(
  id: string,
  result: WorkspaceCommandResult,
  fallbackDocumentId?: string | null,
): void {
  postMessage({
    type: "workspace-command-result",
    id,
    senderId,
    at: now(),
    fallbackDocumentId,
    result,
  });
}

export function postWorkspaceCommandFailed(id: string, error: unknown): void {
  postMessage({
    type: "workspace-command-failed",
    id,
    senderId,
    at: now(),
    error: error instanceof Error ? error.message : String(error),
  });
}

export async function requestMainWorkspaceCommand<T extends WorkspaceCommandResult>(
  payload: WorkspaceCommandRequestPayload,
  options: { requireAck?: boolean } = {},
): Promise<T> {
  const requireAck = options.requireAck ?? true;
  const id = commandId();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let acknowledged = false;
    let ackTimer: number | null = null;
    let resultTimer: number | null = null;
    let unsubscribe = () => {};
    const cleanup = () => {
      settled = true;
      unsubscribe();
      if (ackTimer !== null) window.clearTimeout(ackTimer);
      if (resultTimer !== null) window.clearTimeout(resultTimer);
    };
    const fail = (error: Error) => {
      if (settled) return;
      cleanup();
      reject(error);
    };
    unsubscribe = subscribeWorkspaceCommandBus((message) => {
      if (message.id !== id) return;
      if (message.type === "workspace-command-started") {
        acknowledged = true;
        if (ackTimer !== null) {
          window.clearTimeout(ackTimer);
          ackTimer = null;
        }
        return;
      }
      if (message.type === "workspace-command-result") {
        cleanup();
        resolve(message.result as T);
        return;
      }
      if (message.type === "workspace-command-failed") {
        fail(new Error(message.error));
      }
    });
    if (requireAck) {
      ackTimer = window.setTimeout(() => {
        if (!acknowledged) {
          fail(new Error("main workspace command handler did not acknowledge"));
        }
      }, REQUEST_ACK_TIMEOUT_MS);
    }
    resultTimer = window.setTimeout(() => {
      fail(new Error("main workspace command timed out"));
    }, REQUEST_RESULT_TIMEOUT_MS);
    postMessage({
      type: "workspace-command-request",
      id,
      senderId,
      at: now(),
      payload,
    });
  });
}

export async function runBroadcastWorkspaceCommand<T extends WorkspaceCommandResult>(
  run: () => Promise<T>,
  fallbackDocumentId?: string | null,
): Promise<T> {
  const id = commandId();
  postWorkspaceCommandStarted(id);
  try {
    const result = await run();
    postWorkspaceCommandResult(id, result, fallbackDocumentId);
    return result;
  } catch (error) {
    postWorkspaceCommandFailed(id, error);
    throw error;
  }
}

export function subscribeWorkspaceCommandBus(
  handler: (message: WorkspaceCommandBusMessage) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const seen = new Set<string>();
  const receive = (value: unknown) => {
    if (!isMessage(value) || value.senderId === senderId) return;
    const key = `${value.type}:${value.id}:${value.at}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (seen.size > 128) {
      const first = seen.values().next().value;
      if (first) seen.delete(first);
    }
    handler(value);
  };
  const activeChannel = getChannel();
  const onChannelMessage = (event: MessageEvent<unknown>) => receive(event.data);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      receive(JSON.parse(event.newValue));
    } catch {
      // Ignore malformed storage events from old builds or manual edits.
    }
  };
  activeChannel?.addEventListener("message", onChannelMessage);
  window.addEventListener("storage", onStorage);
  return () => {
    activeChannel?.removeEventListener("message", onChannelMessage);
    window.removeEventListener("storage", onStorage);
  };
}
