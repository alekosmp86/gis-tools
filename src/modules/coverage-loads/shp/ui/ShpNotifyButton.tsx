"use client";

import React, { useState } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import { NotificationAccess, notificationAccess, requestNotificationAccess } from "./shpBrowserAlerts";
import styles from "./ShpNotifyButton.module.css";

const GRANTED_TEXT = "Se avisará al terminar la carga.";
const DENIED_TEXT = "Las notificaciones están bloqueadas en este navegador.";

/** Asks for notification permission only when the user clicks: browsers ignore prompts raised on load. */
export const ShpNotifyButton: React.FC = () => {
  const [access, setAccess] = useState(notificationAccess);

  if (access === NotificationAccess.UNSUPPORTED) return null;
  if (access === NotificationAccess.GRANTED) {
    return (
      <span className={styles.note}>
        <BellRing size={15} />
        {GRANTED_TEXT}
      </span>
    );
  }
  if (access === NotificationAccess.DENIED) {
    return (
      <span className={styles.note}>
        <BellOff size={15} />
        {DENIED_TEXT}
      </span>
    );
  }

  return (
    <Button type="button" variant={ButtonVariant.SECONDARY} onClick={() => void requestNotificationAccess().then(setAccess)}>
      <Bell size={15} />
      Avisarme al terminar
    </Button>
  );
};
