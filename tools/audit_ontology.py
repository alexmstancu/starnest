#!/usr/bin/env python3
"""Structural audit of the ontology in reqs.md.

The ontology is the load-bearing part of this project: everything else is
downstream of how the data is structured. This script checks the invariants that
keep the two diagrams, the prose that documents them, and the criteria catalog
from drifting apart. It reads only; it never edits.

Run it after any change to section 3, the diagrams, or the criteria catalog:

    uv run python tools/audit_ontology.py

Exit code 0 means every invariant holds.
"""
import re
import sys
from pathlib import Path

DOC = Path(__file__).resolve().parent.parent / "docs" / "reqs.md"

# Documented deliberately outside the diagram: payloads of the typed child tables
# that arch.md 3.3 describes, and identifiers that name attributes or retired terms.
PAYLOAD_FIELDS = {
    "amount", "amount_eur", "currency", "fx_rate", "fx_rate_date", "magnitude", "unit",
    "count", "basis", "range", "scale_min", "scale_max", "assigned_by", "rationale", "body",
}


class Audit:
    def __init__(self) -> None:
        self.failures = 0

    def check(self, label: str, offenders) -> None:
        offenders = sorted(offenders)
        if offenders:
            self.failures += 1
            print(f"  FAIL  {label}")
            for item in offenders[:25]:
                print(f"          {item}")
            if len(offenders) > 25:
                print(f"          ... and {len(offenders) - 25} more")
        else:
            print(f"  ok    {label}")


def mermaid_blocks(text):
    return re.findall(r"```mermaid\n(.*?)```", text, re.S)


def parse(block):
    """-> (entities: {name: {field: key}}, relations: {(left, cardinality, right, label)})"""
    entities, relations = {}, set()
    for match in re.finditer(r"^    ([A-Z_]+) \{\n((?:        [^\n]*\n)*)    \}", block, re.M):
        fields = {}
        for line in match.group(2).splitlines():
            parts = line.split()
            if len(parts) >= 2:
                fields[parts[1]] = parts[2] if len(parts) > 2 else ""
        entities.setdefault(match.group(1), {}).update(fields)
    for match in re.finditer(r'^    ([A-Z_]+) ([|}][|o]--[o|][|{]) ([A-Z_]+) : (.+)$', block, re.M):
        relations.add((match.group(1), match.group(2), match.group(3), match.group(4).strip('" ')))
    return entities, relations


def camel(entity: str) -> str:
    return "".join(word.capitalize() for word in entity.split("_"))


def fk_target(field_name: str, entities) -> str | None:
    """A foreign key is named after the table it points at, optionally role-prefixed."""
    upper = field_name.upper()
    for entity in entities:
        if upper == entity or upper.endswith("_" + entity):
            return entity
    return None


def main() -> int:
    text = DOC.read_text()
    blocks = mermaid_blocks(text)
    if len(blocks) != 2:
        print(f"FAIL: expected 2 mermaid diagrams (overview, complete), found {len(blocks)}")
        return 1

    overview_entities, overview_relations = parse(blocks[0])
    entities, relations = parse(blocks[1])
    audit = Audit()

    print("=== the overview is a strict subset of the complete model ===")
    audit.check("every overview entity exists", set(overview_entities) - set(entities))
    pairs = {(a, c) for a, _, c, _ in relations}
    audit.check("every overview relation exists", {f"{a} -> {c}" for a, _, c, _ in overview_relations
                                                   if (a, c) not in pairs})
    audit.check("labels agree", {f"{a}->{c}: '{lab}' vs '{lab2}'"
                                 for a, _, c, lab in overview_relations
                                 for a2, _, c2, lab2 in relations
                                 if (a, c) == (a2, c2) and lab != lab2})
    audit.check("cardinalities agree", {f"{a}->{c}"
                                        for a, card, c, _ in overview_relations
                                        for a2, card2, c2, _ in relations
                                        if (a, c) == (a2, c2) and card != card2})

    print("\n=== the complete model is internally consistent ===")
    audit.check("every relation endpoint is declared",
                {e for a, _, c, _ in relations for e in (a, c)} - set(entities))
    # Singletons hold application-wide configuration and legitimately reference nothing.
    SINGLETONS = {"SETTINGS"}
    audit.check("no entity is declared but unrelated, except documented singletons",
                set(entities) - {e for a, _, c, _ in relations for e in (a, c)} - SINGLETONS)

    undirected = pairs | {(c, a) for a, c in pairs}
    unbacked, fk_pairs = [], set()
    for entity, fields in entities.items():
        for name, key in fields.items():
            if key != "FK":
                continue
            target = fk_target(name, entities)
            if target is None:
                unbacked.append(f"{entity}.{name} names no entity")
            else:
                fk_pairs |= {(entity, target), (target, entity)}
                if (entity, target) not in undirected:
                    unbacked.append(f"{entity}.{name} -> {target}: no relation line")
    audit.check("every foreign key has a relation line", unbacked)
    audit.check("every relation line has a foreign key behind it",
                {f"{a} -- {c}" for a, _, c, _ in relations if (a, c) not in fk_pairs})

    print("\n=== the prose and the diagram agree ===")
    explained = {(m.group(1), m.group(2)) for m in re.finditer(r"\| `([A-Z_]+) [^`]*?([A-Z_]+)` \|", text)}
    audit.check("every relation is explained in the relation tables",
                {f"{a} -> {c}" for a, _, c, _ in relations if (a, c) not in explained})
    audit.check("no explanation describes a relation that does not exist",
                {f"{a} -> {c}" for a, c in explained if (a, c) not in pairs})
    audit.check("every entity is named somewhere in the prose",
                {e for e in entities if e.lower() not in text and camel(e) not in text})

    # Section 3 field tables must not name a field the diagram lacks.
    documented = {"3.1": ("CANDIDATE",),
                  "3.4": ("CRITERION",),
                  "3.4a": ("EVALUATION", "CANDIDATE_RESULT", "NON_MATCH_REASON"),
                  "3.5": ("DATA_SOURCE",),
                  "3.5a": ("EXTERNAL_SCORE",),
                  "3.6": ("VALUE",),
                  "3.7": ("MATCH_RULE", "MATCH_RULE_RESULT"),
                  "3.8": ("DATA_ACQUISITION_RUN",),
                  "3.9": ("HOUSEHOLD",)}
    headings = [(m.group(1), m.start()) for m in re.finditer(r"^### (\d+\.\d+[a-z]?) ", text, re.M)]
    drift = []
    for index, (number, start) in enumerate(headings):
        if number not in documented:
            continue
        end = headings[index + 1][1] if index + 1 < len(headings) else len(text)
        body = text[start:end]
        declared = set()
        for match in re.finditer(r"^\| `([a-z_]+)`(?:, `([a-z_]+)`)*", body, re.M):
            declared |= {g for g in match.groups() if g}
        known = set().union(*(set(entities.get(e, {})) for e in documented[number]))
        # A row may name a child table rather than a field on the entity itself.
        known |= {e.lower() for e in entities}
        for field in declared - known - PAYLOAD_FIELDS:
            names = " / ".join(documented[number])
            drift.append(f"section {number} names `{field}`, which {names} lacks")
    audit.check("section 3 field tables match their entities", drift)

    print("\n=== the criteria catalog is well formed ===")
    for level, start_head, end_head in [("country", "### 7.1 Country level", "### 7.2 City level"),
                                        ("city", "### 7.2 City level", "### 7.3 Match rule catalog")]:
        body = text.split(start_head)[1].split(end_head)[0]
        pillars = re.findall(r"^#### (.+?) — (\d+)%", body, re.M)
        audit.check(f"{level} pillar weights sum to 100%",
                    [] if sum(int(w) for _, w in pillars) == 100 else
                    [f"{level}: {sum(int(w) for _, w in pillars)}%"])
        bad = []
        for chunk in body.split("#### ")[1:]:
            weights = [int(w) for w in re.findall(r"^\| `[a-z_.0-9]+` \| (\d+)% \|", chunk, re.M)]
            if weights and sum(weights) != 100:
                bad.append(f"{level}.{chunk.split(' — ')[0]}: {sum(weights)}%")
        audit.check(f"{level} attribute weights sum to 100% within each pillar", bad)

    print("\n=== the document renders ===")
    in_fence, block, bad_rows = False, [], []
    for number, line in enumerate(text.splitlines(), 1):
        if line.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if line.lstrip().startswith("|"):
            block.append((number, len(re.findall(r"(?<!\\)\|", line)) - 1))
        else:
            if len(block) > 1:
                width = block[0][1]
                bad_rows += [f"line {n}: {c} columns, expected {width}" for n, c in block if c != width]
            block = []
    audit.check("every table row has the same column count as its header", bad_rows)

    sections = set(re.findall(r"^#{2,4} (\d+(?:\.\d+[a-z]?)?)", text, re.M))
    # A reference within this document reads "section 5.3"; a reference to another document
    # reads "arch.md 10.2", with no such word. That difference is what separates the two, and
    # it needs no lookbehind for every filename that might appear -- a reference to a document
    # we have never heard of is excluded for free.
    references = set(re.findall(r"section (\d+\.\d+[a-z]?)", text))
    audit.check("every cross-reference points at a section that exists",
                {f"section {r}" for r in references - sections})

    print("\n" + ("ALL INVARIANTS HOLD" if not audit.failures
                  else f"{audit.failures} CHECK(S) FAILED"))
    return 1 if audit.failures else 0


if __name__ == "__main__":
    sys.exit(main())
