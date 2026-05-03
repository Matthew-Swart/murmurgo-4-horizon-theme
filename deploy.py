#!/usr/bin/env python3
"""
Deploy complete Horizon + M5 theme to murmurgo-4 live theme via REST Admin API.
"""
import os, sys, time, requests, json

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


def get_asset(theme_id, key):
    r = requests.get(
        f"{BASE_URL}/themes/{theme_id}/assets.json",
        headers=HEADERS,
        params={"asset[key]": key},
    )
    if r.status_code == 200:
        return r.json().get("asset", {})
    return None


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
    files = []
    for root, _dirs, filenames in os.walk(LOCAL_DIR):
        for fname in filenames:
            if fname.startswith(".") or fname.endswith(".py") or fname == "deploy.py":
                continue
            path = os.path.join(root, fname)
            rel = os.path.relpath(path, LOCAL_DIR)
            if rel.startswith(".git") or rel.startswith("."):
                continue
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
            files.append((rel, content))

    print(f"\nFound {len(files)} files to deploy.")
    print(f"Uploading to theme {theme_id}...")

    ok = 0
    fail = 0
    for key, content in files:
        if put_asset(theme_id, key, content):
            ok += 1
        else:
            fail += 1
        time.sleep(0.12)

    print(f"\nDone: {ok} OK, {fail} failed")
    if fail > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
