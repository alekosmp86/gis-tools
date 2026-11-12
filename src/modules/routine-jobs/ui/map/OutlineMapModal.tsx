"use client";

import React from "react";
import { Modal } from "@/ui-kit/components/Modal";
import { ReviewNavigation } from "./ReviewNavigation";

export interface OutlineMapNavigation {
  index: number;
  total: number;
  onNavigate: (index: number) => void;
}

export interface OutlineMapModalProps {
  title: string;
  navigation: OutlineMapNavigation;
  onClose: () => void;
  children: React.ReactNode;
}

/** The dialog of a map: its title, the way to the previous and next rows of the table it was opened from, and the map body. */
export function OutlineMapModal({ title, navigation, onClose, children }: OutlineMapModalProps) {
  return (
    <Modal title={title} onClose={onClose}>
      <ReviewNavigation index={navigation.index} total={navigation.total} onNavigate={navigation.onNavigate} />
      {children}
    </Modal>
  );
}
