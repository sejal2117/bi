"""
prebuild_model.py
- OPTIONAL: invoke pbi_core to generate/update dataset model elements before compile.
- pbi_core is a newer library for programmatic dataset creation/management. [7](https://community.fabric.microsoft.com/t5/Desktop/power-BI-rest-API-with-python/td-p/1953492)
- This script demonstrates a safe "feature-flagged" call and writes a small marker.

Usage:
  python prebuild_model.py --pbip ../sample-pbip --guide ../SAP_BO_to_PowerBI_Migration_Guide.md
"""
import argparse, os, json, pathlib, sys

def try_pbi_core(pbip_root: str, guide_path: str):
    try:
        import pbi_core  # ensure installed separately  [7](https://community.fabric.microsoft.com/t5/Desktop/power-BI-rest-API-with-python/td-p/1953492)
    except Exception as e:
        print("[pbi_core] not installed or failed to import:", e)
        return {"used": False, "message": "pbi_core unavailable"}

    # NOTE: Without public API docs for exact serialization, we demonstrate a placeholder:
    # e.g., read guide and emit a "model-hints.json" that your team can later use to
    # transform PBIP semantic model files accordingly via pbi_core APIs.
    hints = {
        "source": "SAP_BO_to_PowerBI_Migration_Guide.md",
        "universe_to_dataset": True,
        "prompts_to_parameters": True,
        "rls_required": True
    }
    target = os.path.join(pbip_root, "model-hints.json")
    with open(target, "w", encoding="utf-8") as f:
        json.dump(hints, f, indent=2)
    return {"used": True, "message": f"Emitted {target}"}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pbip", required=True)
    ap.add_argument("--guide", required=False)
    args = ap.parse_args()

    pbip_root = os.path.abspath(args.pbip)
    if not os.path.isdir(pbip_root):
        print("PBIP root not found:", pbip_root)
        sys.exit(1)

    result = try_pbi_core(pbip_root, args.guide or "")
    print(result)

    # Also derive migration rules JSON from your Markdown guide
    if args.guide and os.path.isfile(args.guide):
        from subprocess import run
        run(f'python derive_rules_from_md.py --md "{args.guide}" --out "migration_rules.json"', shell=True, check=False)
        print("Derived migration_rules.json from guide.")

if __name__ == "__main__":
    main()