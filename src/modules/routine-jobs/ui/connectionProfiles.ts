import type { SafeDbConfig, SavedDbProfile } from "@/core/types/db";
import type { ClientConnection } from "./clientTypes";

const CONNECTION_FIELDS = ["host", "port", "db_name", "user"] as const;

type ConnectionFieldName = (typeof CONNECTION_FIELDS)[number];
export type ConnectionFields = Pick<SafeDbConfig, ConnectionFieldName>;

const connectionKey = (config: ConnectionFields): string =>
  CONNECTION_FIELDS.map((field) => config[field].trim()).join("|");

export function toStoredConnection(connection: ConnectionFields): SafeDbConfig {
  return {
    host: connection.host,
    port: connection.port,
    db_name: connection.db_name,
    user: connection.user,
    schema_name: "",
    table_name: "",
  };
}

export function changedConnectionFields(current: ConnectionFields, next: ConnectionFields): ConnectionFieldName[] {
  return CONNECTION_FIELDS.filter((field) => current[field] !== next[field]);
}

/** One entry per distinct connection, newest first. Table-oriented entries of the shared store show up as their connection. */
export function toConnectionProfiles(profiles: ReadonlyArray<SavedDbProfile>): SavedDbProfile[] {
  const newestFirst = [...profiles].sort((left, right) => right.updatedAt - left.updatedAt);
  const seenKeys = new Set<string>();
  const connectionProfiles: SavedDbProfile[] = [];

  for (const profile of newestFirst) {
    if (!profile.config || profile.config.db_name.trim() === "") continue;
    const key = connectionKey(profile.config);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    connectionProfiles.push({ ...profile, config: toStoredConnection(profile.config) });
  }

  return connectionProfiles;
}

export function trimConnection(connection: ClientConnection): ClientConnection {
  return {
    host: connection.host.trim(),
    port: connection.port.trim(),
    db_name: connection.db_name.trim(),
    user: connection.user.trim(),
    password: connection.password,
  };
}
