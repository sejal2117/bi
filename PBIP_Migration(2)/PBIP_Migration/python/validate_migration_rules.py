#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
validate_migration_rules.py

Purpose
-------
Validate a Power BI project against SAP BO → Power BI migration rules.

This script can validate either:
  A) A compiled PBIX (preferred): deep checks via `pbixray` (measures, M/parameters,
     relationships, schema stats, naming patterns, etc.)
  B) A PBIP folder (fallback): structural checks and best-effort RLS detection.

It emits a single JSON report (to stdout and optionally to a file) and exits non‑zero
if any ERROR‑level rule fails (so you can gate builds in CI or local pipelines).

Typical usage
-------------
# PBIX validation:
python validate_migration_rules.py --pbix ../build-output.pbix

# PBIP fallback validation:
python validate_migration_rules.py --pbip ../sample-pbip

# With custom rules:
python validate_migration_rules.py --pbix ../build-output.pbix --rules ./rules.yaml --out ./validation.json

Inputs
------
--pbix      : Path to PBIX file (preferred mode)
--pbip      : Path to PBIP root (fallback mode when PBIX is not available)
--rules     : Optional YAML file to tweak validation rules
--md-guide  : Optional path to your SAP BO → Power BI migration guide (for provenance)
--out       : Optional JSON file path to write the result
--verbose   : Print extra logs

Outputs
-------
- JSON object to stdout and (optionally) to --out file:
  {
    "mode": "pbix" | "pbip",
    "summary": { "passed": X, "failed": Y, "warnings": Z },
    "rules": [
      {"id": "RULE_ID", "status": "PASS"|"FAIL"|"WARN", "message": "...", "details": {...}}
    ],
    "meta": {...}
  }

Exit codes
----------
- 0: All ERROR‑level rules passed (WARNs may exist)
- 1: At least one ERROR‑level rule failed
- 2: No valid target could be analyzed (missing PBIX and PBIP)

Dependencies
------------
- pbixray (preferred PBIX mode)
- pyyaml (for rules parsing)
- Python 3.10+

Author & Notes
--------------
- Designed to plug into the local Elysia API's /validate flow.
- Replace/expand the default rules to match your org standards any time.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from glob import glob
from typing import Any, Dict, List, Optional, Tuple

# Optional: pbixray is only needed when validating PBIX
try:
    from pbixray import PBIXRay
    HAS_PBIXRAY = True
except Exception:
    HAS_PBIXRAY = False

try:
    import yaml
    HAS_YAML = True
except Exception:
    HAS_YAML = False


# --------------------------------------------------------------------------------------
# Default rules (inspired by SAP BO → Power BI mapping):
#   - Universe → Dataset: expect at least a non-trivial model (tables, relationships)
#   - @Prompt → Parameters: expect at least one parameter if rule is enabled
#   - RLS via roles: try to detect "roles" definition in PBIP model sources
#   - Naming patterns: encourage dim_/fact_ for tables, reasonable measure names
#   - Calculated columns budget: avoid excessive calc columns
# --------------------------------------------------------------------------------------

DEFAULT_RULES = {
    "rules": [
        {
            "id": "MEASURES_PRESENT",
            "level": "ERROR",
            "enabled": True,
            "when": "pbix",
            "description": "At least one DAX measure exists in the model.",
        },
        {
            "id": "PARAMETERS_PRESENT",
            "level": "WARN",
            "enabled": True,
            "when": "pbix",
            "description": "At least one M parameter exists (BO @Prompt → PBI parameter)."
        },
        {
            "id": "RELATIONSHIPS_PRESENT",
            "level": "ERROR",
            "enabled": True,
            "when": "pbix",
            "description": "At least one relationship exists between tables."
        },
        {
            "id": "TABLE_NAMING_PATTERN",
            "level": "WARN",
            "enabled": True,
            "when": "pbix",
            "description": "Tables should follow naming conventions (e.g., dim_/fact_/map_/br_).",
            "config": {
                "regex": r"^(dim_|fact_|map_|br_).+",
                "allow": ["Date", "Calendar"]  # allow common shared dimensions without prefix
            }
        },
        {
            "id": "MEASURE_NAMING_PATTERN",
            "level": "WARN",
            "enabled": True,
            "when": "pbix",
            "description": "Measure names should be readable and avoid symbols.",
            "config": {
                "regex": r"^[A-Za-z][A-Za-z0-9_ ()\-]+$"
            }
        },
        {
            "id": "CALCULATED_COLUMNS_LIMIT",
            "level": "WARN",
            "enabled": True,
            "when": "pbix",
            "description": "Calculated columns should be kept within a reasonable limit.",
            "config": {
                "max": 75
            }
        },
        {
            "id": "PBIP_STRUCTURE_MINIMAL",
            "level": "ERROR",
            "enabled": True,
            "when": "pbip",
            "description": "PBIP folder contains essential files (report/model definitions).",
            "config": {
                "globs_any": [
                    "**/definition.pbir",        # report definition
                    "**/report.json",            # legacy report JSON
                    "**/*.tmdl",                 # TMDL model files
                    "**/model.bim"               # legacy BIM
                ]
            }
        },
        {
            "id": "PBIP_ROLES_PRESENT_BEST_EFFORT",
            "level": "WARN",
            "enabled": True,
            "when": "pbip",
            "description": "Best-effort check for RLS roles in PBIP sources (TMDL or BIM).",
            "config": {
                "search_terms": ["roles", "rowLevelSecurity", "RLS"]
            }
        }
    ],
    "options": {
        "fail_on_warn": False  # if True, WARN will also fail the run
    }
}


# --------------------------------------------------------------------------------------
# Utilities
# --------------------------------------------------------------------------------------

def load_yaml_rules(path: Optional[str]) -> Dict[str, Any]:
    """
    Load rules from a YAML file; fall back to DEFAULT_RULES if not provided.
    """
    if not path:
        return DEFAULT_RULES

    if not HAS_YAML:
        print("[validate] PyYAML not installed; cannot load custom rules, using defaults.", file=sys.stderr)
        return DEFAULT_RULES

    if not os.path.isfile(path):
        print(f"[validate] Rules file not found: {path}; using defaults.", file=sys.stderr)
        return DEFAULT_RULES

    with open(path, "r", encoding="utf-8") as f:
        try:
            data = yaml.safe_load(f) or {}
        except Exception as e:
            print(f"[validate] Failed to parse rules YAML ({path}): {e}; using defaults.", file=sys.stderr)
            return DEFAULT_RULES

    # Merge shallowly with defaults so missing pieces are filled.
    merged = DEFAULT_RULES.copy()
    merged["rules"] = data.get("rules", DEFAULT_RULES["rules"])
    merged["options"] = {**DEFAULT_RULES.get("options", {}), **(data.get("options", {}) or {})}
    return merged


def to_records(df_like) -> List[Dict[str, Any]]:
    """
    Convert a pandas-like DataFrame to list-of-dicts if possible;
    otherwise, return a stringified fallback.
    """
    try:
        return df_like.to_dict(orient="records")
    except Exception:
        try:
            return list(df_like)  # sometimes it's an iterable of tuples/rows
        except Exception:
            return [{"raw": str(df_like)}]


def regex_or_none(pattern: Optional[str]) -> Optional[re.Pattern]:
    if pattern:
        try:
            return re.compile(pattern)
        except re.error:
            pass
    return None


# --------------------------------------------------------------------------------------
# PBIX validations (using pbixray)
# --------------------------------------------------------------------------------------

def analyze_pbix(pbix_path: str, verbose: bool = False) -> Dict[str, Any]:
    """
    Run pbixray against a PBIX file and return a compact model snapshot
    used by rule checks.
    """
    if not HAS_PBIXRAY:
        raise RuntimeError("pbixray is not installed; cannot analyze PBIX.")

    if not os.path.isfile(pbix_path):
        raise FileNotFoundError(f"PBIX not found: {pbix_path}")

    if verbose:
        print(f"[pbix] Loading PBIX: {pbix_path}", file=sys.stderr)

    r = PBIXRay(pbix_path)
    snapshot: Dict[str, Any] = {
        "tables": [],
        "measures": [],
        "relationships": [],
        "calculated_columns": [],
        "m_parameters": [],
        "power_query": []
    }

    # Tables
    try:
        snapshot["tables"] = list(r.tables)
    except Exception as e:
        if verbose: print(f"[pbix] tables error: {e}", file=sys.stderr)

    # Measures
    try:
        snapshot["measures"] = to_records(r.dax_measures)
    except Exception as e:
        if verbose: print(f"[pbix] measures error: {e}", file=sys.stderr)

    # Calculated columns
    try:
        snapshot["calculated_columns"] = to_records(r.dax_columns)
    except Exception as e:
        if verbose: print(f"[pbix] dax_columns error: {e}", file=sys.stderr)

    # Relationships
    try:
        snapshot["relationships"] = to_records(r.relationships)
    except Exception as e:
        if verbose: print(f"[pbix] relationships error: {e}", file=sys.stderr)

    # M Parameters
    try:
        snapshot["m_parameters"] = to_records(r.m_parameters)
    except Exception as e:
        if verbose: print(f"[pbix] m_parameters error: {e}", file=sys.stderr)

    # Power Query
    try:
        snapshot["power_query"] = to_records(r.power_query)
    except Exception as e:
        if verbose: print(f"[pbix] power_query error: {e}", file=sys.stderr)

    return snapshot


def rule_measures_present(model: Dict[str, Any]) -> Tuple[bool, Dict[str, Any]]:
    measures = model.get("measures", [])
    return (len(measures) > 0, {"count": len(measures)})


def rule_parameters_present(model: Dict[str, Any]) -> Tuple[bool, Dict[str, Any]]:
    params = model.get("m_parameters", [])
    return (len(params) > 0, {"count": len(params)})


def rule_relationships_present(model: Dict[str, Any]) -> Tuple[bool, Dict[str, Any]]:
    rels = model.get("relationships", [])
    return (len(rels) > 0, {"count": len(rels)})


def rule_table_naming(model: Dict[str, Any], pattern: Optional[str], allow: List[str]) -> Tuple[bool, Dict[str, Any]]:
    tables = model.get("tables", [])
    rgx = regex_or_none(pattern)
    bad = []
    if rgx:
        for t in tables:
            if t in (allow or []):
                continue
            if not rgx.search(t):
                bad.append(t)
    return (len(bad) == 0, {"violations": bad, "total": len(tables), "regex": pattern, "allow": allow})


def rule_measure_naming(model: Dict[str, Any], pattern: Optional[str]) -> Tuple[bool, Dict[str, Any]]:
    rgx = regex_or_none(pattern)
    bad = []
    if rgx:
        for m in model.get("measures", []):
            name = m.get("Name") or m.get("name") or ""
            if not name or not rgx.search(name):
                bad.append(name)
    return (len(bad) == 0, {"violations": bad, "total": len(model.get("measures", [])), "regex": pattern})


def rule_calc_columns_limit(model: Dict[str, Any], max_cols: int) -> Tuple[bool, Dict[str, Any]]:
    cols = model.get("calculated_columns", [])
    return (len(cols) <= max_cols, {"count": len(cols), "max": max_cols})


# --------------------------------------------------------------------------------------
# PBIP fallback validations
# --------------------------------------------------------------------------------------

def rule_pbip_structure_minimal(pbip_root: str, patterns: List[str]) -> Tuple[bool, Dict[str, Any]]:
    found = []
    for gl in patterns:
        found.extend(glob(os.path.join(pbip_root, gl), recursive=True))
    return (len(found) > 0, {"matches": found[:25], "total_matches": len(found)})


def rule_pbip_roles_best_effort(pbip_root: str, terms: List[str]) -> Tuple[bool, Dict[str, Any]]:
    """
    Naïve scan of TMDL and BIM files to detect 'roles' / 'rowLevelSecurity' keywords.
    This is a best-effort only; not a robust TMDL parser.
    """
    candidates = []
    for ext in ("*.tmdl", "model.bim"):
        candidates.extend(glob(os.path.join(pbip_root, "**", ext), recursive=True))

    hits = []
    for path in candidates:
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read().lower()
                if any(term.lower() in text for term in terms):
                    hits.append(path)
        except Exception:
            # ignore unreadable files
            pass

    return (len(hits) > 0, {"matches": hits[:25], "total_matches": len(hits)})


# --------------------------------------------------------------------------------------
# Rule engine
# --------------------------------------------------------------------------------------

def evaluate_rules(mode: str,
                   ruleset: Dict[str, Any],
                   model_or_path: Dict[str, Any] | str,
                   verbose: bool = False) -> Dict[str, Any]:
    """
    Run all enabled rules applicable to the given 'mode' ("pbix" or "pbip").
    """
    results = []
    failed = 0
    warnings = 0

    for rule in ruleset.get("rules", []):
        if not rule.get("enabled", True):
            continue
        if rule.get("when") not in (mode, "both", None):
            continue

        rid = rule.get("id", "UNKNOWN_RULE")
        level = rule.get("level", "ERROR").upper()
        desc = rule.get("description", "")
        cfg = rule.get("config", {}) or {}

        status = "PASS"
        detail = {}

        try:
            if mode == "pbix":
                m: Dict[str, Any] = model_or_path  # PBIX snapshot

                if rid == "MEASURES_PRESENT":
                    ok, detail = rule_measures_present(m)
                    status = "PASS" if ok else "FAIL"

                elif rid == "PARAMETERS_PRESENT":
                    ok, detail = rule_parameters_present(m)
                    status = "PASS" if ok else "WARN"  # level hint still used below

                elif rid == "RELATIONSHIPS_PRESENT":
                    ok, detail = rule_relationships_present(m)
                    status = "PASS" if ok else "FAIL"

                elif rid == "TABLE_NAMING_PATTERN":
                    ok, detail = rule_table_naming(
                        m,
                        cfg.get("regex"),
                        cfg.get("allow", [])
                    )
                    status = "PASS" if ok else "WARN"

                elif rid == "MEASURE_NAMING_PATTERN":
                    ok, detail = rule_measure_naming(m, cfg.get("regex"))
                    status = "PASS" if ok else "WARN"

                elif rid == "CALCULATED_COLUMNS_LIMIT":
                    ok, detail = rule_calc_columns_limit(m, int(cfg.get("max", 75)))
                    status = "PASS" if ok else "WARN"

                else:
                    status = "PASS"
                    detail = {"info": "Rule not applicable/implemented in PBIX mode."}

            elif mode == "pbip":
                root: str = model_or_path  # PBIP root path

                if rid == "PBIP_STRUCTURE_MINIMAL":
                    ok, detail = rule_pbip_structure_minimal(root, cfg.get("globs_any", []))
                    status = "PASS" if ok else "FAIL"

                elif rid == "PBIP_ROLES_PRESENT_BEST_EFFORT":
                    ok, detail = rule_pbip_roles_best_effort(root, cfg.get("search_terms", []))
                    status = "PASS" if ok else "WARN"

                else:
                    status = "PASS"
                    detail = {"info": "Rule not applicable/implemented in PBIP mode."}

            else:
                status = "WARN"
                detail = {"info": f"Unknown mode {mode}"}

        except Exception as e:
            status = "FAIL" if level == "ERROR" else "WARN"
            detail = {"exception": str(e)}

        # Honor 'level' for counting failures/warns
        effective = status
        if status != "PASS":
            if level == "ERROR":
                failed += 1
                effective = "FAIL"
            else:
                warnings += 1
                effective = "WARN"

        results.append({
            "id": rid,
            "level": level,
            "status": effective,
            "description": desc,
            "details": detail
        })

    return {
        "rules": results,
        "summary": {
            "failed": failed,
            "warnings": warnings,
            "passed": sum(1 for r in results if r["status"] == "PASS")
        }
    }


# --------------------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Validate PBIX/PBIP against migration rules.")
    ap.add_argument("--pbix", help="Path to PBIX file (preferred validation mode)")
    ap.add_argument("--pbip", help="Path to PBIP root folder (fallback mode)")
    ap.add_argument("--rules", help="Path to YAML rules file (optional)")
    ap.add_argument("--md-guide", help="Path to migration guide markdown (optional)")
    ap.add_argument("--out", help="Path to write JSON report (optional)")
    ap.add_argument("--verbose", action="store_true", help="Verbose logging")
    return ap.parse_args()


def main():
    args = parse_args()

    # Load rules (YAML optional)
    ruleset = load_yaml_rules(args.rules)

    report: Dict[str, Any] = {
        "mode": None,
        "summary": {"failed": 0, "warnings": 0, "passed": 0},
        "rules": [],
        "meta": {
            "pbix": args.pbix or "",
            "pbip": args.pbip or "",
            "rules_file": args.rules or "",
            "md_guide": args.md_guide or "",
        }
    }

    # Preferred: PBIX mode
    if args.pbix and os.path.isfile(args.pbix):
        if not HAS_PBIXRAY:
            print("[validate] pbixray not installed; cannot validate PBIX. Falling back to PBIP if provided.",
                  file=sys.stderr)
        else:
            try:
                snapshot = analyze_pbix(args.pbix, verbose=args.verbose)
                res = evaluate_rules("pbix", ruleset, snapshot, verbose=args.verbose)
                report["mode"] = "pbix"
                report["rules"] = res["rules"]
                report["summary"] = res["summary"]
            except Exception as e:
                print(f"[validate] PBIX analysis failed: {e}", file=sys.stderr)
                # Attempt fallback to PBIP if available
                if args.pbip and os.path.isdir(args.pbip):
                    res = evaluate_rules("pbip", ruleset, args.pbip, verbose=args.verbose)
                    report["mode"] = "pbip"
                    report["rules"] = res["rules"]
                    report["summary"] = res["summary"]
                else:
                    # No fallback
                    print("[validate] No PBIP fallback provided.", file=sys.stderr)
                    print(json.dumps(report, indent=2))
                    sys.exit(2)

    # PBIP fallback (if mode not set yet)
    if report["mode"] is None:
        if args.pbip and os.path.isdir(args.pbip):
            res = evaluate_rules("pbip", ruleset, args.pbip, verbose=args.verbose)
            report["mode"] = "pbip"
            report["rules"] = res["rules"]
            report["summary"] = res["summary"]
        else:
            print("[validate] No valid PBIX or PBIP target supplied.", file=sys.stderr)
            print(json.dumps(report, indent=2))
            sys.exit(2)

    # Write/print results
    j = json.dumps(report, indent=2)
    print(j)

    if args.out:
        try:
            with open(args.out, "w", encoding="utf-8") as f:
                f.write(j)
        except Exception as e:
            print(f"[validate] Failed to write output to {args.out}: {e}", file=sys.stderr)

    # Exit code
    fail_on_warn = bool(ruleset.get("options", {}).get("fail_on_warn", False))
    failed = report["summary"]["failed"]
    warns = report["summary"]["warnings"]

    if failed > 0:
        sys.exit(1)
    if fail_on_warn and warns > 0:
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()