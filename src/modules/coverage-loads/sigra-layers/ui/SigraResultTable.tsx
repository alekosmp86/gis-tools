"use client";

import React from "react";
import type { LayerLoadResult } from "../types";
import { SigraResultRow } from "./SigraResultRow";
import shared from "./SigraShared.module.css";
import styles from "./SigraResultTable.module.css";

interface SigraResultTableProps {
  results: ReadonlyArray<LayerLoadResult>;
  dryRun: boolean;
}

const DRY_RUN_TITLE = "Prueba sin guardar";
const LOAD_TITLE = "Resultado de la carga";
const DRY_RUN_NOTE =
  "No se guardó nada. En una carga real, cada tabla quedaría con sus registros «válidos»; los «repetidos» son registros de SIGRA con un id ya cargado (se descarta el repetido, como hacía el job anterior).";

/** What the last run did per layer; a dry run is headed as such because nothing was saved. */
export const SigraResultTable: React.FC<SigraResultTableProps> = ({ results, dryRun }) => {
  if (results.length === 0) return null;

  return (
    <section>
      <h3 className={styles.title}>{dryRun ? DRY_RUN_TITLE : LOAD_TITLE}</h3>
      {dryRun && <p className={shared.hint}>{DRY_RUN_NOTE}</p>}
      <table className={shared.table}>
        <thead>
          <tr>
            <th scope="col">Capa</th>
            <th scope="col">Estado</th>
            <th scope="col" className={shared.numeric}>Recibidos de SIGRA</th>
            <th scope="col" className={shared.numeric}>Válidos (sin repetir)</th>
            <th scope="col" className={shared.numeric}>Repetidos descartados</th>
            <th scope="col" className={shared.numeric}>Tabla antes</th>
            <th scope="col" className={shared.numeric}>{dryRun ? "Tabla (sin cambios)" : "Tabla ahora"}</th>
            <th scope="col" className={shared.numeric}>{dryRun ? "Variación (estimada)" : "Variación"}</th>
            <th scope="col">Detalle</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result) => (
            <SigraResultRow key={result.layerId} result={result} dryRun={dryRun} />
          ))}
        </tbody>
      </table>
    </section>
  );
};
