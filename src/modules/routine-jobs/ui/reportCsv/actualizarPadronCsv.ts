import type { ActualizarPadronResult } from "../../jobs/actualizar-padron/types";
import { countCsvOf } from "./reportCsvRows";

export const buildActualizarPadronCsv = (result: ActualizarPadronResult): string =>
  countCsvOf([{ label: "Filas escritas", value: result.totals.written }]);
