"use client";

import React from "react";
import { CENTROS_STAGING_NOTE, CENTROS_WFS_URL } from "../../jobs/centros-anep/constants";
import styles from "./CentrosAnepStagingNote.module.css";

export const CentrosAnepStagingNote: React.FC = () => (
  <p className={styles.note}>
    <span>{`${CENTROS_STAGING_NOTE}:`}</span>
    <a className={styles.url} href={CENTROS_WFS_URL} target="_blank" rel="noopener noreferrer">
      {CENTROS_WFS_URL}
    </a>
  </p>
);
