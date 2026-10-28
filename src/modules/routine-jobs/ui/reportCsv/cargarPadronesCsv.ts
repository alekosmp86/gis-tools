import type { CargarPadronesResult } from "../../jobs/cargar-padrones/types";
import { countCsvOf } from "./reportCsvRows";

export const buildCargarPadronesCsv = (result: CargarPadronesResult): string =>
  countCsvOf([
    { label: "Padrones rurales insertados", value: result.report.rural.inserted },
    { label: "Padrones urbanos insertados", value: result.report.urbano.inserted },
    { label: "Total insertados", value: result.totals.inserted },
  ]);
