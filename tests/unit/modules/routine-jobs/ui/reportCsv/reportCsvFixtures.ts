import type { ActualizarPadronResult, CollidingKey, SkippedLocalityGroup, SkippedSample } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import { SKIP_REASON } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import { LOCALITY_SKIP_REASON } from "@/modules/routine-jobs/jobs/cargar-localidades/constants";
import type {
  CargarLocalidadesResult,
  GeometryChange,
  LocalitySkippedSample,
  TargetReport,
} from "@/modules/routine-jobs/jobs/cargar-localidades/types";
import type { CargarPadronesResult, TypeReport } from "@/modules/routine-jobs/jobs/cargar-padrones/types";
import { UNIT_SKIP_REASON } from "@/modules/routine-jobs/jobs/unidad-territorial/constants";
import type {
  UnitGeometryChange,
  UnitResult,
  UnitSkippedSample,
  UnitTargetReport,
} from "@/modules/routine-jobs/jobs/unidad-territorial/types";

export const BOM = "\uFEFF";

export function parseCsv(csv: string): string[][] {
  const body = csv.startsWith(BOM) ? csv.slice(BOM.length) : csv;
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;

  const endField = (): void => {
    record.push(field);
    field = "";
  };
  const endRecord = (): void => {
    endField();
    records.push(record);
    record = [];
  };

  let index = 0;
  while (index < body.length) {
    const character = body.charAt(index);
    const nextCharacter = body.charAt(index + 1);
    if (inQuotes) {
      if (character === '"' && nextCharacter === '"') {
        field += '"';
        index += 2;
        continue;
      }
      if (character === '"') {
        inQuotes = false;
      } else {
        field += character;
      }
      index += 1;
      continue;
    }
    if (character === '"') {
      inQuotes = true;
    } else if (character === ",") {
      endField();
    } else if (character === "\r" && nextCharacter === "\n") {
      endRecord();
      index += 1;
    } else if (character === "\n") {
      endRecord();
    } else {
      field += character;
    }
    index += 1;
  }
  if (field !== "" || record.length > 0) endRecord();
  return records;
}


function typeReportOf(base: number, overrides: Partial<TypeReport> = {}): TypeReport {
  return {
    rowsRead: base + 1,
    groups: base + 2,
    rowsMerged: base + 3,
    repaired: base + 4,
    insertedInvalid: 0,
    repairedInUnion: 0,
    noGeometry: base + 5,
    nullKeyRows: base + 6,
    attributeConflicts: 0,
    attributeConflictSamples: [],
    inserted: base + 7,
    ...overrides,
  };
}

export function cargarPadronesResultOf(overrides: Partial<CargarPadronesResult> = {}): CargarPadronesResult {
  return {
    dryRun: false,
    targetModified: true,
    outcomeUnknown: false,
    report: { rural: typeReportOf(100), urbano: typeReportOf(200) },
    totals: { rowsRead: 301, groups: 302, rowsMerged: 303, inserted: 304 },
    ambiguousLocalityCodes: [],
    warnings: ["Hay 2 filas sin clave.", "Se detectaron conflictos."],
    stepTimings: [
      { label: "Leer rurales", ms: 2000 },
      { label: "Insertar destino", ms: 1500 },
    ],
    analyze: { status: "ok" },
    ...overrides,
  };
}

function localitySkippedSamplesOf(count: number): LocalitySkippedSample[] {
  return Array.from({ length: count }, (_, index) => ({
    department: "CHACO",
    locality: `Localidad omitida ${index}`,
    code: `O${index}`,
    reason: index % 2 === 0 ? LOCALITY_SKIP_REASON.SIN_GEOMETRIA : LOCALITY_SKIP_REASON.CODIGO_NULO,
  }));
}

export function targetReportOf(table: string, overrides: Partial<TargetReport> = {}): TargetReport {
  return {
    table,
    inserted: 0,
    insertedList: [],
    updated: 0,
    updateApplied: true,
    unchanged: 0,
    unchangedWithinTolerance: 0,
    changed: 0,
    missing: 0,
    missingSamples: [],
    ambiguous: 0,
    ambiguousSamples: [],
    codeDiffers: 0,
    codeDiffersSamples: [],
    geometryChanges: [],
    ...overrides,
  };
}

function insertedLocalitiesOf(count: number): TargetReport["insertedList"] {
  return Array.from({ length: count }, (_, index) =>
    index === 0
      ? { department: "SANTA CRUZ", name: 'Villa "Los Pinos", norte', id: 9001 }
      : { department: "CORDOBA", name: `Localidad nueva ${index}`, id: 9000 + index },
  );
}

function geometryChangesOf(count: number): GeometryChange[] {
  return Array.from({ length: count }, (_, index) =>
    index === 0
      ? { department: "JUJUY", name: "Geometría cambia uno", distance: 12.5, areaRatio: 1.25 }
      : { department: "JUJUY", name: `Geometría cambia ${index}`, distance: 3, areaRatio: 0.5 },
  );
}

export function cargarLocalidadesResultOf(overrides: Partial<CargarLocalidadesResult> = {}): CargarLocalidadesResult {
  return {
    dryRun: false,
    targetsModified: true,
    outcomeUnknown: false,
    totals: { rowsRead: 500, groups: 480, repaired: 3, candidates: 450, skipped: 50 },
    skipped: {
      [LOCALITY_SKIP_REASON.SIN_GEOMETRIA]: 7,
      [LOCALITY_SKIP_REASON.PROVINCIA_NO_ENCONTRADA]: 4,
      [LOCALITY_SKIP_REASON.PROVINCIA_AMBIGUA]: 0,
      [LOCALITY_SKIP_REASON.CODIGO_NULO]: 2,
      [LOCALITY_SKIP_REASON.CLAVE_DUPLICADA]: 9,
      samples: localitySkippedSamplesOf(25),
    },
    targets: [
      targetReportOf("localidades_norte", {
        inserted: 25,
        insertedList: insertedLocalitiesOf(25),
        changed: 25,
        unchanged: 10,
        unchangedWithinTolerance: 3,
        missing: 1,
        missingSamples: [{ department: "JUJUY", name: "Faltante uno" }],
        ambiguous: 1,
        ambiguousSamples: [{ department: "SALTA", name: "Ambigua uno" }],
        codeDiffers: 1,
        codeDiffersSamples: [{ department: "SALTA", name: "Código distinto uno", code: "0101", targetCode: "0199" }],
        geometryChanges: geometryChangesOf(25),
      }),
      targetReportOf("localidades_sur", {
        updated: 1,
        updateApplied: false,
        changed: 1,
        unchanged: 5,
        geometryChanges: [{ department: "MENDOZA", name: "Sur geom", distance: 7.75, areaRatio: 2 }],
      }),
    ],
    warnings: ["Hay 50 filas de origen omitidas.", "Advertencia de prueba."],
    stepTimings: [
      { label: "Leer origen", ms: 4000 },
      { label: "Aplicar destino", ms: 500 },
    ],
    ...overrides,
  };
}

function unitSkippedSamplesOf(count: number): UnitSkippedSample[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `Unidad omitida ${index}`,
    provinceId: "09",
    reason: index % 2 === 0 ? UNIT_SKIP_REASON.CLAVE_DUPLICADA : UNIT_SKIP_REASON.NOMBRE_NULO,
  }));
}

function unitGeometryChangesOf(count: number): UnitGeometryChange[] {
  return Array.from({ length: count }, (_, index) =>
    index === 0
      ? { provinceId: "02", name: "Unidad geom uno", distance: 4.5, areaRatio: 1.1 }
      : { provinceId: "03", name: `Unidad geom ${index}`, distance: 0.25, areaRatio: 0.9 },
  );
}

export function unitTargetReportOf(overrides: Partial<UnitTargetReport> = {}): UnitTargetReport {
  return {
    table: "unidades_destino",
    inserted: 25,
    insertedList: Array.from({ length: 25 }, (_, index) =>
      index === 0
        ? { provinceId: "02", name: 'Unidad "Centro", norte', id: 7001 }
        : { provinceId: "02", name: `Unidad nueva ${index}`, id: 7000 + index },
    ),
    updated: 3,
    updateApplied: true,
    unchanged: 6,
    unchangedWithinTolerance: 2,
    changed: 25,
    fontDiffers: 4,
    missing: 1,
    missingSamples: [{ provinceId: "05", name: "Unidad faltante" }],
    ambiguous: 1,
    ambiguousSamples: [{ provinceId: "05", name: "Unidad ambigua" }],
    geometryChanges: unitGeometryChangesOf(25),
    ...overrides,
  };
}

export function unitResultOf(overrides: Partial<UnitResult> = {}): UnitResult {
  return {
    dryRun: false,
    targetModified: true,
    outcomeUnknown: false,
    totals: { rowsRead: 400, candidates: 380, skipped: 20 },
    skipped: {
      [UNIT_SKIP_REASON.NOMBRE_NULO]: 3,
      [UNIT_SKIP_REASON.PROVINCIA_NULA]: 0,
      [UNIT_SKIP_REASON.FUENTE_NULA]: 4,
      [UNIT_SKIP_REASON.SIN_GEOMETRIA]: 2,
      [UNIT_SKIP_REASON.CLAVE_DUPLICADA]: 11,
      samples: unitSkippedSamplesOf(25),
    },
    target: unitTargetReportOf(),
    warnings: ["Advertencia unidad uno."],
    stepTimings: [{ label: "Leer localidades", ms: 3000 }],
    ...overrides,
  };
}

const groupsOf = (prefix: string, count: number): { name: string; count: number }[] =>
  Array.from({ length: count }, (_, index) => ({ name: `${prefix} ${index}`, count: count - index }));

const localityGroupsOf = (count: number): SkippedLocalityGroup[] => [
  ...Array.from({ length: count }, (_, index) => ({
    department: `DEP ${index}`,
    locality: `LOC NO ${index}`,
    reason: SKIP_REASON.LOCALIDAD_NO_ENCONTRADA,
    count: index + 1,
  })),
  ...Array.from({ length: count }, (_, index) => ({
    department: `DEP AMB ${index}`,
    locality: `LOC AMB ${index}`,
    reason: SKIP_REASON.LOCALIDAD_AMBIGUA,
    count: 2,
  })),
];

const actualizarSamplesOf = (count: number): SkippedSample[] =>
  Array.from({ length: count }, (_, index) => ({
    department: `DEP ${index}`,
    locality: `LOC ${index}`,
    padron: `P${index}`,
    reason: SKIP_REASON.LOCALIDAD_NO_ENCONTRADA,
  }));

const collidingKeysOf = (count: number): CollidingKey[] =>
  Array.from({ length: count }, (_, index) => ({
    typePadron: "URBANO",
    idProvince: 2,
    idCadastralLocality: 7,
    number: `N${index}`,
    rows: 2,
  }));

export function actualizarPadronResultOf(overrides: Partial<ActualizarPadronResult> = {}): ActualizarPadronResult {
  return {
    dryRun: false,
    tempModified: true,
    padronModified: false,
    outcomeUnknown: false,
    totals: { rowsRead: 1000, accepted: 950, written: 940, repaired: 4, skipped: 60 },
    skipped: {
      byReason: {
        [SKIP_REASON.PROVINCIA_NO_ENCONTRADA]: 0,
        [SKIP_REASON.PROVINCIA_AMBIGUA]: 2,
        [SKIP_REASON.LOCALIDAD_NO_ENCONTRADA]: 20,
        [SKIP_REASON.LOCALIDAD_AMBIGUA]: 3,
        [SKIP_REASON.CLAVE_NULA]: 5,
        [SKIP_REASON.SIN_GEOMETRIA]: 10,
        [SKIP_REASON.CLAVE_DUPLICADA]: 15,
      },
      byDepartment: groupsOf("DEPARTAMENTO", 25),
      byLocality: groupsOf("Localidad", 25),
      byLocalityAndReason: localityGroupsOf(25),
      samples: actualizarSamplesOf(25),
      collidingKeys: collidingKeysOf(25),
      collidingKeyCount: 25,
    },
    warnings: ["Advertencia de padrón."],
    stepTimings: [
      { label: "Cargar tabla de trabajo", ms: 1234 },
      { label: "Analizar tabla de trabajo", ms: 2000 },
    ],
    analyze: { status: "ok" },
    ...overrides,
  };
}
