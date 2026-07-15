// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  spotlightPreview,
  type SpotlightActionId,
  type SpotlightPreview,
} from "@/lib/daemon/client";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/i18n";
import { noteSpotlightDismissed } from "@/shortcuts/spotlight-cooldown";

type AmbientSpotlightProps = {
  open: boolean;
  initialText: string;
  onOpenChange: (open: boolean) => void;
  onCommit?: (
    action: "open-chart" | SpotlightActionId,
    preview: SpotlightPreview,
    text: string,
  ) => Promise<void> | void;
  disabledActions?: SpotlightActionId[];
};

type AmbientSpotlightTriggerOptions = {
  open: boolean;
  onOpen: (initialText?: string) => void;
};

type NotesEditorAmbientKeyDetail = {
  eventType: "keydown" | "keyup";
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
};

const EMPTY_PREVIEW: SpotlightPreview = {
  kind: "none",
  primary: "",
  secondary: "",
  parsed: null,
  actions: [],
  defaultAction: null,
  canConfirm: false,
};

// The bundled Morinus font maps the custom armillary sphere to the tilde slot.
const ARMILLARY_GLYPH = "~";

export function AmbientSpotlight({
  open,
  initialText,
  onOpenChange,
  onCommit,
  disabledActions = [],
}: AmbientSpotlightProps) {
  const t = useT();
  const [value, setValue] = useState(() => initialText);
  const [preview, setPreview] = useState<SpotlightPreview>(EMPTY_PREVIEW);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const text = value.trim();
    if (!text) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      void spotlightPreview(text, controller.signal)
        .then((next) => {
          if (!controller.signal.aborted) setPreview(next);
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          console.error("[spotlight-preview]", err);
          setPreview(EMPTY_PREVIEW);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 80);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, value]);

  const handleValueChange = useCallback((next: string) => {
    setValue(next);
    if (!next.trim()) {
      setPreview(EMPTY_PREVIEW);
      setLoading(false);
      setCommitting(false);
    }
  }, []);

  const disabledActionSet = useMemo(
    () => new Set<SpotlightActionId>(disabledActions),
    [disabledActions],
  );

  const effectiveDefaultAction = useMemo(() => {
    const defaultAction = preview.defaultAction;
    if (
      defaultAction &&
      !disabledActionSet.has(defaultAction as SpotlightActionId)
    ) {
      return defaultAction;
    }
    return (
      preview.actions.find((action) => !disabledActionSet.has(action.id))?.id ?? null
    );
  }, [disabledActionSet, preview.actions, preview.defaultAction]);

  const commit = useCallback(
    async (action: "open-chart" | SpotlightActionId | null | undefined) => {
      if (!action || !preview.canConfirm || !onCommit || committing) return;
      if (disabledActionSet.has(action as SpotlightActionId)) return;
      setCommitting(true);
      try {
        await onCommit(action, preview, value);
      } finally {
        setCommitting(false);
      }
    },
    [committing, disabledActionSet, onCommit, preview, value],
  );

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) noteSpotlightDismissed();
      onOpenChange(nextOpen);
    },
    [onOpenChange],
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t("palette.ambientInput")}
      description={t("palette.ambientPlaceholder")}
      className="aries-ambient-spotlight"
    >
      <Command
        shouldFilter={false}
        className="aries-ambient-spotlight-command"
        onKeyDownCapture={(event) => {
          if (event.key !== "Backspace") return;
          const target = event.target as HTMLInputElement | null;
          if (target?.tagName === "INPUT" && target.value.length === 0) {
            event.preventDefault();
            handleOpenChange(false);
          }
        }}
      >
        <CommandInput
          autoFocus
          value={value}
          onValueChange={handleValueChange}
          placeholder={t("palette.ambientPlaceholder")}
          className="aries-ambient-spotlight-input"
          icon={
            <span className="aries-ambient-spotlight-armillary" aria-hidden>
              {ARMILLARY_GLYPH}
            </span>
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void commit(effectiveDefaultAction);
              return;
            }
          }}
        />
        <CommandList className="max-h-none overflow-visible px-1 pb-1">
          {(preview.primary || loading) && (
            <CommandGroup>
              <div
                className={cn(
                  "aries-ambient-spotlight-preview flex min-h-14 items-center justify-between gap-3 px-3 py-2",
                  loading && !preview.primary ? "opacity-70" : undefined,
                )}
              >
                <div className="min-w-0">
                  <div className="aries-ambient-spotlight-primary truncate">
                    {preview.primary || value}
                  </div>
                  {preview.secondary && (
                    <div className="aries-ambient-spotlight-secondary truncate">
                      {preview.secondary}
                    </div>
                  )}
                </div>
                {preview.kind !== "none" && (
                  <div className="aries-ambient-spotlight-kind shrink-0">
                    {preview.kind === "chart" ? t("palette.kindChart") : t("palette.kindTime")}
                  </div>
                )}
              </div>
            </CommandGroup>
          )}
          {preview.actions.length > 0 && (
            <CommandGroup>
              <div className="aries-ambient-spotlight-actions flex flex-wrap items-center px-1 pb-1">
                {preview.actions.map((action) => (
                  <CommandItem
                    key={action.id}
                    value={action.id}
                    disabled={
                      !onCommit ||
                      committing ||
                      disabledActionSet.has(action.id)
                    }
                    aria-label={
                      disabledActionSet.has(action.id)
                        ? t("palette.actionUnavailable", { label: action.label })
                        : action.label
                    }
                    onSelect={() => void commit(action.id)}
                    className={cn(
                      "aries-ambient-spotlight-action justify-center px-2.5 py-1.5",
                      action.id === effectiveDefaultAction
                        ? "aries-ambient-spotlight-action-default"
                        : undefined,
                    )}
                  >
                    {action.label}
                  </CommandItem>
                ))}
              </div>
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

export function useAmbientSpotlightTriggers({
  open,
  onOpen,
}: AmbientSpotlightTriggerOptions): void {
  const lastShiftUpAtRef = useRef(0);
  const shiftDownRef = useRef(false);
  const shiftWasChordRef = useRef(false);

  useEffect(() => {
    const markShiftDown = () => {
      if (!shiftDownRef.current) {
        shiftWasChordRef.current = false;
      }
      shiftDownRef.current = true;
    };

    const markShiftChord = () => {
      if (shiftDownRef.current) {
        shiftWasChordRef.current = true;
      }
    };

    const handleShiftUp = (event: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "preventDefault">) => {
      const now = performance.now();
      const wasChord = shiftWasChordRef.current;
      shiftDownRef.current = false;
      shiftWasChordRef.current = false;
      if (wasChord || event.metaKey || event.ctrlKey || event.altKey) {
        lastShiftUpAtRef.current = 0;
        return;
      }
      if (now - lastShiftUpAtRef.current <= 450) {
        event.preventDefault();
        lastShiftUpAtRef.current = 0;
        onOpen("");
        return;
      }
      lastShiftUpAtRef.current = now;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (open || !targetAllowsAmbientInput(event.target)) return;
      if (event.key === "Shift") {
        markShiftDown();
        return;
      }
      markShiftChord();
      if (
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        !/^[0-9]$/.test(event.key)
      ) {
        return;
      }
      event.preventDefault();
      onOpen(event.key);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (open || event.key !== "Shift" || !targetAllowsAmbientInput(event.target)) return;
      handleShiftUp(event);
    };

    const onNotesEditorAmbientKey = (event: Event) => {
      if (open || !ambientScopeIsClear()) return;
      const detail = (event as CustomEvent<NotesEditorAmbientKeyDetail>).detail;
      if (!detail || typeof detail.key !== "string") return;
      if (detail.eventType === "keydown") {
        if (detail.key === "Shift") {
          if (!detail.repeat) markShiftDown();
        } else {
          markShiftChord();
        }
        return;
      }
      if (detail.eventType === "keyup" && detail.key === "Shift") {
        handleShiftUp({
          metaKey: Boolean(detail.metaKey),
          ctrlKey: Boolean(detail.ctrlKey),
          altKey: Boolean(detail.altKey),
          preventDefault() {},
        });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("aries://notes-editor-ambient-key", onNotesEditorAmbientKey);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("aries://notes-editor-ambient-key", onNotesEditorAmbientKey);
    };
  }, [onOpen, open]);
}

function targetAllowsAmbientInput(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return true;
  if (
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.tagName === "SELECT" ||
    element.tagName === "BUTTON" ||
    element.isContentEditable
  ) {
    return false;
  }
  if (element.closest('[role="dialog"], [role="alertdialog"]')) {
    return false;
  }
  return ambientScopeIsClear();
}

function ambientScopeIsClear(): boolean {
  if (typeof document === "undefined") return true;
  return (
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
    ) === null
  );
}
