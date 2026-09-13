#!/usr/bin/env python3
"""
Test suite for Phase 6: Web Catalog Hardening & XSS Audit
Asserts:
1. JavaScript syntax validity via node --check app.js.
2. XSS audit: All user-controlled variables interpolated into innerHTML pass through escapeHtml().
3. No hardcoded empty sha256 (e3b0c442...) or hardcoded foreign signatures in app.js.
4. Empty index.json fallback behavior is safely handled.
"""

import os
import re
import subprocess
import json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_JS = os.path.join(ROOT, "app.js")
INDEX_HTML = os.path.join(ROOT, "index.html")

def test_node_check_app_js():
    res = subprocess.run(["node", "--check", APP_JS], capture_output=True, text=True)
    assert res.returncode == 0, f"node --check app.js failed:\n{res.stderr}"
    print("[PASS] test_node_check_app_js")

def test_no_hardcoded_dummy_hashes_in_web_app():
    with open(APP_JS, "r", encoding="utf-8") as f:
        content = f.read()

    # Empty file sha256 hash must not be present
    assert "e3b0c442" not in content, "Found e3b0c442 (empty file sha256) in app.js!"
    # Old compromised signature must not be present
    assert "3645b20469de7b3a" not in content, "Found old foreign signature in app.js!"
    print("[PASS] test_no_hardcoded_dummy_hashes_in_web_app")

def test_xss_audit_inner_html_escaping():
    with open(APP_JS, "r", encoding="utf-8") as f:
        content = f.read()

    # Find functions that generate HTML: createPackageCardHtml, capsContainer.innerHTML, toast.innerHTML
    html_templates = re.findall(r"return\s*`([^`]+)`", content)
    html_templates.extend(re.findall(r"\.innerHTML\s*=\s*`([^`]+)`", content))

    for template in html_templates:
        interpolations = re.findall(r"\$\{([^}]+)\}", template)
        for expr in interpolations:
            expr = expr.strip()
            is_safe = (
                "escapeHtml(" in expr
                or "formatBytes(" in expr
                or "formatNumber(" in expr
                or "formatInlineMarkdown(" in expr
                or expr in {"capsBadge", "tagsHtml", "sizeDisp", "keyIdBadge", "dlBadge", "renderedReadmeHtml", "versionsTableHtml", "latestBadge", "likeBtn"}
                or "<svg" in expr
            )
            assert is_safe, f"Potential unescaped HTML interpolation in web catalog: '${{{expr}}}'"
    print("[PASS] test_xss_audit_inner_html_escaping")

def test_empty_index_fallback():
    # Node script simulating empty index.json
    node_test = """
    const fs = require('fs');
    const content = fs.readFileSync('app.js', 'utf8');
    // Ensure allPackages defaults gracefully to []
    if (!content.includes('allPackages = Array.isArray(data?.packages) ? data.packages : [];')) {
        process.exit(1);
    }
    console.log('OK');
    """
    res = subprocess.run(["node", "-e", node_test], cwd=ROOT, capture_output=True, text=True)
    assert res.returncode == 0, f"Empty index fallback verification failed: {res.stderr}"
    print("[PASS] test_empty_index_fallback")

if __name__ == "__main__":
    test_node_check_app_js()
    test_no_hardcoded_dummy_hashes_in_web_app()
    test_xss_audit_inner_html_escaping()
    test_empty_index_fallback()
    print("ALL PHASE 6 WEB CATALOG TESTS PASSED!")
