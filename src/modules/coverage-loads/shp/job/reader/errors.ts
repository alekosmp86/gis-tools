export class ShapefileReaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ShapefileNotFoundError extends ShapefileReaderError {
  readonly path: string;

  constructor(path: string) {
    super(`No se encontró el archivo shapefile: ${path}`);
    this.path = path;
  }
}

export class ShapefileUnreadableError extends ShapefileReaderError {
  readonly path: string;

  constructor(path: string, detail: string) {
    super(`No se pudo leer el archivo shapefile ${path}: ${detail}`);
    this.path = path;
  }
}

export class NotAShapefileError extends ShapefileReaderError {
  readonly path: string;

  constructor(path: string, detail: string) {
    super(`El archivo no es un shapefile válido (${path}): ${detail}`);
    this.path = path;
  }
}

export class UnsupportedShapeError extends ShapefileReaderError {
  readonly shapeType: number;
  readonly recordNumber: number | null;

  constructor(shapeType: number, recordNumber: number | null) {
    const where = recordNumber === null ? "el encabezado del archivo" : `el registro ${recordNumber}`;
    super(
      `Tipo de geometría no soportado (${shapeType}) en ${where}: solo se admiten polígonos (tipo 5).`,
    );
    this.shapeType = shapeType;
    this.recordNumber = recordNumber;
  }
}

export class CorruptShapefileError extends ShapefileReaderError {
  readonly recordNumber: number | null;

  constructor(detail: string, recordNumber: number | null = null) {
    const where = recordNumber === null ? "" : ` (registro ${recordNumber})`;
    super(`Shapefile truncado o corrupto${where}: ${detail}`);
    this.recordNumber = recordNumber;
  }
}

export class HoleAssignmentError extends ShapefileReaderError {
  readonly recordNumber: number;
  readonly holeCount: number;
  readonly ambiguousCount: number;
  readonly unassignedCount: number;

  constructor(recordNumber: number, holeCount: number, ambiguousCount: number, unassignedCount: number) {
    super(
      `No se pudieron asignar con certeza los huecos del registro ${recordNumber}: ` +
        `${unassignedCount} sin anillo exterior y ${ambiguousCount} ambiguos de ${holeCount} huecos. ` +
        `Se aborta para no perder huecos de la geometría.`,
    );
    this.recordNumber = recordNumber;
    this.holeCount = holeCount;
    this.ambiguousCount = ambiguousCount;
    this.unassignedCount = unassignedCount;
  }
}
