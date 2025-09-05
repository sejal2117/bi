from typing import List, Dict, Any, IO
from utils.expression_extractor import extract_expressions
from agents.translator_agent import translate_expression, translate_batch_from_list

def harvest_expressions_from_file(fileobj: IO, max_hits: int = 5000) -> List[Dict[str, Any]]:
    fileobj.seek(0)
    return extract_expressions(fileobj, max_hits=max_hits)

def translate_selected(expressions: List[str], source: str, target: str, prefer_nim: bool = True) -> Dict[str, Any]:
    return translate_batch_from_list(expressions, source, target, prefer_nim=prefer_nim)
