"""
run_clean.py
- Runs json-clean from pbip-tools across PBIP repo for human-readable JSON
- pbip-tools provides json-clean/json-smudge CLIs for PBIP files. [2](https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-overview)
"""

import argparse
import os
import subprocess
import sys

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pbip", required=True)
    args = ap.parse_args()

    repo = os.path.abspath(args.pbip)
    if not os.path.isdir(repo):
        print("Not a directory:", repo)
        sys.exit(1)

    # Clean all JSON files (non-destructive for our purposes)
    cmd = f'json-clean "{repo}/**/*.json"'
    print("Running:", cmd)
    subprocess.run(cmd, shell=True, check=False)

if __name__ == "__main__":
    main()