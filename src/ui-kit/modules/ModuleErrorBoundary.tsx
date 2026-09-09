"use client";

import React from "react";

interface ModuleErrorBoundaryProps {
  /** Identifies the failing contribution in diagnostics. */
  contributionId: string;
  children: React.ReactNode;
}

interface ModuleErrorBoundaryState {
  hasFailed: boolean;
}

/**
 * Isolates a module's UI contribution from the page hosting it.
 *
 * This is what makes "module broken" and "module removed" behave identically: a contribution that
 * throws during render is dropped and the host page continues, instead of taking down a core
 * workflow. Error boundaries must be class components, which is why this is the only class
 * component in the presentation layer.
 */
export class ModuleErrorBoundary extends React.Component<
  ModuleErrorBoundaryProps,
  ModuleErrorBoundaryState
> {
  public state: ModuleErrorBoundaryState = { hasFailed: false };

  public static getDerivedStateFromError(): ModuleErrorBoundaryState {
    return { hasFailed: true };
  }

  public componentDidCatch(error: Error): void {
    // Surfaced rather than swallowed: a silently missing contribution is very hard to diagnose.
    console.error(
      `[modules] Contribution "${this.props.contributionId}" failed to render and was skipped.`,
      error
    );
  }

  public render(): React.ReactNode {
    if (this.state.hasFailed) {
      return null;
    }

    return this.props.children;
  }
}
