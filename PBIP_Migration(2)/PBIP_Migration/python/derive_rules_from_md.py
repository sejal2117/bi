"""
derive_rules_from_md.py
- Reads your SAP_BO_to_PowerBI_Migration_Guide.md and produces a rules JSON
  used by validation scripts.
- The parsing is heuristic; feel free to edit the JSON it creates.

Output: migration_rules.json
"""

import argparse, json, os, re, sys

DEFAULT_RULES = {
    "require_rls": True,                  # RLS roles should exist in the model
    "expect_prompts_as_parameters": True, # BO @Prompt -> Power BI Parameters
    "naming": {
        "measure_case": "PascalCase",     # enforce later if you want
        "dimension_case": "PascalCase"
    },
    "relationships": {
        "require_at_least_one": True
    }
}

def parse_md_to_rules(md_text: str):
    rules = DEFAULT_RULES.copy()

    # Heuristics based on headings/keywords in the guide text you shared
    if re.search(r'@Prompt', md_text, re.IGNORECASE):
        rules["expect_prompts_as_parameters"] = True

    if re.search(r'Row-?level.*(DAX|roles)', md_text, re.IGNORECASE):
        rules["require_rls"] = True

    if re.search(r'Universe.*Dataset', md_text, re.IGNORECASE):
        rules["universe_to_dataset"] = True

    return rules

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--md", required=True, help="Path to SAP_BO_to_PowerBI_Migration_Guide.md")
    ap.add_argument("--out", default="migration_rules.json")
    args = ap.parse_args()

    if not os.path.isfile(args.md):
        print("Markdown file not found:", args.md)
        sys.exit(1)

    with open(args.md, "r", encoding="utf-8") as f:
        md = f.read()

    rules = parse_md_to_rules(md)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(rules, f, indent=2)

    print(f"Wrote {args.out}")

if __name__ == "__main__":
    main()