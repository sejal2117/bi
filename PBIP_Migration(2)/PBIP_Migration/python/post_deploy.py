"""
post_deploy.py
- Demonstrates post-deploy operations using pbipy:
  * Refresh a dataset
  * (Optionally) update parameters in a dataset
- For imports/publish, you can also use pbipy's Imports/Reports/Datasets APIs.
  pbipy supports operations for Apps, Dataflows, Datasets, Gateways, Imports, Reports, and Workspaces. [5](https://community.fabric.microsoft.com/t5/Desktop/Composite-model-relationships-shared-dimension-tables/td-p/2022952)

NOTE: This sample focuses on refresh (safe for local test). For imports,
you can extend this script to call pbipy's Imports endpoints.
"""

import argparse
import os
from auth import acquire_bearer_token
from pbipy import PowerBI  # pbipy client  [5](https://community.fabric.microsoft.com/t5/Desktop/Composite-model-relationships-shared-dimension-tables/td-p/2022952)

def refresh_dataset(pbi: PowerBI, dataset_id: str, group: str | None):
    if group:
        resp = pbi.post(f"groups/{group}/datasets/{dataset_id}/refreshes", json={})
    else:
        resp = pbi.post(f"datasets/{dataset_id}/refreshes", json={})
    return resp

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workspace-id", default=os.getenv("PBI_WORKSPACE_ID"))
    ap.add_argument("--dataset-id")
    ap.add_argument("--artifact", help="Path to compiled artifact (PBIT/PBIX)", default="")
    ap.add_argument("--format", choices=["PBIT", "PBIX"], default="PBIT")
    ap.add_argument("--refresh-after", choices=["true","false"], default="true")
    args = ap.parse_args()

    token = acquire_bearer_token()
    pbi = PowerBI(token)  # create client  [5](https://community.fabric.microsoft.com/t5/Desktop/Composite-model-relationships-shared-dimension-tables/td-p/2022952)

    # For local test, we just refresh an existing dataset
    if args.dataset_id:
        print(f"Triggering refresh for dataset {args.dataset_id} in workspace {args.workspace_id or '(My workspace)'}")
        resp = refresh_dataset(pbi, args.dataset_id, args.workspace_id)
        print("Refresh API response:", resp)

    print("Post-deploy steps completed (local demo). For imports, extend this script to call pbipy Imports APIs.")
    print("pbipy covers Datasets/Reports/Imports/Workspaces etc.")  # [5](https://community.fabric.microsoft.com/t5/Desktop/Composite-model-relationships-shared-dimension-tables/td-p/2022952)

if __name__ == "__main__":
    main()