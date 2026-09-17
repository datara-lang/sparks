#!/usr/bin/env python3
"""
Legacy entry point: registry integrity check.

This script used to contain its own, weaker copy of the registry checks. It
verified SHA-256 digests and capability sidecars but skipped ed25519 signatures,
JSON-Schema compliance, SemVer monotonicity, archive path-traversal safety,
non-latest release manifests and index-to-package consistency. A green run here
did NOT mean the registry was valid, which made it a false-confidence hazard.

It now delegates to the single canonical validator, scripts/validate_registry.py,
which enforces all seven invariants and is the same script CI runs.

    python verify_registry.py            # validate the whole registry
    python verify_registry.py --help     # canonical validator options

The `run_checks()` function is preserved for callers that imported it: it
returns a list of error strings (empty when the registry is valid).
"""

import os
import subprocess
import sys

SPARKS_ROOT = os.path.dirname(os.path.abspath(__file__))
CANONICAL_VALIDATOR = os.path.join(SPARKS_ROOT, "scripts", "validate_registry.py")

DEPRECATION_NOTICE = (
    "NOTE: verify_registry.py is a compatibility shim. The authoritative check is\n"
    "      scripts/validate_registry.py (also run by .github/workflows/validate.yml).\n"
)


def run_checks():
    """Run the canonical validator and return a list of error strings."""
    if not os.path.exists(CANONICAL_VALIDATOR):
        return [f"Canonical validator not found at {CANONICAL_VALIDATOR}"]

    result = subprocess.run(
        [sys.executable, CANONICAL_VALIDATOR],
        cwd=SPARKS_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )

    sys.stdout.write(result.stdout)
    if result.stderr:
        sys.stderr.write(result.stderr)

    if result.returncode == 0:
        return []

    errors = [
        line.strip().lstrip("*").strip()
        for line in result.stdout.splitlines()
        if line.strip().startswith("*")
    ]
    return errors or [f"canonical validation failed (exit code {result.returncode})"]


def main():
    print("=== Sparks Registry Integrity Check ===")
    print(DEPRECATION_NOTICE)
    errors = run_checks()

    if errors:
        print("\nERRORS ENCOUNTERED:")
        for err in errors:
            print(" -", err)
        sys.exit(1)

    print("\nALL SPARKS PACKAGES AND MANIFESTS VERIFIED 100% CLEAN!")
    sys.exit(0)


if __name__ == "__main__":
    main()
