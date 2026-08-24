import type { LucideIcon } from "lucide-react";
import type { BadgeVariant } from "./ui";

export const ToolCategory = {
  ALL: "Todos",
  SYNC: "Sincronización y Comparación",
  CONVERTERS: "Conversores",
  DATABASE: "Base de Datos",
} as const;

export type ToolCategory = (typeof ToolCategory)[keyof typeof ToolCategory];

export interface StepItemData {
  id: number;
  title: string;
  subtitle: string;
  icon: LucideIcon;
}

export interface StepIndicatorProps {
  currentStep: number;
  onStepClick?: (stepId: number) => void;
}

export interface ToolCardData {
  id: string;
  title: string;
  category: ToolCategory;
  badge: { label: string; type: BadgeVariant };
  icon: LucideIcon;
  description: string;
  tags: string[];
  actionLabel: string;
  enabled: boolean;
}

export interface ToolCardProps {
  tool: ToolCardData;
  onLaunch?: (toolId: string) => void;
}
