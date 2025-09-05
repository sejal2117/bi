# test_rulebook.py
from core.rulebook import translate_rule_based
 
def test_rulebook():
    test_cases = [
        # Basic expressions
        ("If([Revenue] > 10000; 'High'; 'Low')", "IF([Revenue] > 10000, \"High\", \"Low\")"),
        ("If([CustomerType] = 'VIP'; 0.15; 0.05)", "IF([CustomerType] = \"VIP\", 0.15, 0.05)"),
        ("If([SalesAmount] > [SalesTarget]; 'Above Target'; 'Below Target')", "IF([SalesAmount] > [SalesTarget], \"Above Target\", \"Below Target\")"),
        
        # Case statements
        ("Case When [Region] = 'APAC' Then [Sales] * 1.1 When [Region] = 'EMEA' Then [Sales] * 1.05 Else [Sales] End", 
         "SWITCH(TRUE(), [Region] = \"APAC\", [Sales] * 1.1, [Region] = \"EMEA\", [Sales] * 1.05, [Sales])"),
        
        # Where clauses
        ("Sum(Sales.Amount) Where Quarter([OrderDate]) = Quarter(CurrentDate())", 
         "CALCULATE(SUM(Sales[Amount]), QUARTER([OrderDate]) = QUARTER(TODAY()))"),
        ("Sum(Revenue.Amount) Where Year([Transaction Date]) = Year(CurrentDate())", 
         "CALCULATE(SUM(Revenue[Amount]), YEAR([Transaction Date]) = YEAR(TODAY()))"),
        
        # Field references
        ("Sum(Sales.Amount)", "SUM(Sales[Amount])"),
        ("Count(Distinct Customer.ID)", "COUNT(Distinct Customer[ID])"),
        
        # Date functions
        ("Year(CurrentDate())", "YEAR(TODAY())"),
    ]
    
    print("Testing SAP BO to Power BI DAX conversion...")
    print("=" * 60)
    
    all_passed = True
    
    for sapbo_expr, expected_dax in test_cases:
        result = translate_rule_based(sapbo_expr, "sapbo", "powerbi")
        actual_dax = result["translation"]
        confidence = result["confidence"]
        
        status = "PASS" if actual_dax == expected_dax else "FAIL"
        if status == "FAIL":
            all_passed = False
            
        print(f"{status}: {sapbo_expr}")
        print(f"  Expected: {expected_dax}")
        print(f"  Actual:   {actual_dax}")
        print(f"  Confidence: {confidence:.2f}")
        print()
    
    print("=" * 60)
    if all_passed:
        print("All tests PASSED! 🎉")
    else:
        print("Some tests FAILED! ❌")
    
    return all_passed
 
if __name__ == "__main__":
    test_rulebook()
 