"use client";

/**
 * Icons a contribution hands to the host chrome.
 *
 * The manifest is evaluated on the server, so a component referenced from it must be a client
 * reference or React cannot pass it across the boundary — the same reason `Component` points at a
 * `"use client"` module. Re-exporting the icon here makes it one.
 */
export { FolderTree as CatalogTabIcon } from "lucide-react";
