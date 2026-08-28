/**
 * GIS & Spatial Data Type Definitions
 */

// Re-export comparison & table mapping interfaces for seamless compatibility
export type {
  InsertFieldDefault,
  ColumnMappingConfig,
  SuidMappingStepRef,
  SuidMappingStepProps,
  SuidSelectorCardProps,
  AttributeFieldsCardProps,
  GeometryToggleCardProps,
} from "./comparison";

// Re-export UI catalog & stepper types from UI module
export {
  ToolCategory,
  type ToolCardData,
  type ToolCardProps,
  type StepItemData,
  type StepIndicatorProps,
} from "./ui";
