#!/usr/bin/env python3
"""Checks openapi.yaml against the ontology in reqs.md, and against itself.

The API need not mirror the schema one to one, but every concept the ontology
carries must be reachable through it. This script proves that mechanically, and
catches the class of YAML fault that is valid but unreadable to consumers.

    uv run --with pyyaml python tools/audit_api.py
"""
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / "docs" / "openapi.yaml"
REQS = ROOT / "docs" / "reqs.md"

# Entities the API covers under another name, or deliberately does not expose.
# Each needs a reason, so that "not covered" is always a decision rather than an oversight.
COVERED_ELSEWHERE = {
    "CANDIDATE_ATTRIBUTE_SCORE": "AttributeScore, inside CandidateScoreDetail",
    "CANDIDATE_WARNING": "Warning, inside CandidateResult",
    "COMPOUND_RULE_INPUT": "CompoundRule.inputs",
    "CRITERIA_SET_COMPOUND_RULE": "CriteriaSet.applied_compound_rules, and its PUT endpoint",
    "CRITERIA_SET_MATCH_RULE": "CriteriaSet.enforced_match_rules, and its PUT endpoint",
    "CRITERION_SCALE_ANCHOR": "CriterionInput.scale_anchors",
    "CRITERION_THRESHOLD_BOOLEAN": "CriterionInput.matching_threshold variant",
    "CRITERION_THRESHOLD_LABEL": "CriterionInput.matching_threshold variant",
    "CRITERION_THRESHOLD_RANGE": "CriterionInput.matching_threshold variant",
    "CRITERION_THRESHOLD_SHARE": "CriterionInput.matching_threshold variant",
    "DATA_ACQUISITION_FAILURE": "RunDetail.failures",
    "COMPOUND_RULE_CONDITION": "CompoundRule.conditions",
    "DATA_ACQUISITION_RUN_ATTRIBUTE": "RunScope.attributes, inside RunDetail.scope",
    "DATA_ACQUISITION_RUN_CANDIDATE": "RunScope.candidates, inside RunDetail.scope",
    "EVALUATION_CRITERION": "GET /evaluations/{id}/criteria",
    "EVALUATION_SCALE_ANCHOR": "EvaluationCriterion.scale_anchors, in GET /evaluations/{id}/criteria",
    "MATCH_RULE_RESULT_CITATION": "MatchRuleResult.citations",
    "HOUSEHOLD_CITIZENSHIP": "HouseholdInput.citizenships",
    "VALUE_CITATION": "Value.citations",
    "ATTRIBUTE_ALLOWED_LABEL": "Attribute.allowed_labels",
    "ATTRIBUTE_ALLOWED_RANGE": "Attribute.allowed_range",
    "ATTRIBUTE_SOURCE_PRIORITY": "Attribute.effective_source_priority",
    "VALUE_TYPE": "ValueTypeName, and Attribute.value_type",
    "NON_MATCH_REASON": "NonMatchReason, inside CandidateResult",
    "PILLAR_WEIGHT": "PillarWeight",
    "HOUSEHOLD_FIELD": "CompoundRule input, as household_field",
    "FX_RATE": "FxRate, inside MonetaryPayload",
    "STAND_IN": "Value.data_source stand_in, with Value.quote naming the substitute and the reason",
    "POPULATION_CENTRE": "Value.quote of each climate figure, which names every place and its weight",
}


def ontology_entities() -> set[str]:
    block = re.findall(r"```mermaid\n(.*?)```", REQS.read_text(), re.S)[1]
    return set(re.findall(r"^    ([A-Z_]+) \{", block, re.M))


def main() -> int:
    failures = 0

    def check(label, offenders):
        nonlocal failures
        offenders = sorted(offenders)
        if offenders:
            failures += 1
            print(f"  FAIL  {label}")
            for item in offenders[:25]:
                print(f"          {item}")
        else:
            print(f"  ok    {label}")

    text = SPEC.read_text()
    spec = yaml.safe_load(text)

    print("=== the specification is well formed ===")
    refs = set(re.findall(r'"#/([^"]+)"', text))
    dangling = []
    for ref in refs:
        node = spec
        for part in ref.split("/"):
            node = node.get(part) if isinstance(node, dict) else None
            if node is None:
                dangling.append(ref)
                break
    check("every $ref resolves", dangling)

    ops = [(p, m, o) for p, item in spec["paths"].items()
           for m, o in item.items() if m in ("get", "post", "put", "patch", "delete")]
    ids = [o.get("operationId") for _, _, o in ops]
    check("every operation has a unique operationId",
          [i for i in set(ids) if ids.count(i) > 1] + (["<missing>"] if None in ids else []))

    used = {r.split("/")[-1] for r in refs if r.startswith("components/schemas/")}
    check("no schema is defined but unreachable", set(spec["components"]["schemas"]) - used)

    # The fault that is valid YAML but fatal to consumers: a key with no value,
    # produced by an unquoted string containing a comma inside a flow mapping.
    doc = yaml.compose(text)
    nulls = []

    def walk(node, path=""):
        if isinstance(node, yaml.MappingNode):
            for k, v in node.value:
                key = getattr(k, "value", "?")
                if isinstance(v, yaml.ScalarNode) and v.tag.endswith(":null") and v.value == "":
                    nulls.append(f"line {k.start_mark.line + 1}: key '{key}' has no value")
                walk(v, f"{path}/{key}")
        elif isinstance(node, yaml.SequenceNode):
            for item in node.value:
                walk(item, path)

    walk(doc)
    check("no key has a null value", nulls)

    print("\n=== every ontology concept is reachable through the API ===")
    entities = ontology_entities()
    flat = text.lower().replace("_", "").replace("-", "")
    missing = []
    for entity in sorted(entities):
        if entity.lower().replace("_", "") in flat:
            continue
        if entity in COVERED_ELSEWHERE:
            continue
        missing.append(entity)
    check(f"all {len(entities)} entities covered", missing)

    stale = sorted(set(COVERED_ELSEWHERE) - entities)
    check("no exemption names an entity that no longer exists", stale)

    print("\n" + ("ALL CHECKS PASS" if not failures else f"{failures} CHECK(S) FAILED"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
