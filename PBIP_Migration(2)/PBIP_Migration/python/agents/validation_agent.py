#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
validation_agent.py
Runs validate_orchestrator.py (pbixray + rules) and emits a single report JSON.

Accepts PBIX or PBIT + PBIP fallback. Returns exit 0 if no ERROR-level failures.
"""

import argparse, json, os, sys, time, subprocess
from pathlib import Path

def run(cmd: list[str]):
    p = subprocess.run(cmd, capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pbix")
    ap.add_argument("--pbit")
    ap.add_argument("--pbip", required=True)
    ap.add_argument("--rules")
    ap.add_argument("--md-guide")
    ap.add_argument("--extra-checks", default="")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    here = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    orch = os.path.join(here, "validate_orchestrator.py")
    if not os.path.isfile(orch):
        print(json.dumps({"ok": False, "error": "validate_orchestrator.py not found"}))
        sys.exit(1)

    cmd = [sys.executable or "python", orch]
    if args.pbix and os.path.isfile(args.pbix): cmd += ["--pbix", args.pbix]
    if args.pbit and os.path.isfile(args.pbit): cmd += ["--pbit", args.pbit]
    if args.pbip: cmd += ["--pbip", args.pbip]
    if args.rules: cmd += ["--rules", args.rules]
    if args.md_guide: cmd += ["--md-guide", args.md_guide]
    if args.extra_checks: cmd += ["--extra-checks", args.extra_checks]
    cmd += ["--run-rules", "true"]

    code, out, err = run(cmd)

    Path(os.path.dirname(args.out)).mkdir(parents=True, exist_ok=True)
    try:
        data = json.loads(out or "{}")
    except Exception:
        data = {"parse_error": err[-4000:], "raw": out[-4000:]}

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    print(json.dumps({
        "ok": code == 0,
        "exitCode": code,
        "reportPath": args.out,
        "_meta": {"ts": time.time(), "agent": "validation_agent"}
    }))
    sys.exit(code)

if __name__ == "__main__":
    main()