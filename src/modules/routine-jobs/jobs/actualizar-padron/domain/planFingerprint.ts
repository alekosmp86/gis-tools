import { createHash } from "node:crypto";
import type { AcceptedGeometry, ActualizarPadronParams, PairChoice } from "../types";

const canonicalChoiceOf = (choice: PairChoice): PairChoice => ({
  typePadron: choice.typePadron,
  provinceId: choice.provinceId,
  localityId: choice.localityId,
  number: choice.number,
  oldId: choice.oldId,
});

/** Sorted, so the order of the choices in the request never changes the fingerprint. */
const canonicalChoicesOf = (choices: readonly PairChoice[]): string[] =>
  choices.map((choice) => JSON.stringify(canonicalChoiceOf(choice))).sort();

const canonicalAcceptsOf = (accepts: readonly AcceptedGeometry[]): string[] =>
  accepts
    .map((accept) => JSON.stringify([accept.typePadron, accept.provinceId, accept.localityId, accept.number]))
    .sort();

/** The request parameters that define the analysis result. The password and the flags that gate the write are not among them. */
export function paramsFingerprintOf(params: ActualizarPadronParams): string {
  const canonical = {
    host: params.config.host.trim().toLowerCase(),
    port: String(params.config.port),
    dbName: params.config.db_name,
    user: params.config.user,
    stagingSchema: params.stagingSchema,
    stagingTable: params.stagingTable,
    cartoSchema: params.cartoSchema,
    targetTable: params.targetTable,
    provinceTable: params.provinceTable,
    localityTable: params.localityTable,
    typeTable: params.typeTable ?? null,
    addressMasterTable: params.addressMasterTable ?? null,
    localityType: params.options.localityType ?? null,
    tolerance: params.options.tolerance,
    geometryAreaThreshold: params.options.geometryAreaThreshold,
    updateGeometries: params.options.updateGeometries,
    linkAddressMaster: params.options.linkAddressMaster,
    pairChoices: canonicalChoicesOf(params.options.pairChoices),
    acceptedGeometries: canonicalAcceptsOf(params.options.acceptedGeometries ?? []),
    acceptAllGeometries: params.options.acceptAllGeometries === true,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
