import type React from "react";
import type { ModuleManifest, RegisteredPage } from "@/core/modules/contracts";

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
  /**
   * Alternative file sources offered beside the local upload dropzone.
   *
   * Hosted by `ModuleTabbedSlot`, which supplies the contribution with the format it must accept
   * and the callback that hands a chosen file back. Read that context with `useFileSourceSlot`.
   */
  FILE_SOURCE_TABS: "file.sourceTabs",
} as const;

export type UiSlot = (typeof UiSlot)[keyof typeof UiSlot];

/** One component a module renders into a named slot. */
export interface UiContribution {
  readonly slot: UiSlot;
  /** Stable key for React reconciliation and for identifying the contribution in diagnostics. */
  readonly id: string;
  readonly order?: number;
  readonly Component: React.ComponentType;
  /**
   * Label shown by hosts that draw chrome around a contribution, such as a tab strip. Ignored by
   * slots that render contributions bare.
   */
  readonly label?: string;
  /** Icon for that same chrome. */
  readonly Icon?: React.ComponentType<{ size?: number }>;
}

/** Formats a file source contribution may be asked to supply. */
export const FileSourceFormat = {
  CSV: "CSV",
  SHP: "SHP",
} as const;

export type FileSourceFormat = (typeof FileSourceFormat)[keyof typeof FileSourceFormat];

/**
 * What a host offering alternative file sources publishes to its contributions.
 *
 * A contribution renders with no props, which is right for a card and useless for a file picker
 * that must know what it may accept and where to hand the result.
 */
export interface FileSourceSlotValue {
  /** Identifies the host tool, e.g. "db-csv-sync", so a contribution can tailor what it offers. */
  readonly toolId: string;
  readonly format: FileSourceFormat;
  /** Hands a chosen file to the host, exactly as the local dropzone would. */
  readonly onSelectFile: (file: File) => void;
  /** True while the host is busy parsing a file; contributions should disable their controls. */
  readonly isLoading: boolean;
}

/** A page component contributed by a module; it renders as a route of its own. */
export type ModulePageComponent = React.ComponentType;

/** What a generated page route resolves out of the registry. */
export type RegisteredModulePage = RegisteredPage<ModulePageComponent>;

/** The manifest shape module authors implement. */
export type AppModuleManifest = ModuleManifest<UiContribution, ModulePageComponent>;
