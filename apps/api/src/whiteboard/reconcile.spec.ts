import { reconcile, wins, type SyncElement } from './reconcile.js';

const el = (
  id: string,
  version: number,
  versionNonce: number,
  extra: Partial<SyncElement> = {},
): SyncElement => ({ id, version, versionNonce, ...extra });

const byId = (elements: SyncElement[]) =>
  Object.fromEntries(elements.map((e) => [e.id, e]));

describe('wins', () => {
  it('prefers the higher version', () => {
    expect(wins(el('a', 5, 100), el('a', 4, 1))).toBe(true);
    expect(wins(el('a', 3, 1), el('a', 4, 999))).toBe(false);
  });

  it('breaks a version tie on the lower nonce', () => {
    expect(wins(el('a', 4, 10), el('a', 4, 20))).toBe(true);
    expect(wins(el('a', 4, 20), el('a', 4, 10))).toBe(false);
  });

  // The property that makes this safe without a CRDT: both peers run the same
  // comparison on the same numbers, so they cannot disagree about the winner.
  it('is antisymmetric — two peers never both think they won', () => {
    const mine = el('a', 4, 10);
    const theirs = el('a', 4, 20);

    expect(wins(theirs, mine)).toBe(false);
    expect(wins(mine, theirs)).toBe(true);
  });

  it('treats an identical retransmission as no change', () => {
    expect(wins(el('a', 4, 10), el('a', 4, 10))).toBe(false);
  });
});

describe('reconcile', () => {
  it('adds elements it has not seen', () => {
    const result = reconcile([el('a', 1, 1)], [el('b', 1, 1)]);
    expect(result.map((e) => e.id).sort()).toEqual(['a', 'b']);
  });

  it('takes the newer version of an element it already has', () => {
    const result = reconcile([el('a', 1, 500)], [el('a', 2, 900)]);
    expect(result).toHaveLength(1);
    expect(result[0].version).toBe(2);
  });

  it('keeps its own element when the incoming one is stale', () => {
    const result = reconcile([el('a', 7, 500)], [el('a', 2, 1)]);
    expect(result[0].version).toBe(7);
  });

  // Messages arrive in whatever order the network delivers them. If order
  // mattered, two peers would end up with different boards.
  it('is independent of the order elements arrive in', () => {
    const local = [el('a', 1, 10), el('b', 1, 20)];
    const incoming = [
      el('a', 3, 5),
      el('b', 2, 40),
      el('c', 1, 60),
      el('a', 2, 80),
      el('b', 4, 90),
    ];

    const expected = byId(reconcile(local, incoming));

    for (let i = 0; i < 20; i++) {
      const shuffled = [...incoming].sort(() => Math.random() - 0.5);
      expect(byId(reconcile(local, shuffled))).toEqual(expected);
    }
  });

  it('two peers converge on the same board regardless of who merges first', () => {
    const shared = [el('a', 1, 10)];
    const fromTutor = [el('a', 2, 30), el('t', 1, 11)];
    const fromStudent = [el('a', 2, 20), el('s', 1, 22)];

    // Tutor's view: applies the student's changes on top of its own.
    const tutorView = reconcile(reconcile(shared, fromTutor), fromStudent);
    // Student's view: the opposite order.
    const studentView = reconcile(reconcile(shared, fromStudent), fromTutor);

    expect(byId(tutorView)).toEqual(byId(studentView));
    // Nonce 20 beats 30 at the same version, on both sides.
    expect(byId(tutorView).a.versionNonce).toBe(20);
  });

  it('a delete is just a newer version, and it sticks', () => {
    const result = reconcile(
      [el('a', 1, 10)],
      [el('a', 2, 10, { isDeleted: true })],
    );
    expect(result[0].isDeleted).toBe(true);
  });

  it('a stale edit does not resurrect a deleted element', () => {
    const result = reconcile(
      [el('a', 5, 10, { isDeleted: true })],
      [el('a', 3, 1)],
    );
    expect(result[0].isDeleted).toBe(true);
  });

  it('an edit newer than the delete does resurrect it', () => {
    const result = reconcile(
      [el('a', 5, 10, { isDeleted: true })],
      [el('a', 6, 1)],
    );
    expect(result[0].isDeleted).toBeUndefined();
  });

  it('leaves the local set untouched when nothing arrives', () => {
    const local = [el('a', 1, 1), el('b', 2, 2)];
    expect(byId(reconcile(local, []))).toEqual(byId(local));
  });

  it('does not mutate its arguments', () => {
    const local = [el('a', 1, 1)];
    const incoming = [el('a', 2, 2)];
    reconcile(local, incoming);

    expect(local[0].version).toBe(1);
    expect(incoming[0].version).toBe(2);
  });
});
