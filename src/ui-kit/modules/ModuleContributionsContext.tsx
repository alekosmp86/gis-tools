"use client";

import React, { createContext, useContext } from "react";
import type { UiContribution } from "./contracts";

/**
 * Carries module UI contributions down to the slots that render them.
 *
 * ui-kit may not import the composition root — the layer boundaries forbid it — so the application
 * shell reads the registry and supplies the contributions here. That keeps ui-kit unaware of which
 * modules exist, or whether any exist at all.
 */
const ModuleContributionsContext = createContext<ReadonlyArray<UiContribution>>([]);

interface ModuleContributionsProviderProps {
  contributions: ReadonlyArray<UiContribution>;
  children: React.ReactNode;
}

export const ModuleContributionsProvider: React.FC<ModuleContributionsProviderProps> = ({
  contributions,
  children,
}) => (
  <ModuleContributionsContext.Provider value={contributions}>
    {children}
  </ModuleContributionsContext.Provider>
);

/**
 * Reads the contributions in scope. Defaults to an empty list, so a slot rendered outside the
 * provider degrades to rendering nothing rather than throwing.
 */
export function useModuleContributions(): ReadonlyArray<UiContribution> {
  return useContext(ModuleContributionsContext);
}
