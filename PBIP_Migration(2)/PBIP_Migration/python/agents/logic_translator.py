#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
logic_translator.py
Converts simple SQL-like aggregations to DAX measure stubs and emits translated_logic.json.

This is intentionally conservative: it only covers SUM/COUNT patterns
and emits notes for manual work.
"""

import argparse, json, os, re, sys, time
from pathlib import Path

AGG_MAP = {"SUM": "SUM", "COUNT": "COUNT", "AVG": "AVERAGE"}

def to_dax_measure(table: str, target: str, agg: str, source_col: str):
    agg_fn = AGG_MAP.get(agg.upper(), "SUM")
    return {
        "table": table,
        "name": target,
        "expression": f'{agg_fn}({table}[{source_col}])'
    }

def translate(mapping: dict, sql_path: str | None):
    # Build a reverse map: FACT_SALES.REVENUE -> (fact_sales, Revenue)
    rev = {}
    for cm in mapping.get("columnMap", []):
        src = cm.get("source", "")
        tgt = cm.get("target", "")
        if "." in src:
            src_tbl, src_col = src.split(".", 1)
        else:
            src_tbl, src_col = "fact_unknown", src
        table = None
        for tm in mapping.get("tableMap", []):
            if tm["source"] == src_tbl:
                table = tm["target"]; break
        table = table or "fact_" + re.sub(r'[^A-Za-z0-9]+', '_', src_tbl.lower())
        rev[src] = (table, tgt, src_col)

    dax_measures = []
    notes = []

    # From mapping only (no SQL file): create measures using agg guesses
    for cm in mapping.get("columnMap", []):
        src = cm["source"]
        tgt = cm["target"]
        table, _, src_col = rev[src]
        agg = "SUM" if not src_col.lower().endswith("id") else "COUNT"
        dax_measures.append(to_dax_measure(table, tgt, agg, src_col))

    # Basic SQL parsing if file present (demo)
    if sql_path and os.path.isfile(sql_path):
        try:
            with open(sql_path, "r", encoding="utf-8") as f:
                sql = f.read()
            for m in re.finditer(r'(SUM|COUNT|AVG)\s*\(\s*([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\s*\)', sql, re.I):
                agg, tbl, col = m.groups()
                key = f"{tbl}.{col}"
                if key in rev:
                    table, tgt, src_col = rev[key]
                    dax_measures.append(to_dax_measure(table, tgt, agg, src_col))
                else:
                    notes.append(f"Unmapped SQL reference: {tbl}.{col}")
        except Exception as e:
            notes.append(f"SQL parse failed: {e}")

    return {
        "daxMeasures": dax_measures,
        "calcColumns": [],
        "mQueries": [],
        "notes": notes,
        "_meta": {"ts": time.time(), "agent": "logic_translator"}
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mapping", required=True)
    ap.add_argument("--sql", help="Optional SQL file to parse")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    with open(args.mapping, "r", encoding="utf-8") as f:
        mapping = json.load(f)

    translated = translate(mapping, args.sql)

    Path(os.path.dirname(args.out)).mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(translated, f, indent=2)

    print(json.dumps({"ok": True, "out": args.out}))

if __name__ == "__main__":
    main()