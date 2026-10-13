"use client";

import React from "react";
import { Download } from "lucide-react";
import { logDownloadUrl } from "./shpClient";
import styles from "./ShpLogTail.module.css";

interface ShpLogTailProps {
  jobId: string;
  tail: string;
}

const EMPTY_LOG = "Todavía no hay mensajes en el registro.";

export const ShpLogTail: React.FC<ShpLogTailProps> = ({ jobId, tail }) => (
  <div>
    <div className={styles.header}>
      <span>Registro de la carga</span>
      <a className={styles.download} href={logDownloadUrl(jobId)} download>
        <Download size={14} />
        Descargar registro
      </a>
    </div>
    <pre className={styles.log} aria-label="Últimas líneas del registro">
      {tail.trim().length > 0 ? tail : EMPTY_LOG}
    </pre>
  </div>
);
