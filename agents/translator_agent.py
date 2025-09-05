from typing import Dict, Any, List, Union, IO
from core.translator_router import translate_hybrid
from core.rulebook import translate_rule_based

def translate_expression(expr: str, source: str, target: str, prefer_nim: bool = True) -> Dict[str, Any]:
    return translate_hybrid(expr, source, target, prefer_nim=prefer_nim)

def translate_batch_from_list(exprs: List[str], source: str, target: str, prefer_nim: bool = True) -> Dict[str, Any]:
    results = []
    for e in exprs:
        r = translate_expression(e, source, target, prefer_nim=prefer_nim)
        r.update({"source_expression": e})
        results.append(r)
    return {"results": results}