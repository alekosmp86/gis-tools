import { DeltaStatus } from "../types";
import type { CkanResource, ResourceDelta, VaultResourceMeta } from "../types";

/**
 * Decides whether a remote resource is newer than the copy held in the vault.
 *
 * Three signals, in descending order of trustworthiness: the publisher's checksum, the publication
 * timestamp, then file size. Size is only consulted when neither of the other two is available,
 * because an edit that preserves length is common and would otherwise read as "up to date".
 *
 * Pure: no clock, no disk, no network. The caller supplies both sides of the comparison.
 */

/** Enough of a checksum to identify it in a message without printing the whole thing. */
const HASH_PREVIEW_LENGTH = 8;

function resolveRemoteTimestamp(remote: CkanResource): string | null {
  return remote.last_modified ?? remote.metadata_modified ?? null;
}

function hasChecksumMismatch(remote: CkanResource, localMeta: VaultResourceMeta): boolean {
  return Boolean(remote.hash) && Boolean(localMeta.hash) && remote.hash !== localMeta.hash;
}

function describeChecksumMismatch(
  remote: CkanResource,
  localMeta: VaultResourceMeta
): string {
  const remotePreview = (remote.hash ?? "").slice(0, HASH_PREVIEW_LENGTH);
  const localPreview = localMeta.hash.slice(0, HASH_PREVIEW_LENGTH);
  return `Suma de verificación modificada (remoto ${remotePreview}… contra local ${localPreview}…).`;
}

/** True only when both timestamps parse and the remote one is strictly newer. */
function hasNewerPublication(remoteTimestamp: string, localTimestamp: string): boolean {
  const remoteTime = new Date(remoteTimestamp).getTime();
  const localTime = new Date(localTimestamp).getTime();

  if (Number.isNaN(remoteTime) || Number.isNaN(localTime)) {
    return false;
  }

  return remoteTime > localTime;
}

function hasSizeMismatch(remote: CkanResource, localMeta: VaultResourceMeta): boolean {
  return (
    remote.size !== null &&
    remote.size !== undefined &&
    remote.size !== localMeta.fileSize
  );
}

export function evaluateResourceDelta(
  remote: CkanResource,
  localMeta: VaultResourceMeta | null
): ResourceDelta {
  if (!localMeta) {
    return {
      resource: remote,
      status: DeltaStatus.NOT_DOWNLOADED,
      reason: "El recurso todavía no se descargó al vault local.",
      localMeta: null,
    };
  }

  if (hasChecksumMismatch(remote, localMeta)) {
    return {
      resource: remote,
      status: DeltaStatus.UPDATE_AVAILABLE,
      reason: describeChecksumMismatch(remote, localMeta),
      localMeta,
    };
  }

  // A checksum that matches settles it: the bytes are the same, whatever the metadata says.
  // Publishers touch timestamps without republishing content, and re-fetching a 100 MB file for
  // that is exactly the waste this vault exists to prevent.
  if (remote.hash && localMeta.hash && remote.hash === localMeta.hash) {
    return {
      resource: remote,
      status: DeltaStatus.UP_TO_DATE,
      reason: "La suma de verificación coincide con la copia local.",
      localMeta,
    };
  }

  const remoteTimestamp = resolveRemoteTimestamp(remote);
  if (remoteTimestamp && localMeta.remoteLastModified) {
    if (hasNewerPublication(remoteTimestamp, localMeta.remoteLastModified)) {
      return {
        resource: remote,
        status: DeltaStatus.UPDATE_AVAILABLE,
        reason: `Se publicó una versión más reciente en el catálogo (${remoteTimestamp}).`,
        localMeta,
      };
    }
  }

  // Size is the weakest signal, so it only decides when nothing better was published.
  if (!remote.hash && !remoteTimestamp && hasSizeMismatch(remote, localMeta)) {
    return {
      resource: remote,
      status: DeltaStatus.UPDATE_AVAILABLE,
      reason: `El tamaño del archivo cambió (${remote.size} bytes contra ${localMeta.fileSize} bytes).`,
      localMeta,
    };
  }

  return {
    resource: remote,
    status: DeltaStatus.UP_TO_DATE,
    reason: "Coincide con la última versión descargada.",
    localMeta,
  };
}

/** Everything worth acting on: outdated copies plus resources never downloaded. */
export function countPendingResources(deltas: ReadonlyArray<ResourceDelta>): number {
  return deltas.filter((delta) => delta.status !== DeltaStatus.UP_TO_DATE).length;
}
