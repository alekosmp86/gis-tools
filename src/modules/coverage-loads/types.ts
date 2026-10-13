export interface DbConnection {
  readonly host: string;
  readonly port: number;
  readonly db_name: string;
  readonly user: string;
  readonly password: string;
}

/** Connection as the browser posts it. Port is text because it comes from a form field. */
export interface ConnectionPayload {
  readonly host: string;
  readonly port: string;
  readonly db_name: string;
  readonly user: string;
  readonly password: string;
}
