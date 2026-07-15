// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { listCollections, type ChartCollection } from "@/lib/daemon/client";
import { useT } from "@/lib/i18n/i18n";

const NEW_COLLECTION = "__new__";

/**
 * Save Chart — the wx-parity save flow (morin._do_save): NAME first
 * (autofocused, Enter confirms the whole save), then the COLLECTION (defaulted,
 * so Enter just accepts it). A `.jsonl` is a multi-chart COLLECTION; the daemon
 * writes a fresh record id for explicit Save As and preserves the chosen
 * collection's other charts. No OS file dialog, no forced list-clicking —
 * type a name, hit Enter, done.
 *
 * onConfirm receives `{ name, collection }`: the (possibly renamed) chart name
 * and an existing collection's path or a new collection name.
 */
export function SaveToCollectionDialog({
  open,
  initialName,
  currentCollectionPath,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  initialName: string;
  /** The chart's bound collection path, preselected when present. */
  currentCollectionPath?: string | null;
  onConfirm: (name: string, collection: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const [collections, setCollections] = React.useState<ChartCollection[]>([]);
  const [selected, setSelected] = React.useState<string>("");
  const [newCollectionName, setNewCollectionName] = React.useState<string>("");
  const [name, setName] = React.useState<string>(initialName);
  const nameRef = React.useRef<HTMLInputElement>(null);

  // Focus + select the name on mount so the user can overtype or Enter straight
  // through. (initialName seeds useState; the parent remounts via `key` per open
  // so a fresh initialName re-initializes without a set-state-in-effect.)
  React.useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      nameRef.current?.focus();
      nameRef.current?.select();
    }, 0);
    return () => clearTimeout(timer);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    listCollections(ctrl.signal)
      .then((list) => {
        setCollections(list);
        const bound = currentCollectionPath
          ? list.find((c) => c.path === currentCollectionPath)
          : null;
        const def = bound ?? list.find((c) => c.isDefault) ?? list[0] ?? null;
        setSelected(def ? def.path : NEW_COLLECTION);
      })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        setCollections([]);
        setSelected(NEW_COLLECTION);
      });
    return () => ctrl.abort();
  }, [open, currentCollectionPath]);

  const creatingNew = selected === NEW_COLLECTION;
  const trimmedName = name.trim();
  const trimmedNew = newCollectionName.trim();
  const collectionValue = creatingNew ? trimmedNew : selected;
  const canSave = trimmedName.length > 0 && collectionValue.length > 0;

  const confirm = () => {
    if (!canSave) return;
    onConfirm(trimmedName, collectionValue);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("saveDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("saveDialog.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-1">
          <label className="flex flex-col gap-1 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-primary)]">
            <span className="text-[color:var(--aries-text-muted)]">{t("saveDialog.name")}</span>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirm();
                }
              }}
              className="rounded border border-[color:var(--aries-border-subtle)] bg-transparent px-2 py-1.5 text-[color:var(--aries-text-primary)] outline-none focus:border-[color:var(--aries-focus-ring)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-primary)]">
            <span className="text-[color:var(--aries-text-muted)]">{t("saveDialog.collection")}</span>
            <select
              value={selected}
              onChange={(e) => setSelected(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !creatingNew) {
                  e.preventDefault();
                  confirm();
                }
              }}
              className="rounded border border-[color:var(--aries-border-subtle)] bg-[color:var(--aries-surface)] px-2 py-1.5 text-[color:var(--aries-text-primary)] outline-none focus:border-[color:var(--aries-focus-ring)]"
            >
              {collections.map((c) => (
                <option key={c.path} value={c.path}>
                  {c.name} ({c.count})
                </option>
              ))}
              <option value={NEW_COLLECTION}>{t("saveDialog.newCollection")}</option>
            </select>
          </label>
          {creatingNew ? (
            <label className="flex flex-col gap-1 text-[length:var(--aries-font-size-small)]">
              <span className="text-[color:var(--aries-text-muted)]">{t("saveDialog.newCollectionName")}</span>
              <input
                value={newCollectionName}
                placeholder={t("saveDialog.newCollectionPlaceholder")}
                onChange={(e) => setNewCollectionName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    confirm();
                  }
                }}
                className="rounded border border-[color:var(--aries-border-subtle)] bg-transparent px-2 py-1.5 text-[color:var(--aries-text-primary)] outline-none focus:border-[color:var(--aries-focus-ring)]"
              />
            </label>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("saveDialog.cancel")}
          </Button>
          <Button disabled={!canSave} onClick={confirm}>
            {t("saveDialog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
