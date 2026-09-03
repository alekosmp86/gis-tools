import proj4 from "proj4";

export type CoordinateTransformFn = (coordinate: [number, number]) => [number, number];

/**
 * ProjectionEngine
 * Object-Oriented service managing Coordinate Reference System (CRS) transformations.
 * Caches compiled proj4 definitions to avoid re-parsing ESRI PRJ WKT strings.
 */
export class ProjectionEngine {
  private static instance: ProjectionEngine | null = null;
  private readonly converterCache = new Map<string, CoordinateTransformFn>();

  /**
   * Singleton accessor for global projection engine.
   */
  public static getInstance(): ProjectionEngine {
    if (!ProjectionEngine.instance) {
      ProjectionEngine.instance = new ProjectionEngine();
    }
    return ProjectionEngine.instance;
  }

  /**
   * Creates or retrieves a cached coordinate transformation function from an ESRI PRJ WKT string or EPSG code to WGS84 (EPSG:4326).
   * Returns null if the source CRS is already WGS84 degrees or if no projection definition is provided.
   */
  public getConverter(prjText?: string | null): CoordinateTransformFn | null {
    if (!prjText || !prjText.trim()) {
      return null;
    }

    const cleanPrj = prjText.trim();

    // If it's already WGS84 degrees without a projected coordinate system, no conversion is needed
    if (
      cleanPrj === "EPSG:4326" ||
      cleanPrj === "4326" ||
      (cleanPrj.startsWith("GEOGCS") && !cleanPrj.includes("PROJCS"))
    ) {
      return null;
    }

    const cached = this.converterCache.get(cleanPrj);
    if (cached) {
      return cached;
    }

    try {
      const projConverter = proj4(cleanPrj, "EPSG:4326");

      const transformFn: CoordinateTransformFn = (coordinate: [number, number]): [number, number] => {
        try {
          const [transformedX, transformedY] = projConverter.forward(coordinate);
          if (isNaN(transformedX) || isNaN(transformedY)) {
            return coordinate;
          }
          return [transformedX, transformedY];
        } catch {
          return coordinate;
        }
      };

      this.converterCache.set(cleanPrj, transformFn);
      return transformFn;
    } catch (error) {
      console.warn("Could not initialize proj4 for prjText:", error);
      return null;
    }
  }

  /**
   * Extracts the native EPSG code from an ESRI PRJ WKT string.
   */
  public static extractEpsg(prjText?: string | null): number | null {
    if (!prjText || !prjText.trim()) return null;
    const clean = prjText.trim();
    if (clean === "EPSG:4326" || clean === "4326") return 4326;
    const matches = clean.match(/AUTHORITY\[\s*"EPSG"\s*,\s*"?(\d+)"?\s*\]/gi);
    if (!matches || matches.length === 0) return null;
    const lastMatch = matches[matches.length - 1];
    const numMatch = lastMatch.match(/\d+/);
    return numMatch ? Number(numMatch[0]) : null;
  }

  /**
   * Static helper for direct conversion without manual instantiation.
   */
  public static createConverter(prjText?: string | null): CoordinateTransformFn | null {
    return ProjectionEngine.getInstance().getConverter(prjText);
  }
}

/** Convenience export for backwards compatibility */
export const createProjectionConverter = ProjectionEngine.createConverter;
