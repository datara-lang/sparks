#!/usr/bin/env python3
"""
Provision the public community counters used by the web catalog.

The counter service (Abacus) answers HTTP 404 for a key nobody has incremented
yet. The catalog handles that correctly - it reads as a measured zero, not as a
missing value - but browsers log every 404 response as a console error, which
makes a healthy page look broken.

This script pre-creates the counters at 0 so reads always answer 200. Creating a
counter is unauthenticated; the service answers 409 for a key that already
exists, which this script treats as success. Nothing is incremented, so no
counter is inflated by running it.

Scope: it only touches counters whose key derives from a package listed in
index.json. It never reads or writes registry data.

The namespace and key derivation below MUST mirror `Sparks.CONFIG.counter` and
`counterKey()` in src/counters.js. tests/test_web_catalog.py asserts that they
agree, so drift is caught by the test suite rather than in production.

Usage:
    python scripts/init_counters.py [--root .] [--dry-run]
"""

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request

# --- mirror of src/core.js Sparks.CONFIG.counter -------------------------
ENDPOINT = "https://abacus.jasoncameron.dev"
NAMESPACE = "datara-sparks-catalog"
KINDS = ("dl", "like")
# -------------------------------------------------------------------------

SPARKS_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TIMEOUT_SECONDS = 15


def counter_key(kind, package_name):
    """Mirror of counterKey() in src/counters.js."""
    slug = re.sub(r"^sparks/", "", str(package_name or ""))
    slug = re.sub(r"[^A-Za-z0-9_.-]", "_", slug)
    if not slug:
        slug = "unknown"
    return (kind + "_" + slug)[:64]


def counter_url(action, key):
    return f"{ENDPOINT}/{action}/{NAMESPACE}/{key}"


def create_counter(key, dry_run=False):
    """Returns (state, detail) where state is 'created', 'exists' or 'error'."""
    url = counter_url("create", key) + "?initializer=0"
    if dry_run:
        return "planned", url

    request = urllib.request.Request(url, method="GET", headers={"User-Agent": "sparks-init-counters/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            body = response.read().decode("utf-8", "replace")
            return ("created" if response.status == 201 else "created"), body.strip()
    except urllib.error.HTTPError as err:
        if err.code == 409:
            return "exists", "already provisioned"
        detail = err.read().decode("utf-8", "replace").strip()
        return "error", f"HTTP {err.code}: {detail}"
    except Exception as err:  # noqa: BLE001 - surfaced verbatim to the operator
        return "error", str(err)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Provision Sparks community counters")
    parser.add_argument("--root", default=SPARKS_ROOT, help="registry root containing index.json")
    parser.add_argument("--dry-run", action="store_true", help="print the plan without calling the service")
    args = parser.parse_args(argv)

    index_path = os.path.join(args.root, "index.json")
    if not os.path.isfile(index_path):
        print(f"CRITICAL: {index_path} not found")
        return 2

    with open(index_path, "r", encoding="utf-8") as handle:
        index = json.load(handle)

    packages = index.get("packages") or []
    if not packages:
        print("index.json lists no packages; nothing to provision.")
        return 0

    print(f"Provisioning {len(packages) * len(KINDS)} counters in namespace '{NAMESPACE}'")
    if args.dry_run:
        print("(dry run: no requests will be sent)")

    created = existing = errors = 0

    for pkg in packages:
        name = pkg.get("name")
        for kind in KINDS:
            key = counter_key(kind, name)
            state, detail = create_counter(key, dry_run=args.dry_run)

            if state in ("created", "planned"):
                created += 1
                print(f"  [OK]   {NAMESPACE}/{key} ({name})")
            elif state == "exists":
                existing += 1
                print(f"  [SKIP] {NAMESPACE}/{key} ({name}) - {detail}")
            else:
                errors += 1
                print(f"  [FAIL] {NAMESPACE}/{key} ({name}) - {detail}")

    print()
    print(f"created={created} already-present={existing} errors={errors}")

    if errors:
        print("[FAIL] Some counters could not be provisioned.")
        return 1

    print("[SUCCESS] All community counters are provisioned.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
