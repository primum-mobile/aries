// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

export const LIST_CURSOR_FOLLOW = {
  SOURCE_LIVE: "source-live",
  SOURCE_FROZEN: "source-frozen",
  MARKER_ONLY: "marker-only",
  MANUAL: "manual",
} as const;

export type ListCursorFollowToken =
  (typeof LIST_CURSOR_FOLLOW)[keyof typeof LIST_CURSOR_FOLLOW];

export const LIST_VIEWPORT_FOLLOW = {
  AUTO_FOCUS: "auto-focus",
  PRESERVE_ANCHOR: "preserve-anchor",
  FROZEN_ANCHOR: "frozen-anchor",
  MANUAL: "manual",
} as const;

export type ListViewportFollowToken =
  (typeof LIST_VIEWPORT_FOLLOW)[keyof typeof LIST_VIEWPORT_FOLLOW];

export const LIST_SCROLLBAR_FOLLOW = {
  AUTO: "auto",
  HIDE_DURING_SOURCE_LIVE: "hide-during-source-live",
  HIDDEN: "hidden",
} as const;

export type ListScrollbarFollowToken =
  (typeof LIST_SCROLLBAR_FOLLOW)[keyof typeof LIST_SCROLLBAR_FOLLOW];

export const LIST_FOLLOW_ORIGIN = {
  PANE_OPEN: "pane-open",
  LIST_ROW_LINK: "list-row-link",
  CONTEXT_MENU: "context-menu",
  TOOLBAR: "toolbar",
  RESTORED: "restored",
} as const;

export type ListFollowOriginToken =
  (typeof LIST_FOLLOW_ORIGIN)[keyof typeof LIST_FOLLOW_ORIGIN];

export type ListViewportAnchor = {
  rowId?: string | null;
  eventDatetime?: string | null;
  scrollTop?: number | null;
};

export type ListFollowPolicy = {
  cursor: ListCursorFollowToken;
  viewport: ListViewportFollowToken;
  scrollbar?: ListScrollbarFollowToken;
  origin: ListFollowOriginToken;
  sourceDocumentId?: string | null;
  cursorDocumentId?: string | null;
  focusDatetime?: string | null;
  anchor?: ListViewportAnchor | null;
};

type PolicyArgs = {
  sourceDocumentId?: string | null;
  cursorDocumentId?: string | null;
  focusDatetime?: string | null;
  anchor?: ListViewportAnchor | null;
};

export function sourceLiveFollowPolicy(args: PolicyArgs = {}): ListFollowPolicy {
  return {
    cursor: LIST_CURSOR_FOLLOW.SOURCE_LIVE,
    viewport: LIST_VIEWPORT_FOLLOW.AUTO_FOCUS,
    scrollbar: LIST_SCROLLBAR_FOLLOW.HIDE_DURING_SOURCE_LIVE,
    origin: LIST_FOLLOW_ORIGIN.PANE_OPEN,
    ...args,
  };
}

export function listRowLinkFollowPolicy(args: PolicyArgs = {}): ListFollowPolicy {
  return {
    cursor: LIST_CURSOR_FOLLOW.SOURCE_FROZEN,
    viewport: LIST_VIEWPORT_FOLLOW.PRESERVE_ANCHOR,
    scrollbar: LIST_SCROLLBAR_FOLLOW.AUTO,
    origin: LIST_FOLLOW_ORIGIN.LIST_ROW_LINK,
    ...args,
  };
}

export function resolveListScrollbarFollow(
  policy: ListFollowPolicy | null | undefined,
): ListScrollbarFollowToken {
  if (policy?.scrollbar) return policy.scrollbar;
  if (!policy || policy.cursor === LIST_CURSOR_FOLLOW.SOURCE_LIVE) {
    return LIST_SCROLLBAR_FOLLOW.HIDE_DURING_SOURCE_LIVE;
  }
  return LIST_SCROLLBAR_FOLLOW.AUTO;
}

export function resolveListFocusDatetime(
  policy: ListFollowPolicy | null | undefined,
  liveFocusDatetime: string | null | undefined,
  fallbackFocusDatetime: string | null | undefined,
): string | null | undefined {
  if (!policy || policy.cursor === LIST_CURSOR_FOLLOW.SOURCE_LIVE) {
    return liveFocusDatetime ?? fallbackFocusDatetime;
  }
  return policy.focusDatetime ?? fallbackFocusDatetime;
}
