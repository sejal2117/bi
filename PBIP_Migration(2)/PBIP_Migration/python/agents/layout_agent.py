#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
layout_agent.py
Applies layout/theme adjustments to a PBIP folder (in the run workspace).

What we safely do (per PBIP docs): place a custom theme or image into
RegisteredResources and ensure the PBIP report resources reference exists.       [3](https://learn.microsoft.com/en-us/power-bi/create-reports/service-export-to-pbix)

In preview, direct edits to some report files are limited; we confine to safe areas.
"""

import argparse, json, os, sys, time
from pathlib import Path
import shutil

def ensure_registered_resources(pbip_root: str):
    # Find report folder (first *.Report under PBIP root)
    report_dirs = list(Path(pbip_root).glob("*.*Report"))
    if not report_dirs:
        return None
    rr = report_dirs[0] / "RegisteredResources"
    rr.mkdir(parents=True, exist_ok=True)
    return rr

def copy_layout_assets(rr_dir: Path, layout_path: str | None):
    assets = []
    if layout_path and os.path.isfile(layout_path):
        # If layout is a JSON theme file, copy as theme.json
        tgt = rr_dir / "theme.json"
        shutil.copy2(layout_path, tgt)
        assets.append(str(tgt))
    return assets

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pbip-src", required=True, help="PBIP folder in the run workspace")
    ap.add_argument("--layout", help="Path to a theme/layout JSON to drop into RegisteredResources")
    args = ap.parse_args()

    if not os.path.isdir(args.pbip_src):
        print(json.dumps({"ok": False, "error": "PBIP folder not found"}))
        sys.exit(1)

    rr = ensure_registered_resources(args.pbip_src)
    if rr is None:
        print(json.dumps({"ok": False, "error": "No Report folder found in PBIP"}))
        sys.exit(1)

    assets = copy_layout_assets(rr, args.layout)

    print(json.dumps({
        "ok": True,
        "pbip": args.pbip_src,
        "registeredResources": str(rr),
        "assets": assets,
        "_meta": {"ts": time.time(), "agent": "layout_agent"}
    }))

if __name__ == "__main__":
    main()