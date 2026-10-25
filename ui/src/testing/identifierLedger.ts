/**
 * The internal identifiers known to reach the screen, per screen state, each with the plan
 * item that takes it off (map-C01 §3 M3).
 *
 * **A ledger that only shrinks.** `app/identifiers.test.tsx` renders every state below and
 * fails both ways: on an identifier this does not list, which is a new one reaching the screen,
 * and on one it lists that the state no longer shows, which is a fix that forgot to cross
 * itself off. So the only edit that keeps the suite green after a fix is deleting the entry,
 * and the only way to add one is to write it here beside the item that will remove it.
 *
 * **Seeded from the scanner's first run at `98b4746`**, not from reading the code: the run is
 * the authority on what the screen shows. A plan item is named as map-C01 §3 names it, and
 * `unassigned` where no item covers the entry.
 */

export interface KnownOffender {
  /** Exactly as the scanner finds it. */
  readonly identifier: string;
  /** Where it shows, for whoever comes to remove it. */
  readonly where: string;
  /** The plan item whose fix takes it off the screen, or `unassigned`. */
  readonly removedBy: string;
}

const COMPOUND_RULES: readonly KnownOffender[] = [
  {
    identifier: "ShareOfHouseholdField",
    where: "stage 4, a compound rule's shape under its name",
    removedBy: "PL-155 (C13)",
  },
  {
    identifier: "AllConditionsHold",
    where: "stage 4, a compound rule's shape under its name",
    removedBy: "PL-155 (C13)",
  },
  {
    identifier: "not_matchings",
    where: 'stage 4, a compound rule\'s outcome: "and not_matchings when it fires"',
    removedBy: "PL-155 (C13)",
  },
];

const GATE_PROPOSALS: readonly KnownOffender[] = [
  {
    identifier: "country.visa_route_exists",
    where: "gate proposals: the gate column, and the row's Confirm button",
    removedBy: "PL-150 (C13)",
  },
  {
    identifier: "country.portugal",
    where: "gate proposals: the candidate column, and the row's Confirm button",
    removedBy: "PL-150 (C13)",
  },
  {
    identifier: "not_matching",
    where: "gate proposals: the proposed answer",
    removedBy: "PL-150 (C13)",
  },
];

const MANUAL_SOURCE: KnownOffender = {
  identifier: "manual",
  where: 'the hand-entry card\'s lead and its open form: "stored under the manual source"',
  removedBy: "unassigned",
};

export const IDENTIFIER_LEDGER = {
  "Configure, a pillar and a rule editor open": [
    ...COMPOUND_RULES,
    ...GATE_PROPOSALS,
  ],
  "Configure, a weight change refused": [
    ...COMPOUND_RULES,
    ...GATE_PROPOSALS,
  ],
  "Configure, nothing set": [...COMPOUND_RULES, ...GATE_PROPOSALS],
  "Configure, no criteria set": [],
  "Configure, the server unreachable": [],

  "Acquire, a run card with its gaps open, a diff chosen and hand entry open": [MANUAL_SOURCE],
  "Acquire, a run stopped by hand": [
    {
      identifier: "halted_by_user",
      where: "the run card's status pill and its outcome sentence",
      removedBy: "PL-122 (C09)",
    },
    MANUAL_SOURCE,
  ],
  "Acquire, no spend cap set": [MANUAL_SOURCE],
  "Acquire, nothing acquired yet": [MANUAL_SOURCE],
  "Acquire, the server unreachable": [],

  "Rank, a row open on a pillar, an attribute drilled into and a saved ranking open": [],
  "Rank, the score range unset": [],
  "Rank, nothing ranked": [],
  "Rank, the server unreachable": [],

  "Compare, drawn as scores": [],
  "Compare, drawn as raw figures": [],
  "Compare, no comparator limit set": [],
  "Compare, the score range unset": [],
  "Compare, nothing compared yet": [],
  "Compare, the server unreachable": [],
} satisfies Record<string, readonly KnownOffender[]>;

export type ScreenState = keyof typeof IDENTIFIER_LEDGER;
