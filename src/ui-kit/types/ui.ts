import React from "react";
import type { LucideIcon } from "lucide-react";

export const AlertType = {
  SUCCESS: "success",
  ERROR: "error",
  WARNING: "warning",
  INFO: "info",
} as const;

export type AlertType = (typeof AlertType)[keyof typeof AlertType];

export const BadgeVariant = {
  ACTIVE: "active",
  DEV: "dev",
  PLANNED: "planned",
} as const;

export type BadgeVariant = (typeof BadgeVariant)[keyof typeof BadgeVariant];

export const ToolCategory = {
  ALL: "Todos",
  SYNC: "Sincronización y Comparación",
  VIEWERS: "Visualización",
  CONVERTERS: "Conversores", // @planned — future tool category
  DATABASE: "Base de Datos",
} as const;

export type ToolCategory = (typeof ToolCategory)[keyof typeof ToolCategory];

export interface StepItemData {
  readonly id: number;
  readonly title: string;
  readonly subtitle: string;
  readonly icon: LucideIcon;
}

export interface ToolBadgeData {
  readonly label: string;
  readonly type: BadgeVariant;
}

export interface BaseToolCardData {
  readonly id: string;
  readonly title: string;
  readonly category: readonly ToolCategory[];
  readonly badge: ToolBadgeData;
  readonly icon: LucideIcon;
  readonly description: string;
  readonly tags: readonly string[];
}

export interface EnabledToolCardData extends BaseToolCardData {
  readonly enabled: true;
  readonly route: string;
}

export interface DisabledToolCardData extends BaseToolCardData {
  readonly enabled: false;
  readonly route?: string;
}

export type ToolCardData = EnabledToolCardData | DisabledToolCardData;

export const ButtonVariant = {
  PRIMARY: "primary",
  SECONDARY: "secondary",
  GHOST: "ghost",
} as const;

export type ButtonVariant = (typeof ButtonVariant)[keyof typeof ButtonVariant];

export interface FeatureHighlightData {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description: string;
}

export interface WizardStepDef {
  readonly id: number;
  readonly title: string;
  readonly subtitle: string;
  readonly cardTitle?: string;
  readonly cardSubtitle?: string;
  readonly icon: LucideIcon;
  readonly content: React.ReactNode;
  readonly canProceed?: boolean;
  readonly onNext?: () => void;
  readonly nextLabel?: string;
  readonly onBack?: () => void;
  readonly backLabel?: string;
  readonly hideFooter?: boolean;
}
