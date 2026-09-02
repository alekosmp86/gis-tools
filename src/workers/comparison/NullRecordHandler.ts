import { DiscrepancyType } from "@/types/comparison";
import type { DiscrepancyItem } from "@/types/comparison";
import type { BinaryDbfReader } from "@/utils/binary/BinaryDbfReader";
import type { BinaryShpReader } from "@/utils/binary/BinaryShpReader";

/**
 * NullRecordHandler
 * Object-Oriented Domain Service for inspecting and isolating null and empty SUID features.
 */
export class NullRecordHandler {
  public processDbfNulls(
    nullRecordIndices: number[],
    dbfReader: BinaryDbfReader,
    shpReader?: BinaryShpReader,
    transformCoordinate?: ((coord: [number, number]) => [number, number]) | null
  ): DiscrepancyItem[] {
    const items: DiscrepancyItem[] = [];

    for (let index = 0; index < nullRecordIndices.length; index++) {
      const recordIndex = nullRecordIndices[index];
      const fileRec = dbfReader.readRecord(recordIndex) || {};
      const fileGeom = shpReader
        ? shpReader.readGeometry(recordIndex, transformCoordinate)
        : undefined;

      items.push({
        id: `file-null-${recordIndex}`,
        suid: "(Vacío / Nulo)",
        type: DiscrepancyType.NULL_SUID,
        differences: [],
        shpFeatureProps: fileRec,
        shpGeometry: fileGeom || undefined,
        note: "El registro en el archivo no posee un valor válido para la columna SUID",
      });
    }

    return items;
  }

  public processObjectNulls(
    nullFileFeatures: Record<string, unknown>[]
  ): DiscrepancyItem[] {
    const items: DiscrepancyItem[] = [];

    for (let index = 0; index < nullFileFeatures.length; index++) {
      const fileRec = nullFileFeatures[index];
      const fileGeom = fileRec._geometry;

      items.push({
        id: `file-null-${index}`,
        suid: "(Vacío / Nulo)",
        type: DiscrepancyType.NULL_SUID,
        differences: [],
        shpFeatureProps: fileRec,
        shpGeometry: fileGeom,
        note: "El registro en el archivo no posee un valor válido para la columna SUID",
      });
    }

    return items;
  }
}
