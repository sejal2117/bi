"""
auth.py
- Acquires a bearer token via MSAL Client Credentials (service principal)
- Scope: https://analysis.windows.net/powerbi/api/.default
References:
  - pbipy expects you to acquire the bearer token yourself. [5](https://community.fabric.microsoft.com/t5/Desktop/Composite-model-relationships-shared-dimension-tables/td-p/2022952)
"""

import os
import msal

TENANT_ID = os.getenv("AZURE_TENANT_ID")
CLIENT_ID = os.getenv("AZURE_CLIENT_ID")
CLIENT_SECRET = os.getenv("AZURE_CLIENT_SECRET")
SCOPE = ["https://analysis.windows.net/powerbi/api/.default"]

def acquire_bearer_token():
    if not (TENANT_ID and CLIENT_ID and CLIENT_SECRET):
        raise RuntimeError("Missing AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET")

    authority = f"https://login.microsoftonline.com/{TENANT_ID}"
    app = msal.ConfidentialClientApplication(
        CLIENT_ID, authority=authority, client_credential=CLIENT_SECRET
    )
    result = app.acquire_token_for_client(scopes=SCOPE)
    if "access_token" not in result:
        raise RuntimeError(f"Failed to acquire token: {result}")
    return result["access_token"]

if __name__ == "__main__":
    print(acquire_bearer_token())