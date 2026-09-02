/**
 * Database streaming and query batching constants.
 */

/**
 * Dataset size threshold above which PostGIS queries automatically switch
 * from single-shot fetch to PostgreSQL server-side cursor streaming.
 */
export const STREAMING_RECORD_THRESHOLD = 25000;

/**
 * Number of records fetched per server-side cursor iteration during streaming.
 */
export const STREAMING_CHUNK_BATCH_SIZE = 50000;
