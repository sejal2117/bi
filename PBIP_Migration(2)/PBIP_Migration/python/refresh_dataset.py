import argparse
import os
from auth import acquire_bearer_token
from pbipy import PowerBI  # [5](https://community.fabric.microsoft.com/t5/Desktop/Composite-model-relationships-shared-dimension-tables/td-p/2022952)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset-id", required=True)
    ap.add_argument("--workspace-id", default=os.getenv("PBI_WORKSPACE_ID"))
    args = ap.parse_args()

    token = acquire_bearer_token()
    pbi = PowerBI(token)
    if args.workspace_id:
        resp = pbi.post(f"groups/{args.workspace_id}/datasets/{args.dataset_id}/refreshes", json={})
    else:
        resp = pbi.post(f"datasets/{args.dataset_id}/refreshes", json={})
    print("Refresh triggered:", resp)

if __name__ == "__main__":
    main()