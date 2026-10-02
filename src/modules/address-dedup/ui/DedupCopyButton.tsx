"use client";

import React, { useState } from "react";
import { Check, Copy } from "lucide-react";
import styles from "./DedupCopyButton.module.css";

interface DedupCopyButtonProps {
  value: string;
}

/** The "copied" tick clears when the pointer or focus leaves, so no timer is needed. */
export const DedupCopyButton: React.FC<DedupCopyButtonProps> = ({ value }) => {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(value).then(() => setIsCopied(true));
  };

  return (
    <button
      type="button"
      className={styles.button}
      aria-label={isCopied ? "URN copiado" : "Copiar URN"}
      title={isCopied ? "Copiado" : "Copiar URN"}
      onClick={handleCopy}
      onBlur={() => setIsCopied(false)}
      onMouseLeave={() => setIsCopied(false)}
    >
      {isCopied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
};
