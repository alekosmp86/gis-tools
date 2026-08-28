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
  id: number;
  title: string;
  subtitle: string;
  icon: LucideIcon;
}

export interface ToolCardData {
  id: string;
  title: string;
  category: ToolCategory[];
  badge: { label: string; type: BadgeVariant };
  icon: LucideIcon;
  description: string;
  tags: string[];
  enabled: boolean;
  route?: string;
}

export const ButtonVariant = {
  PRIMARY: "primary",
  SECONDARY: "secondary",
  GHOST: "ghost",
} as const;

export type ButtonVariant = (typeof ButtonVariant)[keyof typeof ButtonVariant];

export interface FeatureHighlightData {
  icon: LucideIcon;
  title: string;
  description: string;
}

export interface WizardStepDef {
  id: number;
  title: string;
  subtitle: string;
  cardTitle?: string;
  cardSubtitle?: string;
  icon: LucideIcon;
  content: React.ReactNode;
  canProceed?: boolean;
  onNext?: () => void;
  nextLabel?: string;
  onBack?: () => void;
  backLabel?: string;
  hideFooter?: boolean;
}
