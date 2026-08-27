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

/** Common Spatial Reference Systems (SRID) */
export const CommonSrid = {
  EPSG_4326: 4326, // WGS 84 (Lat/Long)
  EPSG_3857: 3857, // Pseudo-Mercator / Web Mercator
  EPSG_5343: 5343, // POSGAR 2007 Argentina 3
} as const;

export type CommonSrid = (typeof CommonSrid)[keyof typeof CommonSrid];
