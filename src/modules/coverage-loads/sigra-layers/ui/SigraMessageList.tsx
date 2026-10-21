"use client";

import React from "react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import type { AlertType } from "@/ui-kit/types/ui";
import shared from "./SigraShared.module.css";

interface SigraMessageListProps {
  messages: ReadonlyArray<string>;
  type: AlertType;
}

/** Blockers (errors) or warnings of the plan; duplicates are shown once. */
export const SigraMessageList: React.FC<SigraMessageListProps> = ({ messages, type }) => {
  const uniqueMessages = Array.from(new Set(messages));
  if (uniqueMessages.length === 0) return null;

  return (
    <div className={shared.stack}>
      {uniqueMessages.map((message) => (
        <AlertMessage key={message} type={type} text={message} />
      ))}
    </div>
  );
};
