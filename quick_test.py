import json
from io import StringIO
from agents.logic_translator_agent import harvest_expressions_from_file, translate_selected

def test_with_example(file_path, source, target):
    with open(file_path, "r", encoding="utf-8") as f:
        hits = harvest_expressions_from_file(f)
    print("Found", len(hits), "expressions (sample 10):")
    for h in hits[:10]:
        print("-", h["text"][:120])
    # translate first two
    exprs = [h["text"] for h in hits[:2]]
    res = translate_selected(exprs, source, target, prefer_nim=False)
    print(json.dumps(res, indent=2))

if __name__ == "__main__":
    test_with_example("examples/sapbo_sample.json", "SAPBO", "PowerBI")