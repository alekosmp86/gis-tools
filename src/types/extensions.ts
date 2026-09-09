import type React from "react";

export const SupportedExtensionFormat = {
  CSV: "CSV",
  SHP: "SHP",
} as const;

export type SupportedExtensionFormat =
  (typeof SupportedExtensionFormat)[keyof typeof SupportedExtensionFormat];

export const DefaultFileSourceTab = {
  PC: "PC",
} as const;

export type DefaultFileSourceTab =
  (typeof DefaultFileSourceTab)[keyof typeof DefaultFileSourceTab];

export interface FileSourceAutoLoadParams {
  sourceSlug?: string;
  resourceId?: string;
}

export interface FileSourceTabExtension {
  readonly id: string;
  readonly label: string;
  readonly icon?: React.ComponentType<{ size?: number }>;
  readonly supportedFormats: readonly SupportedExtensionFormat[];
  readonly supportedTools: readonly string[];
  readonly renderSelector: (context: {
    format: SupportedExtensionFormat;
    onSelectFile: (file: File) => void;
    isLoading: boolean;
  }) => React.ReactNode;
  readonly autoLoad?: (parameters: FileSourceAutoLoadParams) => Promise<File>;
}

