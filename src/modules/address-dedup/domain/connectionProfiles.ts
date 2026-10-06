import type { SafeDbConfig, SavedDbProfile } from "@/core/types/db";

type ConnectionFields = Pick<SafeDbConfig, "host" | "port" | "db_name" | "user">;

export function connectionKey(config: ConnectionFields): string {
  return [config.host, config.port, config.db_name, config.user]
    .map((field) => (field ?? "").trim())
    .join("|");
}

/** The dedup tool connects to a database, not a table: a profile is named after the connection only. */
export function connectionProfileName(config: ConnectionFields): string {
  const host = (config.host ?? "").trim();
  const port = (config.port ?? "").trim();
  const user = (config.user ?? "").trim();
  const address = [host, port].filter((part) => part !== "").join(":");
  return [
    (config.db_name ?? "").trim(),
    address && `@ ${address}`,
    user && `(${user})`,
  ]
    .filter((part) => part)
    .join(" ");
}

export function toConnectionConfig(config: SafeDbConfig): SafeDbConfig {
  return { ...config, schema_name: "", table_name: "" };
}

/** One entry per distinct connection, newest first; the shared store keeps the table-oriented originals. */
export function toConnectionProfiles(profiles: ReadonlyArray<SavedDbProfile>): SavedDbProfile[] {
  const newestFirst = [...profiles].sort((left, right) => right.updatedAt - left.updatedAt);
  const seenKeys = new Set<string>();
  const connectionProfiles: SavedDbProfile[] = [];

  for (const profile of newestFirst) {
    if ((profile.config.db_name ?? "").trim() === "") continue;
    const key = connectionKey(profile.config);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    connectionProfiles.push({
      id: profile.id,
      name: connectionProfileName(profile.config),
      config: toConnectionConfig(profile.config),
      updatedAt: profile.updatedAt,
    });
  }

  return connectionProfiles;
}

export function findConnectionProfile(
  connectionProfiles: ReadonlyArray<SavedDbProfile>,
  config: ConnectionFields
): SavedDbProfile | undefined {
  const key = connectionKey(config);
  return connectionProfiles.find((profile) => connectionKey(profile.config) === key);
}
