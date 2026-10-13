"use client";

import React from "react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { AlertType } from "@/ui-kit/types/ui";
import shared from "./IndicatorsShared.module.css";

interface IndicatorsProblemListProps {
  messages: ReadonlyArray<string>;
}

/** Messages that stop the load: file-level errors, missing privileges, nothing to load. */
export const IndicatorsProblemList: React.FC<IndicatorsProblemListProps> = ({ messages }) => {
  const uniqueMessages = Array.from(new Set(messages));
  if (uniqueMessages.length === 0) return null;

  return (
    <div className={shared.stack}>
      {uniqueMessages.map((message) => (
        <AlertMessage key={message} type={AlertType.ERROR} text={message} />
      ))}
    </div>
  );
};
