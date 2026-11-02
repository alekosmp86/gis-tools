"use client";

import React from "react";

export interface RenderErrorBoundaryProps {
  /** Names the guarded component in the console message. */
  label: string;
  /** What to show instead of the children once they have thrown. */
  fallback: (error: Error) => React.ReactNode;
  children: React.ReactNode;
}

interface RenderErrorBoundaryState {
  error: Error | null;
}

/** Replaces children that throw during render or in an effect with a fallback, and logs the error instead of leaving a blank box. */
export class RenderErrorBoundary extends React.Component<RenderErrorBoundaryProps, RenderErrorBoundaryState> {
  public state: RenderErrorBoundaryState = { error: null };

  public static getDerivedStateFromError(error: unknown): RenderErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  public componentDidCatch(error: Error): void {
    console.error(`[${this.props.label}] failed to render.`, error);
  }

  public render(): React.ReactNode {
    return this.state.error === null ? this.props.children : this.props.fallback(this.state.error);
  }
}
