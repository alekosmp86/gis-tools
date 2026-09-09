import type React from "react";
import type { ModuleManifest } from "@/core/modules/contracts";

/**
 * Presentation half of the module contracts.
 *
 * Core stays headless, so it knows a manifest may carry UI contributions but not what one is. This
 * file supplies the concrete type and re-exports a narrowed manifest for module authors to
 * implement.
 */

/**
 * Named extension points a module may render into.
 *
 * A slot renders nothing when no module contributes to it, which is what lets a host page look
 * identical with zero modules registered.
 */
export const UiSlot = {
  /** Cards on the home page tool grid. */
  HOME_TOOL_GRID: "home.toolGrid",
  /** Panel alongside a tool workspace. */
  TOOL_SIDEBAR: "tool.sidebar",
  /** Controls in the spatial preview toolbar. */
  MAP_TOOLBAR: "map.toolbar",
  /** Entries in the primary navigation. */
  NAV_PRIMARY: "nav.primary",
} as const;

export type UiSlot = (typeof UiSlot)[keyof typeof UiSlot];

/** One component a module renders into a named slot. */
export interface UiContribution {
  readonly slot: UiSlot;
  /** Stable key for React reconciliation and for identifying the contribution in diagnostics. */
  readonly id: string;
  readonly order?: number;
  readonly Component: React.ComponentType;
}

/** The manifest shape module authors implement. */
export type AppModuleManifest = ModuleManifest<UiContribution>;
