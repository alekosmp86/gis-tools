export interface GpkgLayerInfo {
  readonly name: string;
  readonly geometryColumn: string;
  readonly srid: number | null;
  readonly rowCount: number;
  readonly fieldNames: string[];
}
