"use client";
// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import * as React from "react";
import { CopyPlus, Download, Ellipsis, LoaderCircle, Pencil, Plus, RotateCcw, Save, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { exportAsteroidSelections, type AsteroidSelectionCommand, type OptionsAsteroids } from "@/lib/daemon/client";
import { useT } from "@/lib/i18n/i18n";
import { resolveShellHost } from "@/lib/shell-host";
import { exportFileBaseName, exportTextContent } from "./text-export";

export function AsteroidSelectionControls({ options, disabled, onCommand }: {
  options: OptionsAsteroids;
  disabled: boolean;
  onCommand: (command: AsteroidSelectionCommand) => Promise<boolean>;
}) {
  const t = useT();
  const selections = options.userSelections;
  const [naming, setNaming] = React.useState<"save" | "rename" | null>(null);
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<"selection" | "import" | "export" | null>(null);
  const [imported, setImported] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const unavailable = disabled || busy || !selections;
  const selected = selections?.selections.find(item => item.id === selections.selectedId);

  const perform = async (command: Omit<AsteroidSelectionCommand, "baseRevision">, file?: File) => {
    if (unavailable || !selections) return;
    setBusy(true);
    setFailure(null);
    setImported(false);
    try {
      if (file) {
        if (file.size > 16 * 1024 * 1024) throw new Error("asteroid selection import exceeds byte limit");
        command = { ...command, document: JSON.parse(await file.text()) };
      }
      if (!await onCommand({ ...command, baseRevision: selections.revision })) {
        setFailure(command.action === "import" ? "import" : "selection");
        return;
      }
      setImported(command.action === "import");
      setNaming(null);
      setName("");
    } catch { setFailure(command.action === "import" ? "import" : "selection"); }
    finally { setBusy(false); }
  };
  const startNaming = (mode: "save" | "rename") => {
    setNaming(mode);
    setName(mode === "rename" ? selected?.name ?? "" : "");
    setFailure(null);
    setImported(false);
  };
  const save = () => {
    if (naming) {
      if (name.trim()) void perform({ action: naming, name: name.trim(),
        ...(naming === "rename" ? { id: selected?.id } : {}) });
    } else if (selected) void perform({ action: "save", id: selected.id });
    else startNaming("save");
  };

  const exportSelections = async (all: boolean) => {
    if (unavailable || (!all && !selected)) return;
    setBusy(true);
    setFailure(null);
    setImported(false);
    try {
      const host = resolveShellHost();
      const filename = `${exportFileBaseName(all ? "asteroid-selections" : selected!.name)}.json`;
      const title = all ? t("asteroidSelection.exportAll") : t("asteroidSelection.export");
      const filters = [{ name: t("asteroidSelection.jsonFiles"), extensions: ["json"] }];
      // Open native save chrome in the click turn, before fetching the file.
      const path = host.capabilities.nativeFileDialogs
        ? await host.selectSavePath({ title, defaultPath: filename, filters }) : undefined;
      if (path === null) return;
      const text = await exportAsteroidSelections(all ? undefined : selected!.id);
      await exportTextContent({ filename, text, path, extension: "json", title,
        filters, mimeType: "application/json" });
    } catch { setFailure("export"); }
    finally { setBusy(false); }
  };

  return (
    <div aria-busy={busy} className="mb-[var(--aries-form-field-gap)]">
      <div className="flex min-w-0 items-center gap-1">
        {naming ? (
          <Input autoFocus maxLength={80} value={name} disabled={unavailable}
            className="h-7 min-w-0 flex-1 text-[length:var(--aries-font-size-small)]"
            placeholder={t("asteroidSelection.name")} aria-label={t("asteroidSelection.name")}
            onChange={event => setName(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter") { event.preventDefault(); save(); }
              if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setNaming(null); }
            }} />
        ) : (
          <select data-aries-surface="control" aria-label={t("asteroidSelection.title")}
            className="h-7 min-w-0 flex-1 rounded border border-border bg-transparent px-2 text-[length:var(--aries-font-size-small)]"
            value={selections?.selectedId ?? ""} disabled={unavailable}
            onChange={event => void perform(event.target.value
              ? { action: "select", id: event.target.value } : { action: "clear" })}>
            <option value="">{t("asteroidSelection.new")} *</option>
            {selections?.selections.map(item => <option key={item.id} value={item.id}>
              {item.name}{item.id === selections.selectedId && selections.dirty ? " *" : ""}
            </option>)}
          </select>
        )}
        <Button type="button" size="sm" variant="outline" className="h-7 gap-1 px-2"
          disabled={unavailable || Boolean(naming && !name.trim())} onClick={save}>
          <Save className="h-3.5 w-3.5" aria-hidden="true" />
          {!selected && !naming ? t("asteroidSelection.savePrompt") : t("settings.save")}
        </Button>
        {naming ? (
          <Button type="button" size="icon-xs" variant="ghost" disabled={unavailable}
            title={t("settings.cancel")} aria-label={t("settings.cancel")} onClick={() => setNaming(null)}>
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button type="button" size="icon-xs" variant="ghost" disabled={unavailable}
              title={t("asteroidSelection.actions")} aria-label={t("asteroidSelection.actions")} />}>
              {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                : <Ellipsis className="h-3.5 w-3.5" aria-hidden="true" />}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto min-w-[var(--aries-menu-dropdown-min-width)]">
              <DropdownMenuItem disabled={unavailable} onClick={() => void perform({ action: "new" })}>
                <Plus />{t("asteroidSelection.new")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={unavailable} onClick={() => startNaming("save")}>
                <CopyPlus />{t("asteroidSelection.saveAs")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={unavailable || !selected || !selections?.dirty}
                onClick={() => { if (selected) void perform({ action: "select", id: selected.id }); }}>
                <RotateCcw />{t("asteroidSelection.restore")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={unavailable || !selected} onClick={() => startNaming("rename")}>
                <Pencil />{t("asteroidSelection.rename")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={unavailable} onClick={() => fileInputRef.current?.click()}>
                <Upload />{t("asteroidSelection.import")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={unavailable || !selected} onClick={() => void exportSelections(false)}>
                <Download />{t("asteroidSelection.export")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={unavailable || !selections?.selections.length} onClick={() => void exportSelections(true)}>
                <Download />{t("asteroidSelection.exportAll")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={unavailable || !selected}
                onClick={() => { if (selected) void perform({ action: "delete", id: selected.id }); }}>
                <Trash2 />{t("asteroidSelection.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <input ref={fileInputRef} type="file" accept=".json,application/json" className="hidden"
        data-aries-control-appearance="local" aria-label={t("asteroidSelection.import")}
        onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void perform({ action: "import" }, file);
        }} />
      {failure && <p role="alert" className="mt-1 text-[length:var(--aries-font-size-small)] text-destructive">
        {failure === "import" ? t("asteroidSelection.importError")
          : failure === "export" ? t("asteroidSelection.exportError") : t("asteroidSelection.error")}
      </p>}
      {imported && <p role="status" className="mt-1 text-[length:var(--aries-font-size-small)] text-muted-foreground">
        {t("asteroidSelection.imported")}
      </p>}
    </div>
  );
}
