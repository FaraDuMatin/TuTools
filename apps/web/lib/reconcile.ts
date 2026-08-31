/**
 * Excalidraw element reconciliation — client side.
 *
 * ---------------------------------------------------------------------------
 * TWIN FILE: apps/api/src/whiteboard/reconcile.ts
 *
 * Duplicated, not shared: web and api are separate npm packages with no
 * workspace between them. Change one, change the other in the same commit.
 * Peers that disagree about who wins diverge silently, which is the worst thing
 * this file can do. The API copy has the unit tests.
 * ---------------------------------------------------------------------------
 *
 * Higher `version` wins; a tie breaks on the lower `versionNonce`. Both numbers
 * travel with the element, so every peer independently reaches the same answer
 * — that is what makes this safe without a CRDT.
 */

export interface SyncElement {
  id: string;
  version: number;
  versionNonce: number;
  isDeleted?: boolean;
  [key: string]: unknown;
}

export function wins(candidate: SyncElement, existing: SyncElement): boolean {
  if (candidate.version !== existing.version) {
    return candidate.version > existing.version;
  }
  if (candidate.versionNonce !== existing.versionNonce) {
    return candidate.versionNonce < existing.versionNonce;
  }
  return false;
}

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
