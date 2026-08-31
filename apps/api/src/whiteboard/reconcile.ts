/**
 * Excalidraw element reconciliation.
 *
 * ---------------------------------------------------------------------------
 * TWIN FILE: apps/web/lib/reconcile.ts
 *
 * The client needs the same rule, and the two apps are separate npm packages
 * with no shared workspace, so this logic is duplicated rather than imported.
 * If you change the rule here, change it there in the same commit — peers that
 * disagree about who wins will silently diverge, which is the worst failure
 * this file can have.
 * ---------------------------------------------------------------------------
 *
 * The rule is Excalidraw's own, and it is what excalidraw.com uses: elements are
 * versioned, not diffed. Every edit bumps `version` and randomises
 * `versionNonce`. To merge two views of the same element, take the higher
 * `version`; if they tie, take the lower `versionNonce`.
 *
 * The nonce tie-break is what makes this safe without a CRDT: it is a number
 * both peers can see, so both independently reach the *same* answer. A
 * timestamp or "last message wins" would not — those depend on clocks and
 * arrival order, and two peers would end up with different boards.
 */

/** Only the fields reconciliation needs. Real elements carry far more. */
export interface SyncElement {
  id: string;
  version: number;
  versionNonce: number;
  isDeleted?: boolean;
  [key: string]: unknown;
}

/**
 * True when `candidate` should replace `existing`.
 *
 * Exported for the tests, and because the comparison is the whole design.
 */
export function wins(candidate: SyncElement, existing: SyncElement): boolean {
  if (candidate.version !== existing.version) {
    return candidate.version > existing.version;
  }
  // Same version reached independently on two peers. Neither is "later" in any
  // meaningful sense, so pick deterministically rather than by arrival.
  if (candidate.versionNonce !== existing.versionNonce) {
    return candidate.versionNonce < existing.versionNonce;
  }
  // Identical — a retransmission. Keep what we have.
  return false;
}

/**
 * Merges incoming elements into a local set.
 *
 * Order-independent by construction: every incoming element is judged against
 * whatever is currently held, using a comparison that never consults arrival
 * order. Shuffling `incoming` cannot change the result, which is the property
 * the test suite pins down.
 *
 * Deletions are elements too. Excalidraw tombstones rather than removing, so a
 * delete is just a higher `version` with `isDeleted: true` — and it survives a
 * concurrent edit exactly when the version rule says it should.
 */
export function reconcile(
  local: readonly SyncElement[],
  incoming: readonly SyncElement[],
): SyncElement[] {
  const merged = new Map<string, SyncElement>();
  for (const element of local) merged.set(element.id, element);

  for (const element of incoming) {
    const existing = merged.get(element.id);
    if (!existing || wins(element, existing)) {
      merged.set(element.id, element);
    }
  }

  return [...merged.values()];
}
