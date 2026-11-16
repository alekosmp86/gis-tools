import React from "react";
import { SectionTitle } from "./ReportParts";
import type { RefreshSuggestionView } from "./refreshSuggestionView";
import sharedStyles from "./CargarPadronesReport.module.css";
import styles from "./RefreshSuggestion.module.css";

const SUGGESTION_TITLE = "Siguiente paso sugerido";

export const RefreshSuggestion: React.FC<{ suggestion: RefreshSuggestionView }> = ({ suggestion }) => (
  <section className={sharedStyles.section}>
    <SectionTitle>{SUGGESTION_TITLE}</SectionTitle>
    <div className={styles.suggestion}>
      <p className={styles.text}>{suggestion.text}</p>
      <pre className={styles.statement}>
        <code>{suggestion.statement}</code>
      </pre>
    </div>
  </section>
);
