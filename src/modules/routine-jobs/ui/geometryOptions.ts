export const DEFAULT_TOLERANCE_TEXT = "1.0";
export const DEFAULT_UPDATE_GEOMETRIES = true;

export interface GeometryOptionsDraft {
  tolerance: string;
  updateGeometries: boolean;
}

const isBlank = (value: string): boolean => value.trim() === "";

export const isToleranceValid = (text: string): boolean => {
  if (isBlank(text)) return false;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0;
};

export const toleranceOf = (text: string): number => Number(text.trim());
