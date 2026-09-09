/**
 * gisConstants.ts
 * Single source of truth for GIS coordinate decimal precision, spatial tolerance, and quantization.
 */

export const GIS_PRECISION = {
  /**
   * Coordinate decimals for storage, SQL queries, and WGS84 GeoJSON serialization.
   * 6 decimal places = ~0.11 meters (~11 cm), the worldwide standard for cadastral and infrastructure vector surveys.
   */
  COORDINATE_DECIMALS: 6,

  /**
   * Fast integer multiplier for 6-decimal fixed-point quantization (10^6).
   */
  COORDINATE_FACTOR: 1_000_000,

  /**
   * Decimal places for topological equality comparison.
   * 4 decimal places = ~10 meters tolerance, eliminating micro-jitter between PostGIS ST_Transform and ESRI projections.
   */
  COMPARISON_DECIMALS: 4,

  /**
   * Fast integer multiplier for 4-decimal comparison quantization (10^4).
   */
  COMPARISON_FACTOR: 10_000,
} as const;
