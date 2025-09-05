#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
legacy_extractor.py
Reads metadata from a SOURCE BI export (e.g., SAP BO dump) and emits source_metadata.json.

Local test behavior:
- If --source-dump is provided and is JSON, we normalize it.
- Else we create a small synthetic metadata set to drive the demo pipeline.

Output conforms roughly to contracts/source_metadata.schema.json

This agent is intentionally modular so you can later swap the reader
for SAP BO SDK/API.
"""

import argparse, json, os, sys, time
from pathlib import Path

def load_source_dump(path: str):
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        # Normalize minimal shape
        return {
            "source": data.get("source", "SAP_BO"),
            "universes": data.get("universes", [{"name": "Demo.unx"}]),
            "dimensions": data.get("dimensions", [{"name": "Customer", "type": "string", "path": "DIM_CUSTOMER"}]),
            "measures": data.get("measures", [{"name": "Revenue", "agg": "SUM", "source": "FACT_SALES.REVENUE"}]),
            "prompts": data.get("prompts", [{"name": "DateRange", "type": "date_range"}]),
            "lineage": data.get("lineage", [{"from": "FACT_SALES.REVENUE", "to": "Revenue"}])
        }
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"Failed reading source dump: {e}"}))
        sys.exit(1)

def synthetic_metadata():
    return {
        "source": "SAP_BO",
        "universes": [{"name": "Sales.unx"}],
        "dimensions": [
            {"name": "Customer", "type": "string", "path": "DIM_CUSTOMER"},
            {"name": "OrderDate", "type": "date", "path": "DIM_DATE.ORDER_DATE"}
        ],
        "measures": [
            {"name": "Revenue", "agg": "SUM", "source": "FACT_SALES.REVENUE"},
            {"name": "Orders",  "agg": "COUNT", "source": "FACT_SALES.ORDER_ID"}
        ],
        "prompts": [{"name": "DateRange", "type": "date_range"}],
        "lineage": [{"from": "FACT_SALES.REVENUE", "to": "Revenue"}]
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inputs-dir", required=True)
    ap.add_argument("--source-dump", help="Path to pre-extracted JSON from source BI")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    Path(args.inputs_dir).mkdir(parents=True, exist_ok=True)

    if args.source_dump and os.path.isfile(args.source_dump):
        meta = load_source_dump(args.source_dump)
    else:
        meta = synthetic_metadata()

    # Add provenance
    meta["_meta"] = {"ts": time.time(), "agent": "legacy_extractor"}

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    print(json.dumps({"ok": True, "out": args.out}))

if __name__ == "__main__":
    main()