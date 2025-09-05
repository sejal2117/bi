#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
validate_orchestrator.py

Purpose
-------
A small orchestrator invoked by the Elysia /validate endpoint. It:
  - Prefers validating a compiled PBIX using `pbixray` (deep model snapshot).
  - Falls back to PBIP checks if PBIX is not available.
  - Supports "extra checks" flags for quick heuristics.
  - Can optionally call `validate_migration_rules.py` and merge that report.

Outputs a single JSON blob to stdout (and optionally to --emit file) and
exits with:
  0 -> success
  1 -> any error-level failures
  2 -> nothing to validate (no PBIX and no PBIP root resolved)

Usage (examples)
----------------
# With PBIX:
python validate_orchestrator.py --pbix ../elysia-server/build-output.pbix

# With PBIT and PBIP root set via env PBIP_REPO_PATH:
python validate_orchestrator.py --pbit ../elysia-server/build-output.pbit

# With extra checks and rules runner:
python validate_orchestrator.py \
  --pbix ../build-output.pbix \
  --extra-checks has_date_dimension,no_inactive_relationships \
  --run-rules true \
  --rules ./rules.yaml \
  --md-guide ../SAP_BO_to_PowerBI_Migration_Guide.md \
  --emit ./orchestrator_report.json

Notes
-----
- PBIX validation requires pbixray. Install via `pip install pbixray`  [1](https://blogs.diggibyte.com/power-bi-enhanced-report-format-pbir-developer-mode/)
- PBIP fallback leverages PBIP project structure (text-based format).  [2](https://community.fabric.microsoft.com/t5/Desktop/Conversion-of-PBIP-to-PBIX-PBIT-and-uploading-the-report-to/td-p/4722580)
- Compile semantics (PBIX vs PBIT) are determined by pbi-tools.core.   [3](https://www.andrewvillazon.com/)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import subprocess
from glob import glob
from typing import Any, Dict, List, Optional, Tuple

# ---------- Optional dependency: pbixray (for PBIX mode) ----------
try:
    from pbixray import PBIXRay  # type: ignore
    HAS_PBIXRAY = True
except Exception:
    HAS_PBIXRAY = False


# --------------------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------------------

def log_err(msg: str):
    print(f"[orchestrator] {msg}", file=sys.stderr)


def to_records(df_like) -> List[Dict[str, Any]]:
    """
    Convert a pandas-like DataFrame to list-of-dicts if possible; else stringify.
    """
    try:
        return df_like.to_dict(orient="records")
    except Exception:
        try:
            return list(df_like)
        except Exception:
            return [{"raw": str(df_like)}]


def find_pbip_root(explicit: Optional[str], pbit_path: Optional[str]) -> Optional[str]:
    """
    Resolve PBIP root directory:
      1) If explicit path is provided and is a folder, use it.
      2) If env PBIP_REPO_PATH is set and exists, use it.
      3) If pbit is provided, walk up ancestor directories looking for *.pbip marker.
      4) Otherwise, return None.
    """
    if explicit and os.path.isdir(explicit):
        return os.path.abspath(explicit)

    env_path = os.getenv("PBIP_REPO_PATH")
    if env_path and os.path.isdir(env_path):
        return os.path.abspath(env_path)

    if pbit_path:
        start = os.path.abspath(os.path.dirname(pbit_path))
        current = start
        while True:
            # a PBIP root usually contains a *.pbip file next to *.Report/ *.SemanticModel folders
            hits = glob(os.path.join(current, "*.pbip"))
            if hits:
                return current
            parent = os.path.abspath(os.path.join(current, ".."))
            if parent == current:
                break
            current = parent

    return None


# --------------------------------------------------------------------------------------
# PBIX Snapshot (using pbixray)
# --------------------------------------------------------------------------------------

def snapshot_pbix(pbix_path: str) -> Dict[str, Any]:
    """
    Build a compact snapshot of the PBIX model using pbixray.
    """
    if not HAS_PBIXRAY:
        raise RuntimeError("pbixray not installed; cannot process PBIX.")

    if not os.path.isfile(pbix_path):
        raise FileNotFoundError(f"PBIX not found: {pbix_path}")

    r = PBIXRay(pbix_path)
    snap: Dict[str, Any] = {
        "tables": [],
        "measures": [],
        "relationships": [],
        "calculated_columns": [],
        "m_parameters": [],
        "power_query": [],
        "metadata": {}
    }

    try:
        snap["tables"] = list(r.tables)
    except Exception as e:
        log_err(f"tables error: {e}")

    try:
        snap["measures"] = to_records(r.dax_measures)
    except Exception as e:
        log_err(f"measures error: {e}")

    try:
        snap["relationships"] = to_records(r.relationships)
    except Exception as e:
        log_err(f"relationships error: {e}")

    try:
        snap["calculated_columns"] = to_records(r.dax_columns)
    except Exception as e:
        log_err(f"calculated_columns error: {e}")

    try:
        snap["m_parameters"] = to_records(r.m_parameters)
    except Exception as e:
        log_err(f"m_parameters error: {e}")

    try:
        snap["power_query"] = to_records(r.power_query)
    except Exception as e:
        log_err(f"power_query error: {e}")

    try:
        snap["metadata"] = r.metadata
    except Exception:
        pass

    return snap


# --------------------------------------------------------------------------------------
# Quick heuristic checks (lightweight, complements rule runner)
# --------------------------------------------------------------------------------------

def check_has_measures(snap: Dict[str, Any]) -> Tuple[bool, Dict[str, Any]]:
    ms = snap.get("measures", [])
    return (len(ms) > 0, {"count": len(ms)})

def check_has_relationships(snap: Dict[str, Any]) -> Tuple[bool, Dict[str, Any]]:
    rels = snap.get("relationships", [])
    return (len(rels) > 0, {"count": len(rels)})

def check_has_date_dimension(snap: Dict[str, Any]) -> Tuple[bool, Dict[str, Any]]:
    # Heuristic: look for a table whose name contains Date/Calendar
    tables = [t.lower() for t in snap.get("tables", [])]
    ok = any(("date" in t or "calendar" in t) for t in tables)
    return (ok, {"hint": "Looking for common shared date dimension by name"})

def check_no_inactive_relationships(snap: Dict[str, Any]) -> Tuple[bool, Dict[str, Any]]:
    rels = snap.get("relationships", [])
    inactive = [r for r in rels if str(r.get("IsActive", r.get("isActive", ""))).lower() in ("false", "0")]
    return (len(inactive) == 0, {"inactive_count": len(inactive)})

def check_parameters_present(snap: Dict[str, Any]) -> Tuple[bool, Dict[str, Any]]:
    params = snap.get("m_parameters", [])
    return (len(params) > 0, {"count": len(params)})


EXTRA_CHECKS = {
    "has_date_dimension": check_has_date_dimension,
    "no_inactive_relationships": check_no_inactive_relationships,
    "parameters_present": check_parameters_present
}


# --------------------------------------------------------------------------------------
# PBIP fallback
# --------------------------------------------------------------------------------------

def pbip_fallback_report(pbip_root: str) -> Dict[str, Any]:
    """
    Minimal PBIP checks: ensure project markers exist (definition/model files).
    This is a best-effort sanity check while PBIX is unavailable.
    """
    required_globs = [
        "**/*.pbip",               # project file
        "**/*.tmdl",               # TMDL model files
        "**/model.bim",            # legacy BIM
        "**/definition.pbir",      # report def (new format)
        "**/report.json"           # legacy report def
    ]
    found = []
    for g in required_globs:
        found.extend(glob(os.path.join(pbip_root, g), recursive=True))

    return {
        "root": pbip_root,
        "found_count": len(found),
        "sample": found[:25],   # limit output
        "note": "PBIP fallback is structural only; compile to PBIX for deep validation."
    }


# --------------------------------------------------------------------------------------
# Optional: call validate_migration_rules.py and merge its report
# --------------------------------------------------------------------------------------

def run_rules_runner(pbix: Optional[str],
                     pbip: Optional[str],
                     rules: Optional[str],
                     md_guide: Optional[str]) -> Optional[Dict[str, Any]]:
    """
    Invoke validate_migration_rules.py if present. Returns parsed JSON or None.
    """
    here = os.path.abspath(os.path.dirname(__file__))
    runner = os.path.join(here, "validate_migration_rules.py")
    if not os.path.isfile(runner):
        log_err("validate_migration_rules.py not found; skipping rules runner.")
        return None

    cmd = [sys.executable or "python", runner]
    if pbix: cmd += ["--pbix", pbix]
    if pbip: cmd += ["--pbip", pbip]
    if rules: cmd += ["--rules", rules]
    if md_guide: cmd += ["--md-guide", md_guide]

    try:
        out = subprocess.check_output(cmd, stderr=subprocess.STDOUT, text=True)
        return json.loads(out.strip() or "{}")
    except subprocess.CalledProcessError as e:
        log_err(f"rules runner failed: {e.output}")
    except Exception as e:
        log_err(f"rules runner error: {e}")

    return None


# --------------------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="PBIX/PBIP validation orchestrator.")
    ap.add_argument("--pbix", help="Path to PBIX file (preferred for deep validation)")
    ap.add_argument("--pbit", help="Path to compiled PBIT (if PBIX not available)")
    ap.add_argument("--pbip", help="PBIP project root (optional; will attempt to auto-detect)")

    ap.add_argument("--extra-checks", default="", help="Comma-separated flags (e.g., has_date_dimension,no_inactive_relationships,parameters_present)")
    ap.add_argument("--run-rules", default="false", choices=["true", "false"], help="Also run validate_migration_rules.py and merge output")
    ap.add_argument("--rules", help="Rules YAML file for validate_migration_rules.py (optional)")
    ap.add_argument("--md-guide", help="Path to migration guide markdown (optional)")
    ap.add_argument("--emit", help="Write orchestrator JSON report here (optional)")
    return ap.parse_args()


def main():
    args = parse_args()

    report: Dict[str, Any] = {
        "mode": None,
        "paths": {
            "pbix": args.pbix or "",
            "pbit": args.pbit or "",
            "pbip": args.pbip or "",
        },
        "checks": [],
        "snapshot": {},
        "pbipFallback": {},
        "rulesReport": None,
        "summary": { "errors": 0, "warnings": 0, "notes": [] }
    }

    # Determine PBIP root if not provided
    pbip_root = args.pbip or find_pbip_root(args.pbip, args.pbit)
    if pbip_root:
        report["paths"]["pbip"] = pbip_root

    # Preferred: PBIX mode
    if args.pbix and os.path.isfile(args.pbix) and HAS_PBIXRAY:
        report["mode"] = "pbix"
        try:
            snap = snapshot_pbix(args.pbix)
            report["snapshot"] = {
                "tables_count": len(snap.get("tables", [])),
                "measures_count": len(snap.get("measures", [])),
                "relationships_count": len(snap.get("relationships", [])),
                "calculated_columns_count": len(snap.get("calculated_columns", [])),
                "parameters_count": len(snap.get("m_parameters", []))
            }

            # Baseline quick checks
            ok, detail = check_has_measures(snap)
            report["checks"].append({"id": "has_measures", "status": "PASS" if ok else "ERROR", "details": detail})
            if not ok: report["summary"]["errors"] += 1

            ok, detail = check_has_relationships(snap)
            report["checks"].append({"id": "has_relationships", "status": "PASS" if ok else "ERROR", "details": detail})
            if not ok: report["summary"]["errors"] += 1

            # Extra checks
            flags = [f.strip() for f in (args.extra_checks or "").split(",") if f.strip()]
            for flag in flags:
                fn = EXTRA_CHECKS.get(flag)
                if not fn:
                    report["checks"].append({"id": flag, "status": "WARN", "details": {"note": "Unknown extra check"}})
                    report["summary"]["warnings"] += 1
                    continue
                ok, detail = fn(snap)
                report["checks"].append({"id": flag, "status": "PASS" if ok else "WARN", "details": detail})
                if not ok: report["summary"]["warnings"] += 1

        except Exception as e:
            report["summary"]["errors"] += 1
            report["checks"].append({"id": "pbix_snapshot", "status": "ERROR", "details": {"exception": str(e)}})

    else:
        # PBIP fallback (if we can locate the root)
        if pbip_root and os.path.isdir(pbip_root):
            report["mode"] = "pbip-fallback"
            report["pbipFallback"] = pbip_fallback_report(pbip_root)
            # Mark as WARN to indicate limited validation depth
            report["checks"].append({"id": "pbip_fallback", "status": "WARN", "details": {"note": "PBIX not available; structural PBIP check only"}})
            report["summary"]["warnings"] += 1
        else:
            # Nothing to validate
            print(json.dumps(report, indent=2))
            sys.exit(2)

    # Optionally run full migration rule validator and merge
    if args.run_rules.lower() == "true":
        merged = run_rules_runner(
            pbix=args.pbix if (args.pbix and os.path.isfile(args.pbix)) else None,
            pbip=pbip_root if (pbip_root and os.path.isdir(pbip_root)) else None,
            rules=args.rules,
            md_guide=args.md_guide
        )
        if merged:
            report["rulesReport"] = merged
            # Bubble up failures/warnings into orchestrator summary
            try:
                report["summary"]["errors"]   += int(merged.get("summary", {}).get("failed", 0))
                report["summary"]["warnings"] += int(merged.get("summary", {}).get("warnings", 0))
            except Exception:
                pass
        else:
            report["checks"].append({"id": "rules_runner", "status": "WARN", "details": {"note": "validate_migration_rules.py not executed"}})
            report["summary"]["warnings"] += 1

    # Emit & exit
    out = json.dumps(report, indent=2)
    print(out)
    if args.emit:
        try:
            with open(args.emit, "w", encoding="utf-8") as f:
                f.write(out)
        except Exception as e:
            log_err(f"Failed to write --emit file: {e}")

    # Exit code policy: any ERRORs => 1, else 0
    sys.exit(1 if report["summary"]["errors"] > 0 else 0)


if __name__ == "__main__":
    main()