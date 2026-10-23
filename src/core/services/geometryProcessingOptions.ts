import {
  DEFAULT_OVERLAP_MIN_AREA_M2,
  OverlapPolicy,
  type GeometryProcessingOptions,
} from "@/core/types/geometryProcessing";

const MAX_KEY_FIELDS = 20;
const MAX_MIN_AREA_M2 = 1e9;

type RawRecord = Record<string, unknown>;

export class GeometryOptionsInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeometryOptionsInvalidError";
  }
}

function fail(message: string): never {
  throw new GeometryOptionsInvalidError(message);
}

const isPlainRecord = (value: unknown): value is RawRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isOverlapPolicy = (value: unknown): value is OverlapPolicy =>
  Object.values(OverlapPolicy).some((policy) => policy === value);

function readSection(container: RawRecord, name: string): RawRecord | undefined {
  const section = container[name];
  if (section === undefined) {
    return undefined;
  }
  if (!isPlainRecord(section)) {
    fail(`La sección "${name}" debe ser un objeto.`);
  }
  return section;
}

function readEnabled(section: RawRecord | undefined, name: string): boolean {
  if (section === undefined) {
    return false;
  }
  const enabled = section.enabled;
  if (typeof enabled !== "boolean") {
    fail(`"${name}.enabled" debe ser verdadero o falso.`);
  }
  return enabled;
}

function assertKeyFieldName(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail("Cada campo clave debe ser un nombre de campo no vacío.");
  }
  return value;
}

function parseKeyFieldList(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    fail("keyFields debe ser una lista de nombres de campo.");
  }
  const distinctNames = [...new Set(value.map(assertKeyFieldName))];
  if (distinctNames.length > MAX_KEY_FIELDS) {
    fail(`Se admiten como máximo ${MAX_KEY_FIELDS} campos clave.`);
  }
  return distinctNames;
}

function assertKeyFieldsExist(keyFields: readonly string[], fieldNames: readonly string[] | null | undefined): void {
  if (fieldNames === null || fieldNames === undefined) {
    return;
  }
  const knownFields = new Set(fieldNames);
  for (const keyField of keyFields) {
    if (!knownFields.has(keyField)) {
      fail(`El campo clave "${keyField}" no existe en el archivo.`);
    }
  }
}

function assertUnifyKeys(keyFields: readonly string[], fieldNames: readonly string[] | null | undefined): void {
  if (keyFields.length === 0) {
    fail("Unificar por clave requiere al menos un campo clave.");
  }
  assertKeyFieldsExist(keyFields, fieldNames);
}

function parseRepairSection(section: RawRecord | undefined): GeometryProcessingOptions["repair"] {
  return { enabled: readEnabled(section, "repair") };
}

function parseUnifySection(
  section: RawRecord | undefined,
  fieldNames: readonly string[] | null | undefined
): GeometryProcessingOptions["unify"] {
  const enabled = readEnabled(section, "unify");
  const keyFields = parseKeyFieldList(section?.keyFields);
  if (enabled) {
    assertUnifyKeys(keyFields, fieldNames);
  }
  return { enabled, keyFields };
}

function parseOverlapPolicy(value: unknown): OverlapPolicy {
  if (value === undefined) {
    return OverlapPolicy.BLOCK;
  }
  if (!isOverlapPolicy(value)) {
    fail(`La política de solapes debe ser "${OverlapPolicy.BLOCK}" o "${OverlapPolicy.REPORT}".`);
  }
  return value;
}

function parseMinAreaM2(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_OVERLAP_MIN_AREA_M2;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_MIN_AREA_M2) {
    fail(`El área mínima de solape debe estar entre 0 y ${MAX_MIN_AREA_M2} m2.`);
  }
  return value;
}

function parseOverlapsSection(section: RawRecord | undefined): GeometryProcessingOptions["overlaps"] {
  return {
    enabled: readEnabled(section, "overlaps"),
    policy: parseOverlapPolicy(section?.policy),
    minAreaM2: parseMinAreaM2(section?.minAreaM2),
  };
}

export function parseGeometryProcessingOptions(
  raw: unknown,
  fieldNames?: readonly string[] | null
): GeometryProcessingOptions {
  const source = raw === undefined || raw === null ? {} : raw;
  if (!isPlainRecord(source)) {
    fail("Las opciones de procesamiento de geometrías deben ser un objeto.");
  }
  return {
    repair: parseRepairSection(readSection(source, "repair")),
    unify: parseUnifySection(readSection(source, "unify"), fieldNames),
    overlaps: parseOverlapsSection(readSection(source, "overlaps")),
  };
}

export const isProcessingActive = (options: GeometryProcessingOptions): boolean =>
  options.repair.enabled || options.unify.enabled || options.overlaps.enabled;
