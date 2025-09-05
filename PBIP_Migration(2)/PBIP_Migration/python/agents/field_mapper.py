#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
field_mapper.py
Consumes source_metadata.json + (optional) SAP_BO_to_PowerBI_Migration_Guide.md
and emits mapping.json (glossary & lineage mapping).

This is a rule-of-thumb mapper; adjust naming rules as needed.
"""

import argparse, json, os, re, sys, time
from pathlib import Path

def snake_case(x: str) -> str:
    x = re.sub(r'[^A-Za-z0-9]+', '_', x).strip('_')
    return x.lower()

def build_mapping(meta: dict, md_guide_path: str | None):
    table_map = {}
    column_map = []
    param_map = []
    rls_rules = []

    # Simple heuristics: DIM_* → dim_*, FACT_* → fact_*
    for d in meta.get("dimensions", []):
        src = d.get("path") or d.get("name")
        if not src: continue
        if "DIM_" in src.upper():
            tgt_table = "dim_" + snake_case(d.get("name", "unknown"))
            table_map[src.split('.')[0]] = tgt_table

    for m in meta.get("measures", []):
        src = m.get("source", "")
        if not src: continue
        parts = src.split(".")
        if len(parts) == 2:
            src_tbl, src_col = parts
        else:
            src_tbl, src_col = "FACT_UNKNOWN", parts[-1]
        tgt_col = re.sub(r'[^A-Za-z0-9]+', '_', m.get("name","measure"))
        column_map.append({"source": src, "target": tgt_col})

        # map table as fact_*
        table_map.setdefault(src_tbl, "fact_" + snake_case(src_tbl.replace("FACT_", "")))

    for p in meta.get("prompts", []):
        param_map.append({
            "sourcePrompt": p.get("name"),
            "targetParam": "p_" + snake_case(p.get("name", "param"))
        })

    # RLS seed from guide (placeholder)
    if md_guide_path and os.path.isfile(md_guide_path):
        # As a minimal demo, add a generic rule
        rls_rules.append({"role": "AllUsers", "filter": "TRUE()"})

    return {
        "tableMap": [{"source": k, "target": v} for k, v in table_map.items()],
        "columnMap": column_map,
        "parameterMap": param_map,
        "rls": rls_rules,
        "_meta": {"ts": time.time(), "agent": "field_mapper"}
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--metadata", required=True)
    ap.add_argument("--md-guide")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    if not os.path.isfile(args.metadata):
        print(json.dumps({"ok": False, "error": "metadata not found"})); sys.exit(1)

    with open(args.metadata, "r", encoding="utf-8") as f:
        meta = json.load(f)

    mapping = build_mapping(meta, args.md_guide)

    Path(os.path.dirname(args.out)).mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(mapping, f, indent=2)

    print(json.dumps({"ok": True, "out": args.out}))

if __name__ == "__main__":
    main()