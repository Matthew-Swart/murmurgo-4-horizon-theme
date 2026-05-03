#!/usr/bin/env python3
"""
Deploy ONLY the new M5 files to murmurgo-4 Horizon live theme.
Skips binary assets — only uploads text files (templates, sections, snippets, layout).
"""
import os, sys, time, requests

SHOP = os.environ.get("SHOPIFY_SHOP", "murmurgo-4.myshopify.com")
TOKEN = os.environ.get("SHOPIFY_ACCESS_TOKEN", "")
API_VERSION = "2026-04"
BASE_URL = f"https://{SHOP}/admin/api/{API_VERSION}"

if not TOKEN:
    print("Error: SHOPIFY_ACCESS_TOKEN not set")
    sys.exit(1)

HEADERS = {
    "X-Shopify-Access-Token": TOKEN,
    "Content-Type": "application/json",
}

LOCAL_DIR = os.path.dirname(os.path.abspath(__file__))


def find_main_theme():
    r = requests.get(f"{BASE_URL}/themes.json", headers=HEADERS)
    r.raise_for_status()
    themes = r.json().get("themes", [])
    live = next((t for t in themes if t.get("role") == "main"), None)
    if not live:
        print("No live theme found")
        sys.exit(1)
    print(f"Live theme: '{live['name']}' (id={live['id']})")
    return live["id"]


def put_asset(theme_id, key, content):
    payload = {"asset": {"key": key, "value": content}}
    r = requests.put(
        f"{BASE_URL}/themes/{theme_id}/assets.json",
        headers=HEADERS,
        json=payload,
    )
    if r.status_code not in (200, 201):
        print(f"  FAILED {key}: {r.status_code} {r.text[:200]}")
        return False
    print(f"  OK {key}")
    return True


def main():
    theme_id = find_main_theme()

    # Only deploy new/modified files
    targets = []
    
    # New templates
    for f in os.listdir(os.path.join(LOCAL_DIR, "templates")):
        if f.startswith("page.place-") and f.endswith(".json"):
            targets.append(f"templates/{f}")
    
    # New sections
    for f in os.listdir(os.path.join(LOCAL_DIR, "sections")):
        if f.startswith("place-") or f.startswith("polygon-") or f.startswith("contained-") or f.startswith("claim-") or f.startswith("panorama-"):
            targets.append(f"sections/{f}")
    
    # New snippets
    for f in os.listdir(os.path.join(LOCAL_DIR, "snippets")):
        if f.startswith("murmurgo-"):
            targets.append(f"snippets/{f}")
    
    # Patched layout
    targets.append("layout/theme.liquid")

    print(f"\nDeploying {len(targets)} files...")
    ok = 0
    fail = 0
    for rel in targets:
        path = os.path.join(LOCAL_DIR, rel)
        if not os.path.exists(path):
            print(f"  SKIP (missing) {rel}")
            continue
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        if put_asset(theme_id, rel, content):
            ok += 1
        else:
            fail += 1
        time.sleep(0.12)

    print(f"\nDone: {ok} OK, {fail} failed")
    if fail > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
