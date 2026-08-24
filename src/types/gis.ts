import type { LucideIcon } from "lucide-react";
import type { BadgeVariant } from "./ui";
import type { DbColumnMetadata } from "./db";

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
  fileStepTitle?: string;
  fileStepSubtitle?: string;
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
  route?: string;
}

export interface ToolCardProps {
  tool: ToolCardData;
  onLaunch?: (toolId: string) => void;
}

export interface InsertFieldDefault {
  fieldName: string;
  value: string;
  useRawExpression: boolean;
}

export interface ColumnMappingConfig {
  suidColumns: string[];
  matchedFileSuidColumns: string[];
  fieldsToCompare: string[];
  attributeMap?: Record<string, string>;
  compareGeometry: boolean;
  insertDefaults?: Record<string, InsertFieldDefault>;
}

export interface SuidMappingStepProps {
  dbColumns: string[];
  columnDetails?: DbColumnMetadata[];
  fileAttributes: string[];
  onSuccess: (mappingConfig: ColumnMappingConfig) => void;
  onBack: () => void;
  initialConfig?: ColumnMappingConfig | null;
}

export interface SuidSelectorCardProps {
  selectableColumns: string[];
  selectedSuids: string[];
  matchedFileSuids: string[];
  onToggleSuid: (suid: string) => void;
}

export interface AttributeFieldsCardProps {
  availableFields: string[];
  selectedFields: string[];
  attributeMap: Record<string, string>;
  fileAttributes: string[];
  onToggleField: (field: string) => void;
  onMapField: (dbCol: string, fileAttr: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}

export interface GeometryToggleCardProps {
  compareGeometry: boolean;
  onToggleGeometry: (enabled: boolean) => void;
}
