import type {
  RemovalConfirmation,
  RemovalPlan,
  RemovalResult,
} from "../removalTypes";
import type { RepositoryRequest } from "../types";

/**
 * Access to the removal of confirmed REMOVE candidates. Kept apart from `AddressRepository` so the
 * read path keeps its read-only guarantee on its own; the only implementation that writes is
 * `PgRemovalRepository`.
 */
export interface RemovalRepository {
  simulateRemoval(request: RepositoryRequest): Promise<RemovalPlan>;
  executeRemoval(request: RepositoryRequest, confirmation: RemovalConfirmation): Promise<RemovalResult>;
}
