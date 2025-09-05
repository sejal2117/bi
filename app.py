# app.py
import streamlit as st
import json
import pandas as pd
from utils.expression_extractor import extract_expressions, enhance_with_nim

# Page configuration
st.set_page_config(
    page_title="SAP BO to Power BI Migrator",
    page_icon="🔄",
    layout="wide"
)

# Custom CSS
st.markdown("""
<style>
    .main-header { font-size: 2.5rem; color: #1f77b4; }
    .sub-header { font-size: 1.5rem; color: #ff7f0e; }
    .expression-box { 
        background-color: #f0f2f6; 
        padding: 15px; 
        border-radius: 10px; 
        margin: 10px 0; 
    }
    .dax-box { 
        background-color: #e6f7ff; 
        padding: 15px; 
        border-radius: 10px; 
        margin: 10px 0; 
    }
</style>
""", unsafe_allow_html=True)

# App header
st.markdown('<h1 class="main-header">🔄 SAP BO to Power BI Migration Tool</h1>', unsafe_allow_html=True)
st.markdown("Extract and transform SAP BusinessObjects expressions to Power BI DAX")

# Sidebar for configuration
with st.sidebar:
    st.header("Configuration")
    nvidia_api_key = st.text_input(
        "NVIDIA API Key (for NIM translations)",
        type="password",
        help="Get your API key from NVIDIA AI Foundation"
    )
    
    max_expressions = st.slider("Max expressions to extract", 10, 500, 100)
    enable_nim = st.checkbox("Enable NIM Translations", value=True)
    
    st.info("💡 NIM handles complex expressions that rule-based methods can't convert accurately")

# File upload section
st.markdown('<h2 class="sub-header">📁 Upload SAP BO JSON File</h2>', unsafe_allow_html=True)
uploaded_file = st.file_uploader("Choose a JSON file", type="json")

if uploaded_file is not None:
    try:
        # Read file content
        file_content = uploaded_file.getvalue().decode("utf-8")
        
        # Extract expressions
        with st.spinner("Extracting expressions..."):
            expressions = extract_expressions(file_content, max_expressions)
        
        if not expressions:
            st.warning("No transformable expressions found in the file.")
            st.stop()
        
        # Enhance with NIM if enabled
        if enable_nim and nvidia_api_key:
            with st.spinner("Translating complex expressions with NIM..."):
                expressions = enhance_with_nim(expressions, nvidia_api_key)
        
        # Display statistics
        col1, col2, col3 = st.columns(3)
        total_expressions = len(expressions)
        nim_expressions = sum(1 for e in expressions if e.get('translation_method') == 'NIM')
        
        with col1:
            st.metric("Total Expressions", total_expressions)
        with col2:
            st.metric("NIM Translations", nim_expressions)
        with col3:
            st.metric("Rule-based", total_expressions - nim_expressions)
        
        # Display expressions in tabs
        tab1, tab2, tab3 = st.tabs(["📋 Expressions List", "📊 Analysis", "💾 Export Results"])
        
        with tab1:
            st.markdown('<h3 class="sub-header">Extracted Expressions</h3>', unsafe_allow_html=True)
            
            for i, expr in enumerate(expressions):
                with st.expander(f"{i+1}. {expr.get('object_type', 'unknown')} - {expr.get('object_name', 'unknown')}"):
                    col1, col2 = st.columns(2)
                    
                    with col1:
                        st.markdown("**SAP BO Expression:**")
                        st.code(expr['text'], language='sql')
                        st.caption(f"Type: {expr.get('object_type', 'unknown')} • Field: {expr.get('field_type', 'unknown')}")
                    
                    with col2:
                        if expr.get('nim_translation'):
                            st.markdown("**NIM DAX Translation:**")
                            st.code(expr['nim_translation']['dax_translation'], language='dax')
                            st.caption(f"Method: NIM • Confidence: {expr['nim_translation']['confidence']}")
                        else:
                            st.markdown("**Translation Method:**")
                            st.info("Rule-based conversion (simple patterns)")
        
        with tab2:
            st.markdown('<h3 class="sub-header">Migration Analysis</h3>', unsafe_allow_html=True)
            
            # Create analysis data
            object_types = [expr.get('object_type', 'unknown') for expr in expressions]
            translation_methods = [expr.get('translation_method', 'rule_based') for expr in expressions]
            
            col1, col2 = st.columns(2)
            
            with col1:
                st.subheader("By Object Type")
                type_counts = pd.Series(object_types).value_counts()
                st.bar_chart(type_counts)
            
            with col2:
                st.subheader("By Translation Method")
                method_counts = pd.Series(translation_methods).value_counts()
                st.bar_chart(method_counts)
        
        with tab3:
            st.markdown('<h3 class="sub-header">Export Results</h3>', unsafe_allow_html=True)
            
            # Prepare data for export
            export_data = []
            for expr in expressions:
                export_data.append({
                    'Object Type': expr.get('object_type', ''),
                    'Object Name': expr.get('object_name', ''),
                    'Field Type': expr.get('field_type', ''),
                    'SAP BO Expression': expr['text'],
                    'Translation Method': expr.get('translation_method', ''),
                    'DAX Translation': expr.get('nim_translation', {}).get('dax_translation', '') if expr.get('nim_translation') else 'Rule-based conversion',
                    'Confidence': expr.get('nim_translation', {}).get('confidence', '') if expr.get('nim_translation') else 'high'
                })
            
            df = pd.DataFrame(export_data)
            
            st.dataframe(df)
            
            # Download buttons
            csv = df.to_csv(index=False)
            json_export = json.dumps(export_data, indent=2)
            
            col1, col2 = st.columns(2)
            with col1:
                st.download_button(
                    "📥 Download CSV",
                    csv,
                    "sapbo_to_powerbi_results.csv",
                    "text/csv"
                )
            with col2:
                st.download_button(
                    "📥 Download JSON",
                    json_export,
                    "sapbo_to_powerbi_results.json",
                    "application/json"
                )
    
    except Exception as e:
        st.error(f"Error processing file: {str(e)}")

else:
    st.info("👆 Please upload a SAP BO JSON file to get started")
    st.markdown("""
    ### Expected JSON Structure:
    The tool looks for expressions in fields like:
    - `sql_definition`
    - `where_expression` 
    - `expression`
    - `formula`
    - `calculation`
    - `measure`
    - `filter_expression`
    - `calculated_member`
    
    ### Supported Objects:
    - Dimensions
    - Measures
    - Filters
    - Attributes
    - Calculations
    """)

# Footer
st.markdown("---")
st.markdown("**✨ Features:**")
st.markdown("""
- Automatic expression extraction from SAP BO JSON
- Smart detection of complex expressions needing NIM
- NVIDIA AI-powered DAX translation
- Comprehensive analysis and export capabilities
- Clean, interactive Streamlit interface
""")


'''# app.py (simplified SAP BO to Power BI version)
import streamlit as st
import pandas as pd
import json
from io import BytesIO, StringIO
from dotenv import load_dotenv
import os
 
load_dotenv()
 
try:
    from agents.logic_translator_agent import harvest_expressions_from_file, translate_selected
    from utils.tfidf_index import TFIDFIndex
except Exception as e:
    st.error(f"Import error: {e}")
    st.stop()
 
# Page config
st.set_page_config(page_title="SAP BO to Power BI Translator", layout="wide")
st.title("🧠 SAP BO to Power BI Logic Translator")
 
# Sidebar: Settings
with st.sidebar:
    st.header("Settings")
    source = "SAPBO"  # Fixed source
    target = "PowerBI"  # Fixed target
    prefer_nim = st.checkbox("Prefer NIM refinement", value=True)
    max_hits = int(os.getenv("MAX_EXTRACT_HITS", "5000"))
    st.markdown("---")
    st.caption("NIM enabled: " + ("Yes" if os.getenv("NIM_ENABLED","true").lower()=="true" else "No"))
 
# Input area
st.markdown("Upload SAP BO metadata JSON or paste a SAP BO expression.")
uploaded = st.file_uploader("Upload SAP BO metadata JSON", type=["json", "xml", "txt"])
paste = st.text_area("Or paste a SAP BO expression for quick translation", height=160)
 
# Harvest expressions if file uploaded
hits = []
if uploaded:
    try:
        hits = harvest_expressions_from_file(uploaded, max_hits=max_hits)
        st.success(f"Found {len(hits)} SAP BO expressions")
    except Exception as e:
        st.error(f"Failed to extract expressions: {e}")
        hits = []
 
# Display extracted expressions
if hits:
    df = pd.DataFrame(hits)
    st.subheader("Extracted SAP BO Expressions")
    st.dataframe(df, use_container_width=True, height=300)
 
    # Build TF-IDF index for search
    texts = df["text"].tolist()
    idx = TFIDFIndex()
    idx.fit(texts)
 
    # Search box
    q = st.text_input("Filter expressions (search)", value="")
    if q.strip():
        matches = idx.search(q.strip(), top_k=200)
        rows = [i for i, _ in matches]
        view_df = df.iloc[rows].reset_index(drop=True)
    else:
        view_df = df.reset_index(drop=True)
 
    st.subheader("Select expressions to translate to Power BI DAX")
    choices = view_df.index.tolist()
    format_func = lambda i: f"{view_df.loc[i, 'text'][:120]}..."
    
    # Add Translate All button
    col1, col2 = st.columns([3, 1])
    with col1:
        selected = st.multiselect("Select expressions", options=choices, format_func=format_func)
    with col2:
        translate_all = st.button("Translate All", help="Translate all detected expressions")
 
    # Translate selected button
    if st.button("Translate Selected Expressions") or translate_all:
        if translate_all:
            # Translate all expressions
            selections = view_df["text"].tolist()
            st.info(f"Translating all {len(selections)} expressions...")
        elif not selected:
            st.warning("Select at least one expression to translate.")
            st.stop()
        else:
            selections = [view_df.loc[i, "text"] for i in selected]
        
        with st.spinner(f"Translating {len(selections)} expressions..."):
            result = translate_selected(selections, source, target, prefer_nim=prefer_nim)
        
        out_rows = []
        for r in result["results"]:
            out_rows.append({
                "original": r.get("source_expression", ""),
                "rule_translation": r.get("rule", {}).get("translation", ""),
                "rule_confidence": r.get("rule", {}).get("confidence", 0.0),
                "nim_translation": (r.get("nim") or {}).get("translation", ""),
                "nim_confidence": (r.get("nim") or {}).get("confidence", 0.0),
                "chosen": r.get("chosen", "")
            })
        
        out_df = pd.DataFrame(out_rows)
        st.subheader("Translations to Power BI DAX")
        st.dataframe(out_df, use_container_width=True)
 
        # CSV download
        buf = BytesIO()
        out_df.to_csv(buf, index=False)
        buf.seek(0)
        st.download_button("Download translations (CSV)", data=buf, file_name="sapbo_to_powerbi_translations.csv", mime="text/csv")
 
# Paste case: translate a single pasted expression
if paste:
    st.subheader("Translate pasted SAP BO expression")
    if st.button("Translate Pasted Expression"):
        with st.spinner("Translating pasted expression..."):
            res = translate_selected([paste], source, target, prefer_nim=prefer_nim)
        rr = res["results"][0]
        
        st.markdown("**Original SAP BO Expression**")
        st.code(paste)
        
        st.markdown("**Rule-based DAX Translation**")
        st.code(rr.get("rule", {}).get("translation", "") or "--none--")
        st.write("Rule confidence:", rr.get("rule", {}).get("confidence", 0.0))
        
        st.markdown("**NIM DAX Translation**")
        nim = rr.get("nim")
        if nim:
            st.code(nim.get("translation", "") or "--none--")
            st.write("NIM confidence:", nim.get("confidence", 0.0))
        else:
            st.info("No NIM output (disabled/timed out or not available).")
 
# Footer notes
st.markdown("---")
st.caption("Note: This tool specializes in SAP Business Objects to Power BI conversions.")
 '''