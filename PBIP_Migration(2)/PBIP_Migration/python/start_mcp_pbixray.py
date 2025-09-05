"""
start_mcp_pbixray.py
- Thin wrapper to start a PBIXRay MCP server if installed.
- Package: mseep-pbixray-mcp-server (PyPI). [8](https://www.andrewvillazon.com/)
"""

import importlib, sys

def main():
    try:
        m = importlib.import_module("mseep_pbixray_mcp_server")
    except Exception as e:
        print("mseep-pbixray-mcp-server not installed or import failed:", e)
        print("Install with: pip install mseep-pbixray-mcp-server")
        sys.exit(1)

    # If the package exposes a main() entrypoint:
    if hasattr(m, "main"):
        sys.exit(m.main())
    else:
        print("Package imported, but no main() found. Check project docs.")
        sys.exit(1)

if __name__ == "__main__":
    main()