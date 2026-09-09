"use client";

import React from "react";
import { useModuleContributions } from "./ModuleContributionsContext";
import { ModuleErrorBoundary } from "./ModuleErrorBoundary";
import type { UiSlot } from "./contracts";

interface ModuleSlotProps {
  slot: UiSlot;
}

/**
 * Named extension point.
 *
 * Renders whatever modules have contributed to this slot, in declared order, and renders nothing
 * when there are none. Host pages therefore look identical with zero modules registered, which is
 * the property that makes removing a module safe.
 */
export const ModuleSlot: React.FC<ModuleSlotProps> = ({ slot }) => {
  const contributions = useModuleContributions();

  const slotContributions = contributions
    .filter((contribution) => contribution.slot === slot)
    .sort(
      (first, second) =>
        (first.order ?? Number.MAX_SAFE_INTEGER) - (second.order ?? Number.MAX_SAFE_INTEGER)
    );

  if (slotContributions.length === 0) {
    return null;
  }

  return (
    <>
      {slotContributions.map(({ id, Component }) => (
        <ModuleErrorBoundary key={id} contributionId={id}>
          <Component />
        </ModuleErrorBoundary>
      ))}
    </>
  );
};
