import { AUDIT_TABLE } from "../../constants";
import { quoteQualified } from "./identifiers";

const AUDIT = quoteQualified(AUDIT_TABLE);

export const AUDIT_START_SQL = `INSERT INTO ${AUDIT} ("etl_nombre", "estado") VALUES ($1::text, $2::text) RETURNING "id_auditoria"`;

export const AUDIT_FINISH_SQL = `UPDATE ${AUDIT}
SET "estado" = $1::text,
    "fecha_fin" = now(),
    "registros_extraidos" = $2::integer,
    "registros_insertados" = $3::integer,
    "paso_error" = $4::text,
    "mensaje_error" = $5::text,
    "transform_error" = $6::text
WHERE "id_auditoria" = $7::integer`;
