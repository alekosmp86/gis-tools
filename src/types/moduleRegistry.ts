import type React from "react";

export type ModuleHttpHandler = (request: Request) => Promise<Response>;

export interface ModuleApiHandler {
  readonly GET?: ModuleHttpHandler;
  readonly POST?: ModuleHttpHandler;
  readonly PUT?: ModuleHttpHandler;
  readonly DELETE?: ModuleHttpHandler;
}

export interface ModuleToolDefinition {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly component: React.ComponentType;
}
