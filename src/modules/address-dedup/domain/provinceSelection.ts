import type { DbConfig } from "@/core/types/db";
import type { ConnectionPayload, ProvinceOption } from "../types";

export const MISSING_PROVINCE_MESSAGE = "Seleccione un departamento.";

/** The select holds the id as text; `""` is "nothing selected". */
export function parseProvinceId(text: string): number | null {
  const provinceId = Number(text);
  return text !== "" && Number.isInteger(provinceId) && provinceId > 0 ? provinceId : null;
}

/** A selection is only valid while its id is in the list currently loaded. */
export function isProvinceLoaded(
  provinces: ReadonlyArray<ProvinceOption>,
  provinceId: number
): boolean {
  return provinces.some((province) => province.id === provinceId);
}

export function findProvinceName(
  provinces: ReadonlyArray<ProvinceOption>,
  provinceId: number
): string | undefined {
  return provinces.find((province) => province.id === provinceId)?.name;
}

/** The departamentos can only be listed once the database, the user and the password are known. */
export function canLoadProvinces(config: DbConfig): boolean {
  return (
    config.db_name.trim() !== "" && config.user.trim() !== "" && (config.password ?? "") !== ""
  );
}

export function toConnectionPayload(config: DbConfig): ConnectionPayload {
  return {
    host: config.host,
    port: config.port,
    db_name: config.db_name,
    user: config.user,
    password: config.password ?? "",
  };
}
