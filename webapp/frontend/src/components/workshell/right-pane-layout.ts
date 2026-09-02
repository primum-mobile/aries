// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { RightPaneModuleKind } from "@/stores/frame-layout-store";
import type { AstrocartControlsPaneState } from "@/stores/workspace-store";

type ActiveRightPaneInput = {
  inspectorOpen: boolean;
  notesOpen: boolean;
  styleEditorOpen: boolean;
  transitSearchPane: unknown | null;
  transitListPane: unknown | null;
  directionsPane: unknown | null;
  timeLordPane: unknown | null;
  zodiacalReleasingPane: unknown | null;
  firdariaPane: unknown | null;
  decennialsPane: unknown | null;
  profectionsPane: unknown | null;
  eclipsesPane: unknown | null;
  lunarMansionsPane: unknown | null;
  synodicCyclesPane: unknown | null;
  aspectListPane: unknown | null;
  ascensionalTransitsPane: unknown | null;
  calendarPane: unknown | null;
  astrocartControlsPane?: AstrocartControlsPaneState | null;
  activeAstrocartDocumentId?: string | null;
  featureCatalogPane: unknown | null;
};

export function activeRightPaneModule(input: ActiveRightPaneInput): RightPaneModuleKind | null {
  if (input.featureCatalogPane) return "feature-catalog";
  if (
    input.astrocartControlsPane &&
    input.astrocartControlsPane.documentId === input.activeAstrocartDocumentId
  ) {
    return "astrocart-controls";
  }
  if (input.transitSearchPane) return "transit-search";
  if (input.transitListPane) return "directions";
  if (input.directionsPane) return "directions";
  if (input.timeLordPane) return "directions";
  if (input.zodiacalReleasingPane) return "zodiacal-releasing";
  if (input.firdariaPane) return "firdaria";
  if (input.decennialsPane) return "decennials";
  if (input.profectionsPane) return "profections";
  if (input.eclipsesPane) return "eclipses";
  if (input.lunarMansionsPane) return "lunar-mansions";
  if (input.synodicCyclesPane) return "synodic-cycles";
  if (input.aspectListPane) return "aspect-list";
  if (input.ascensionalTransitsPane) return "ascensional-transits";
  if (input.calendarPane) return "calendar";
  if (input.styleEditorOpen) return "chart-style";
  if (input.inspectorOpen && input.notesOpen) return "inspector-notes";
  if (input.inspectorOpen) return "hover-inspector";
  if (input.notesOpen) return "notes";
  return null;
}
