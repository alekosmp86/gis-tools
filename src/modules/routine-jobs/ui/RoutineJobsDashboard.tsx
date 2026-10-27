"use client";

import React, { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { ToolWorkspaceLayout } from "@/ui-kit/components/layout/ToolWorkspaceLayout";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import { MonthlyCartoUpdate } from "./MonthlyCartoUpdate";
import { MONTHLY_CARTO_JOB_ID, ROUTINE_JOBS } from "./jobs";
import styles from "./RoutineJobsDashboard.module.css";

const PAGE_TITLE = "Trabajos de rutina";
const PAGE_DESCRIPTION =
  "Trabajos de base de datos que se repiten. Elija un trabajo, siga sus pasos y revise el informe al terminar.";
const OPEN_LABEL = "Abrir";
const BACK_TO_LIST_LABEL = "Volver a la lista";
const NO_JOB = "";

/** The wizard behind each job id. A job without an entry here shows only its list row. */
const JOB_VIEWS: Partial<Record<string, React.FC>> = {
  [MONTHLY_CARTO_JOB_ID]: MonthlyCartoUpdate,
};

export interface RoutineJobsDashboardProps {
  selectedJobId?: string;
}

export const RoutineJobsDashboard: React.FC<RoutineJobsDashboardProps> = ({ selectedJobId = NO_JOB }) => {
  const [openedJobId, setOpenedJobId] = useState(selectedJobId);
  const openedJob = ROUTINE_JOBS.find((job) => job.id === openedJobId);
  const JobView = openedJob ? JOB_VIEWS[openedJob.id] : undefined;

  return (
    <ToolWorkspaceLayout title={PAGE_TITLE} description={PAGE_DESCRIPTION}>
      {openedJob && JobView ? (
        <section className={`glass-panel ${styles.jobPanel}`}>
          <div className={styles.jobHeader}>
            <h2 className={styles.jobTitle}>{openedJob.title}</h2>
            <Button variant={ButtonVariant.SECONDARY} onClick={() => setOpenedJobId(NO_JOB)}>
              <ArrowLeft size={15} />
              <span>{BACK_TO_LIST_LABEL}</span>
            </Button>
          </div>
          <JobView />
        </section>
      ) : (
        <section className={styles.jobList}>
          {ROUTINE_JOBS.map((job) => (
            <article key={job.id} className={`glass-panel ${styles.jobCard}`}>
              <h2 className={styles.jobTitle}>{job.title}</h2>
              <p className={styles.jobDescription}>{job.description}</p>
              <div className={styles.jobActions}>
                <Button onClick={() => setOpenedJobId(job.id)}>
                  <span>{OPEN_LABEL}</span>
                </Button>
              </div>
            </article>
          ))}
        </section>
      )}
    </ToolWorkspaceLayout>
  );
};
