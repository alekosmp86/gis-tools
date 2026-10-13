import { notificationBody, notificationTitle, stripProgressPrefix, titleWithProgress } from "../domain/shpAttention";
import type { JobStatus } from "../job/types.ts";
import { SHP_ACTIVE_JOB_STORAGE_KEY, SHP_NOTIFIED_JOB_STORAGE_KEY } from "./shpUiConstants";

export const NotificationAccess = {
  GRANTED: "granted",
  DENIED: "denied",
  DEFAULT: "default",
  UNSUPPORTED: "unsupported",
} as const;

export type NotificationAccess = (typeof NotificationAccess)[keyof typeof NotificationAccess];

export function notificationAccess(): NotificationAccess {
  return typeof Notification === "undefined" ? NotificationAccess.UNSUPPORTED : Notification.permission;
}

/** Must be called from a user gesture: browsers refuse (or ignore) a permission prompt raised on load. */
export async function requestNotificationAccess(): Promise<NotificationAccess> {
  if (typeof Notification === "undefined") return NotificationAccess.UNSUPPORTED;
  return Notification.requestPermission();
}

export function showFinishedNotification(status: JobStatus): void {
  if (notificationAccess() !== NotificationAccess.GRANTED) return;
  try {
    new Notification(notificationTitle(status), { body: notificationBody(status) });
  } catch {
    // Some mobile browsers only allow notifications through a service worker; the tab title still tells.
  }
}

/** A null percent restores the title the page had before. */
export function setTabProgress(percent: number | null): void {
  document.title = percent === null ? stripProgressPrefix(document.title) : titleWithProgress(document.title, percent);
}

function readKey(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeKey(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage disabled or full: the chip simply does not appear.
  }
}

export const activeJobMemory = {
  read: () => readKey(SHP_ACTIVE_JOB_STORAGE_KEY),
  remember: (jobId: string) => writeKey(SHP_ACTIVE_JOB_STORAGE_KEY, jobId),
  forget: () => writeKey(SHP_ACTIVE_JOB_STORAGE_KEY, null),
  wasNotified: (jobId: string) => readKey(SHP_NOTIFIED_JOB_STORAGE_KEY) === jobId,
  markNotified: (jobId: string) => writeKey(SHP_NOTIFIED_JOB_STORAGE_KEY, jobId),
};
