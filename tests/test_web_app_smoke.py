#!/usr/bin/env python3
"""
Phase 9: Web Catalog Behaviour Tests

Runs tests/web_dom_harness.js, a dependency-free Node harness that loads the
real index.html markup and the real app.js into a minimal DOM and asserts:

1.  No emoji glyphs in app.js / index.html / styles.css, and none in the HTML
    produced at runtime - every icon is inline SVG.
2.  No dynamic value is interpolated into an inline event attribute.
3.  Package data is HTML-escaped, including hostile package names.
4.  The favourites flow updates the card, the filter chip, the hero metric and
    the favourites-only view, and renders a dedicated empty state.
5.  The manifest generator writes into the element index.html declares, and
    copyManifestJson() (the name bound in index.html) exists.
6.  Per-version rows display real digests and sizes read from
    packages/<name>/<version>.json, never invented placeholders.
7.  The Markdown renderer groups lists, renders safe links, and refuses
    javascript: targets.
"""

import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HARNESS = os.path.join(ROOT, "tests", "web_dom_harness.js")


def _node_binary():
    """Prefer the managed Node runtime, fall back to PATH."""
    managed = os.path.join(
        os.path.expanduser("~"),
        ".workbuddy-ai",
        "binaries",
        "node",
        "versions",
    )
    if os.path.isdir(managed):
        for version in sorted(os.listdir(managed), reverse=True):
            candidate = os.path.join(managed, version, "node.exe")
            if os.path.isfile(candidate):
                return candidate
            candidate = os.path.join(managed, version, "bin", "node")
            if os.path.isfile(candidate):
                return candidate
    return shutil.which("node") or "node"


def test_web_dom_behaviour():
    node = _node_binary()
    res = subprocess.run(
        [node, HARNESS],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    sys.stdout.write(res.stdout)
    if res.stderr:
        sys.stderr.write(res.stderr)
    assert res.returncode == 0, "web_dom_harness.js reported failing assertions"
    assert "WEB DOM SMOKE TEST PASSED" in res.stdout, "harness did not reach the success banner"
    print("[PASS] test_web_dom_behaviour")


if __name__ == "__main__":
    test_web_dom_behaviour()
    print("ALL PHASE 9 WEB BEHAVIOUR TESTS PASSED!")
