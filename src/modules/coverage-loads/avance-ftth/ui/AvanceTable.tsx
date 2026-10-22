"use client";

import React from "react";
import shared from "./AvanceShared.module.css";

interface AvanceTableProps {
  caption: React.ReactNode;
  headers: string[];
  children: React.ReactNode;
}

export const AvanceTable: React.FC<AvanceTableProps> = ({ caption, headers, children }) => (
  <table className={shared.table}>
    <caption>{caption}</caption>
    <thead>
      <tr>
        {headers.map((header) => (
          <th key={header} scope="col">
            {header}
          </th>
        ))}
      </tr>
    </thead>
    <tbody>{children}</tbody>
  </table>
);
