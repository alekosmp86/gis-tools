import type { DbConfig } from "@/types/db";

export const INITIAL_DB_CONFIG: DbConfig = {
  host: "localhost",
  port: "5432",
  db_name: "",
  user: "",
  password: "",
  schema_name: "public",
  table_name: "",
};
