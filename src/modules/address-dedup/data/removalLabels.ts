import { RemovalBlockReason, RemovalTable } from "../removalConstants";

export const REMOVAL_LABELS = {
  PANEL_TITLE: "Eliminación confirmada",
  PANEL_DESCRIPTION:
    "Elimina de la base de datos solo las filas con decisión Eliminar, recalculadas en el momento de la baja. Las filas para revisar (con unidades internas o conservadas junto a una fuente protegida) no se tocan.",
  OPEN_BUTTON: "Confirmar y eliminar",
  NOTHING_TO_REMOVE: "El análisis no tiene filas a eliminar.",
  DIALOG_TITLE: "Confirmar y eliminar duplicados",
  CLOSE_BUTTON: "Cerrar",
  RESPONSABLE_LABEL: "Responsable",
  RESPONSABLE_PLACEHOLDER: "Quién autoriza la baja",
  MOTIVO_LABEL: "Motivo",
  MOTIVO_PLACEHOLDER: "Por qué se eliminan (ticket, procedimiento)",
  FORM_NOTE:
    "Primero se simula: nada se elimina hasta que revise el plan y confirme en un segundo paso.",
  SIMULATE_BUTTON: "Simular baja",
  SIMULATING_BUTTON: "Simulando...",
  PLAN_TITLE: "Plan de baja",
  PLAN_TOTAL: "Direcciones a eliminar",
  PLAN_BY_FUENTE: "Por fuente",
  PLAN_BY_TABLE: "Filas por tabla",
  TARGETS_TITLE: "URN a eliminar",
  TARGETS_LIST_LABEL: "Lista de URN a eliminar",
  TARGETS_COPY_BUTTON: "Copiar URN",
  TARGETS_COPIED_BUTTON: "URN copiados",
  TARGETS_DOWNLOAD_BUTTON: "Descargar CSV",
  PLAN_FINGERPRINT: "Huella de la simulación",
  PLAN_BLOCKED: "La baja está detenida: estas direcciones no pueden eliminarse. No se eliminará nada hasta resolverlas.",
  PLAN_EMPTY: "La simulación no encontró direcciones a eliminar.",
  BACK_BUTTON: "Volver a simular",
  EXECUTE_BUTTON: "Ejecutar eliminación",
  EXECUTING_BUTTON: "Eliminando...",
  RESULT_TITLE: "Baja ejecutada",
  RESULT_RECOVERED: "Esta operación ya se había ejecutado; se muestra el resultado guardado y no se eliminó nada nuevo.",
  RESULT_OPERATION: "Operación",
  RESULT_DELETED: "Filas eliminadas por tabla",
  RESULT_STALE: "El análisis mostrado ya no refleja la base de datos. Vuelva a ejecutarlo.",
  REMINDER_TITLE: "Pasos manuales pendientes",
  REMINDER_BODY:
    "Esta herramienta no retira las URN del índice Solr ni refresca las vistas materializadas: son pasos manuales aparte.",
  NO_FUENTE: "Sin fuente",
  NO_URN: "(sin URN)",
} as const;

export const REMOVAL_TABLE_LABELS: Readonly<Record<RemovalTable, string>> = {
  [RemovalTable.INTERNAL_ADDRESS_ACCESS_POINT]: "Relaciones con internas",
  [RemovalTable.TERRITORIAL_UNIT_ACCESS_POINT]: "Unidades territoriales",
  [RemovalTable.COMPACT_ADDRESS]: "Direcciones compactas",
  [RemovalTable.INTERNAL_ADDRESS]: "Direcciones internas",
  [RemovalTable.ACCESS_POINT]: "Puertas",
  [RemovalTable.ADDRESS]: "Direcciones",
  [RemovalTable.ADDRESSES_MASTER]: "Maestros de dirección",
};

export const BLOCK_REASON_LABELS: Readonly<Record<RemovalBlockReason, string>> = {
  [RemovalBlockReason.URN_BLANK]: "La URN está vacía",
  [RemovalBlockReason.URN_NOT_FOUND]: "La URN no resuelve a una dirección y un maestro completos",
  [RemovalBlockReason.URN_AMBIGUOUS]: "La URN resuelve a más de un maestro o dirección",
  [RemovalBlockReason.MASTER_SHARED]: "El maestro lo comparte otra dirección",
  [RemovalBlockReason.NOT_A_DOOR]: "No es una puerta",
  [RemovalBlockReason.IS_INTERNAL]: "También es una dirección interna",
  [RemovalBlockReason.HAS_INTERNAL_UNITS]: "Tiene unidades internas asociadas",
  [RemovalBlockReason.LINKED_AS_INTERNAL]: "Figura como interna de otra puerta",
  [RemovalBlockReason.MASTER_REFERENCED]: "Otra tabla referencia su maestro",
};
