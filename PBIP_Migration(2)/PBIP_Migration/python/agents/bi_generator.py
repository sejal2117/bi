#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
bi_generator.py
Compiles PBIP -> PBIX (thin) or PBIT (model) using pbi-tools.core.
PBIX only for thin reports; model projects compile to PBIT.                       [4](https://www.andrewvillazon.com/)
"""

import argparse, json, os, sys, time, shlex, subprocess
from pathlib import Path

def run(cmd: str, cwd: str | None = None):
    p = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=cwd)
    return p.returncode, p.stdout, p.stderr

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pbip", required=True)
    ap.add_argument("--artifact", required=True, help="Output file path (.pbix or .pbit)")
    ap.add_argument("--format", choices=["PBIX", "PBIT"], required=True)
    ap.add_argument("--pbi-tools-cmd", default="pbi-tools.core")
    args = ap.parse_args()

    if not os.path.isdir(args.pbip):
        print(json.dumps({"ok": False, "error": "PBIP folder not found"})); sys.exit(1)

    Path(os.path.dirname(args.artifact)).mkdir(parents=True, exist_ok=True)

    cmd = f'{args.pbi_tools_cmd} compile "{args.pbip}" "{args.artifact}" {args.format}'
    code, out, err = run(cmd)

    print(json.dumps({
        "ok": code == 0,
        "command": cmd,
        "exitCode": code,
        "stdout": out[-4000:],
        "stderr": err[-4000:],
        "artifact": args.artifact,
        "format": args.format,
        "_meta": {"ts": time.time(), "agent": "bi_generator"}
    }))
    sys.exit(code)

if __name__ == "__main__":
    main()