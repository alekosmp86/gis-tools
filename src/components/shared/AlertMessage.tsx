import React from "react";
import { CheckCircle2, AlertCircle, Info, AlertTriangle } from "lucide-react";
import { AlertType, type AlertMessageProps } from "@/types/ui";
import styles from "./AlertMessage.module.css";

export const AlertMessage: React.FC<AlertMessageProps> = ({
  type,
  text,
  className = "",
}) => {
  const isSuccess = type === AlertType.SUCCESS;
  const isError = type === AlertType.ERROR;
  const isWarning = type === AlertType.WARNING;

  const alertClass = isSuccess
    ? styles.alertSuccess
    : isError
    ? styles.alertError
    : isWarning
    ? styles.alertWarning
    : styles.alertInfo;

  const Icon = isSuccess
    ? CheckCircle2
    : isError
    ? AlertCircle
    : isWarning
    ? AlertTriangle
    : Info;

  return (
    <div className={`${styles.alert} ${alertClass} ${className}`}>
      <Icon size={18} className={styles.alertIcon} />
      <span className={styles.alertText}>{text}</span>
    </div>
  );
};
