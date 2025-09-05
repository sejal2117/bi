# expressions_extractor.py
from __future__ import annotations
import json
import re
from typing import List, Dict, Any, IO
import requests
import time

# Essential SAP BO patterns for Power BI transformation
SAPBO_EXPRESSION_PATTERNS = [
    r"@Select\([^)]+\)",
    r"@Prompt\([^)]+\)",
    r"@Aggregate_Aware\([^)]+\)",
    r"\bCase\s+When\s+.*\s+Then\s+.*\s+End\b",
    r"\bIf\s*\([^)]*\)\s+Then\s+[^;]*\s+Else\s+[^;]*",
    r"\bSUM\s*\([^)]+\)",
    r"\bCOUNT\s*\([^)]+\)",
    r"\bAVG\s*\([^)]+\)",
    r"\bMIN\s*\([^)]+\)",
    r"\bMAX\s*\([^)]+\)",
    r"\bYTD\s*\([^)]*\)",
    r"\bQTD\s*\([^)]*\)",
    r"\bMTD\s*\([^)]*\)",
]

SAPBO_EXPRESSION_FIELDS = [
    'sql_definition', 'where_expression', 'expression', 
    'formula', 'calculation', 'filter_expression',
    'measure', 'calculated_member',
]

SAPBO_OBJECT_TYPES = [
    'dimensions', 'measures', 'filters', 'attributes', 'calculations'
]

class NIMTranslator:
    def __init__(self, api_key: str, base_url: str = "https://integrate.api.nvidia.com/v1"):
        self.api_key = api_key
        self.base_url = base_url
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        })
    
    def translate_to_dax(self, sapbo_expression: str, context: Dict[str, Any] = None) -> Dict[str, Any]:
        """Use NIM to translate SAP BO expression to DAX"""
        try:
            context_info = f"Context: {context.get('object_type', 'Unknown')} - {context.get('object_name', 'Unknown')}" if context else ""
            
            prompt = f"""
            <s>[INST]Translate this SAP BO expression to Power BI DAX:

            {context_info}

            Expression:
            ```sql
            {sapbo_expression}
            ```

            Return ONLY the DAX code: [/INST]
            """
            
            payload = {
                "model": "mistralai/mixtral-8x7b-instruct-v0.1",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.1,
                "max_tokens": 1000,
            }
            
            response = self.session.post(f"{self.base_url}/chat/completions", json=payload, timeout=30)
            
            if response.status_code == 200:
                result = response.json()
                dax_code = result['choices'][0]['message']['content'].strip()
                
                if '```' in dax_code:
                    dax_code = dax_code.split('```')[-2].strip() if len(dax_code.split('```')) > 2 else dax_code
                
                return {
                    "dax_translation": dax_code,
                    "translation_method": "NIM",
                    "confidence": "high"
                }
            
        except Exception as e:
            pass
        
        return {
            "dax_translation": "/* Translation failed */",
            "translation_method": "NIM-error",
            "confidence": "low"
        }

def _is_transformable_expression(s: str) -> bool:
    if not s or not isinstance(s, str):
        return False
    
    st = s.strip()
    if len(st) < 3:
        return False
    
    for pattern in SAPBO_EXPRESSION_PATTERNS:
        try:
            if re.search(pattern, st, flags=re.IGNORECASE | re.DOTALL):
                return True
        except:
            continue
    
    return any(func in st for func in ['@Select', '@Prompt', '@Aggregate_Aware'])

def _extract_transformable_expressions(obj, current_path="", results=None):
    if results is None:
        results = []
    
    if isinstance(obj, dict):
        for key, value in obj.items():
            key_lower = key.lower()
            is_essential_field = any(field in key_lower for field in SAPBO_EXPRESSION_FIELDS)
            
            if is_essential_field and isinstance(value, str) and _is_transformable_expression(value):
                obj_name = obj.get('name', obj.get('id', 'unknown'))
                obj_type = "unknown"
                
                if current_path:
                    for part in current_path.split('.'):
                        if part in SAPBO_OBJECT_TYPES:
                            obj_type = part
                            break
                
                results.append({
                    "path": f"{current_path}.{key}" if current_path else key,
                    "text": value.strip(),
                    "object_type": obj_type,
                    "object_name": obj_name,
                    "field_type": key,
                    "needs_nim": _needs_nim_translation(value)
                })
            
            elif isinstance(value, (dict, list)):
                new_path = f"{current_path}.{key}" if current_path else key
                _extract_transformable_expressions(value, new_path, results)
    
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            new_path = f"{current_path}[{i}]"
            _extract_transformable_expressions(item, new_path, results)
    
    return results

def _needs_nim_translation(expression: str) -> bool:
    complex_patterns = [
        r"@Select\([^)]+\)", r"@Prompt\([^)]+\)", r"@Aggregate_Aware\([^)]+\)",
        r"\bCase\s+When.*Then.*End\b", r"\bIf.*Then.*Else.*", r"\bjoin\b.*\bon\b"
    ]
    
    expression_lower = expression.lower()
    for pattern in complex_patterns:
        if re.search(pattern, expression_lower, re.IGNORECASE | re.DOTALL):
            return True
    
    return len(expression) > 200

def extract_expressions(file_content: str, max_hits: int = 1000) -> List[Dict[str, Any]]:
    try:
        json_data = json.loads(file_content)
        expressions = _extract_transformable_expressions(json_data)
        
        unique_expressions = []
        seen_texts = set()
        
        for expr in expressions:
            if expr['text'] not in seen_texts:
                seen_texts.add(expr['text'])
                unique_expressions.append(expr)
                
                if len(unique_expressions) >= max_hits:
                    break
        
        return unique_expressions
        
    except Exception as e:
        return []

def enhance_with_nim(expressions: List[Dict[str, Any]], api_key: str) -> List[Dict[str, Any]]:
    if not api_key or api_key == "Bearer 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":
        return expressions
    
    translator = NIMTranslator(api_key)
    enhanced_expressions = []
    
    for expr in expressions:
        if expr.get('needs_nim', False):
            context = {
                'object_type': expr.get('object_type', ''),
                'object_name': expr.get('object_name', ''),
                'field_type': expr.get('field_type', '')
            }
            nim_result = translator.translate_to_dax(expr['text'], context)
            expr['nim_translation'] = nim_result
            expr['translation_method'] = 'NIM'
        else:
            expr['translation_method'] = 'rule_based'
            expr['nim_translation'] = None
        
        enhanced_expressions.append(expr)
        time.sleep(0.3)
    
    return enhanced_expressions
 



'''# expressions_extractor.py
from __future__ import annotations
import json
import re
from typing import List, Dict, Any, IO
 
# SAP BO specific patterns
SAPBO_SIGNS = [
    r"@Select\([^)]+\)",  # SAP BO @Select syntax
    r"@Prompt\([^)]+\)",  # SAP BO @Prompt syntax
    r"@Aggregate_Aware\([^)]+\)",  # SAP BO Aggregate Aware function
    r"\bIf\s*\([^)]*\)\s+Then\s+[^;]*\s+Else\s+[^;]*",  # SAP BO If-Then-Else
    r"\bCase\s+When\s+.*\s+Then\s+.*\s+End\b",  # SAP BO Case When syntax
    r"\bCurrentDate\s*\(\s*\)",  # SAP BO specific functions
    r"\bCurrentTime\s*\(\s*\)",
    r"\.\w+\.\w+",  # Table.field notation
    r"\.\w+_\w+",  # Table_field notation
]
 
# SAP BO specific keywords and patterns
SAPBO_KEYWORDS = [
    'sql_definition', 'where_expression', 'expression', 
    'formula', 'calculation', 'filter_expression'
]
 
SAPBO_OBJECT_TYPES = [
    'dimensions', 'measures', 'filters', 'attributes',
    'hierarchies', 'levels', 'named_sets'
]
 
def _looks_like_sapbo_expression(s: str) -> bool:
    """Check if a string contains SAP BO specific syntax"""
    if not s or not isinstance(s, str):
        return False
    
    st = s.strip()
    if len(st) < 4:
        return False
    
    # Check for SAP BO specific patterns
    for pattern in SAPBO_SIGNS:
        try:
            if re.search(pattern, st, flags=re.IGNORECASE | re.DOTALL):
                return True
        except re.error:
            continue
    
    # Check for SAP BO specific functions
    if "@Select" in st or "@Prompt" in st or "@Aggregate_Aware" in st:
        return True
    
    # Check for SQL structure (common in SAP BO)
    sql_keywords = ['select', 'from', 'where', 'join', 'group by', 'order by', 'having']
    sql_count = sum(1 for keyword in sql_keywords if re.search(r'\b' + keyword + r'\b', st.lower()))
    
    return sql_count >= 2
 
def _extract_from_json_structure(obj, current_path="", results=None):
    """Recursively extract expressions from JSON structure with SAP BO focus"""
    if results is None:
        results = []
    
    if isinstance(obj, dict):
        for key, value in obj.items():
            # Focus on SAP BO specific fields
            if any(sapbo_key in key.lower() for sapbo_key in SAPBO_KEYWORDS):
                if isinstance(value, str) and _looks_like_sapbo_expression(value):
                    # Extract object name for better context
                    obj_name = obj.get('name', obj.get('id', 'unknown'))
                    obj_type = "unknown"
                    
                    # Determine object type from context
                    if current_path:
                        path_parts = current_path.split('.')
                        for part in path_parts:
                            if part in SAPBO_OBJECT_TYPES:
                                obj_type = part
                                break
                    
                    results.append({
                        "path": f"{current_path}.{key}" if current_path else key,
                        "text": value.strip(),
                        "object_type": obj_type,
                        "object_name": obj_name,
                        "field_type": key
                    })
            
            # Continue recursion
            new_path = f"{current_path}.{key}" if current_path else key
            _extract_from_json_structure(value, new_path, results)
    
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            new_path = f"{current_path}[{i}]"
            _extract_from_json_structure(item, new_path, results)
    
    return results
 
def extract_expressions(fileobj: IO, max_hits: int = 1000) -> List[Dict[str, Any]]:
    """
    Extract SAP BO expressions from a JSON file
    
    Args:
        fileobj: File object containing SAP BO JSON
        max_hits: Maximum number of expressions to extract
    
    Returns:
        List of dictionaries containing expression information
    """
    try:
        # Read and parse the JSON
        fileobj.seek(0)
        content = fileobj.read()
        
        if isinstance(content, bytes):
            content = content.decode('utf-8')
        
        # Parse JSON
        json_data = json.loads(content)
        
        # Extract expressions using structured approach
        expressions = _extract_from_json_structure(json_data)
        
        # Remove duplicates based on text content
        unique_expressions = []
        seen_texts = set()
        
        for expr in expressions:
            if expr['text'] not in seen_texts:
                seen_texts.add(expr['text'])
                unique_expressions.append(expr)
                
                if len(unique_expressions) >= max_hits:
                    break
        
        return unique_expressions
        
    except json.JSONDecodeError as e:
        print(f"JSON parsing error: {e}")
        return []
    except Exception as e:
        print(f"Error extracting expressions: {e}")
        return []
 
# Additional function to test with your specific JSON
def test_sapbo_extractor():
    """Test function with the provided SAP BO JSON structure"""
    try:
        with open('your_sapbo_file.json', 'r', encoding='utf-8') as f:
            expressions = extract_expressions(f)
            
            print(f"Found {len(expressions)} unique SAP BO expressions:")
            print("=" * 100)
            
            for i, expr in enumerate(expressions, 1):
                print(f"\n{i}. Object: {expr.get('object_name', 'N/A')}")
                print(f"   Type: {expr.get('object_type', 'unknown')}")
                print(f"   Field: {expr.get('field_type', 'unknown')}")
                print(f"   Path: {expr['path']}")
                print(f"   Expression: {expr['text'][:150]}...")  # Show first 150 chars
                print("-" * 80)
                
    except FileNotFoundError:
        print("Test file not found. Please update the filename in test_sapbo_extractor()")
    except Exception as e:
        print(f"Error during testing: {e}")
 
if __name__ == "__main__":
    test_sapbo_extractor()
'''