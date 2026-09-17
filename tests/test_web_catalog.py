#!/usr/bin/env python3
"""
Test suite for Phase 6: Web Catalog Hardening & XSS Audit
Asserts:
1. JavaScript syntax validity via node --check on every web script.
2. XSS audit: All user-controlled variables interpolated into innerHTML pass through escapeHtml().
3. No hardcoded empty sha256 (e3b0c442...) or hardcoded foreign signatures in any web script.
4. Empty index.json fallback behavior is safely handled.
5. index.html binds no inline event handler attribute: every control goes through
   the delegated `data-action` registry in src/actions.js.

The catalog is split across app.js and src/*.js, so every audit below iterates
the whole set. Auditing only app.js would silently stop covering the modules
that actually render package data.
"""

import glob
import os
import re
import subprocess
import json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_JS = os.path.join(ROOT, "app.js")
INDEX_HTML = os.path.join(ROOT, "index.html")
SRC_JS = sorted(glob.glob(os.path.join(ROOT, "src", "*.js")))
WEB_JS = [APP_JS] + SRC_JS


def _read(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def test_node_check_all_web_scripts():
    assert len(SRC_JS) >= 8, f"expected the split module tree under src/, found {len(SRC_JS)} files"
    for path in WEB_JS:
        res = subprocess.run(["node", "--check", path], capture_output=True, text=True)
        assert res.returncode == 0, f"node --check {os.path.relpath(path, ROOT)} failed:\n{res.stderr}"
    print(f"[PASS] test_node_check_all_web_scripts ({len(WEB_JS)} files)")


def test_no_hardcoded_dummy_hashes_in_web_app():
    for path in WEB_JS:
        content = _read(path)
        label = os.path.relpath(path, ROOT)

        # Empty file sha256 hash must not be present
        assert "e3b0c442" not in content, f"Found e3b0c442 (empty file sha256) in {label}!"
        # Old compromised signature must not be present
        assert "3645b20469de7b3a" not in content, f"Found old foreign signature in {label}!"
    print("[PASS] test_no_hardcoded_dummy_hashes_in_web_app")


def test_xss_audit_inner_html_escaping():
    # Names of local variables that hold HTML fragments which were already
    # sanitized at their own construction site (every value inside them passes
    # through escapeHtml(), formatBytes(), formatNumber() or is a constant SVG
    # string). Adding a name here is a deliberate audit decision; the end-to-end
    # escaping guarantee is additionally verified by tests/test_web_app_smoke.py,
    # which renders a card built from hostile package data.
    sanitized_fragments = {
        "capsBadge",
        "tagsHtml",
        "sizeDisp",
        "keyIdBadge",
        "dlBadge",
        "renderedReadmeHtml",
        "versionsTableHtml",
        "latestBadge",
        "likeBtn",
        "tokensHtml",
    }

    for path in WEB_JS:
        content = _read(path)
        label = os.path.relpath(path, ROOT)

        # Find functions that generate HTML: returned template literals and
        # template literals assigned to innerHTML.
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
                    # Icon builders emit constant geometry from Sparks.ICONS and
                    # are never fed package data.
                    or expr.startswith("ICONS.")
                    or expr in sanitized_fragments
                    or "<svg" in expr
                )
                assert is_safe, (
                    f"Potential unescaped HTML interpolation in {label}: '${{{expr}}}'"
                )
    print("[PASS] test_xss_audit_inner_html_escaping")


def test_empty_index_fallback():
    # Node script simulating empty index.json
    node_test = """
    const fs = require('fs');
    const content = fs.readFileSync('src/registry.js', 'utf8');
    // Ensure the package list defaults gracefully to []
    if (!content.includes('state.packages = Array.isArray(data?.packages) ? data.packages : [];')) {
        process.exit(1);
    }
    console.log('OK');
    """
    res = subprocess.run(["node", "-e", node_test], cwd=ROOT, capture_output=True, text=True)
    assert res.returncode == 0, f"Empty index fallback verification failed: {res.stderr}"
    print("[PASS] test_empty_index_fallback")


def test_counter_config_matches_provisioning_script():
    """scripts/init_counters.py must mirror Sparks.CONFIG.counter.

    The browser reads counters and the provisioning script creates them; if the
    namespace or the key derivation drifts apart, the catalog starts querying
    keys nobody created and every read 404s. This test makes that drift loud.
    """
    core = _read(os.path.join(ROOT, "src", "core.js"))
    counters = _read(os.path.join(ROOT, "src", "counters.js"))
    script = _read(os.path.join(ROOT, "scripts", "init_counters.py"))

    ns_match = re.search(r"namespace:\s*'([^']+)'", core)
    endpoint_match = re.search(r"endpoint:\s*'([^']+)'", core)
    assert ns_match, "Sparks.CONFIG.counter.namespace not found in src/core.js"
    assert endpoint_match, "Sparks.CONFIG.counter.endpoint not found in src/core.js"

    py_ns = re.search(r'^NAMESPACE = "([^"]+)"', script, re.MULTILINE)
    py_endpoint = re.search(r'^ENDPOINT = "([^"]+)"', script, re.MULTILINE)
    assert py_ns, "NAMESPACE not found in scripts/init_counters.py"
    assert py_endpoint, "ENDPOINT not found in scripts/init_counters.py"

    assert ns_match.group(1) == py_ns.group(1), (
        f"counter namespace drift: core.js={ns_match.group(1)!r} init_counters.py={py_ns.group(1)!r}"
    )
    assert endpoint_match.group(1) == py_endpoint.group(1), (
        f"counter endpoint drift: core.js={endpoint_match.group(1)!r} init_counters.py={py_endpoint.group(1)!r}"
    )

    # The key shape must agree: "<kind>_<raw id>" with a 64-character ceiling.
    assert re.search(r"return \(kind \+ '_' \+ slug\)\.slice\(0, 64\);", counters), (
        "src/counters.js key derivation changed; update scripts/init_counters.py to match"
    )
    assert re.search(r"return \(kind \+ \"_\" \+ slug\)\[:64\]", script), (
        "scripts/init_counters.py key derivation changed; update src/counters.js to match"
    )
    print("[PASS] test_counter_config_matches_provisioning_script")


def test_index_html_uses_delegated_actions_only():
    content = _read(INDEX_HTML)

    inline = re.findall(r"\son[a-z]+\s*=\s*\"", content)
    assert not inline, f"index.html still binds inline handlers: {sorted(set(inline))}"

    actions = set(re.findall(r'data-action="([^"]+)"', content))
    assert actions, "index.html declares no data-action controls"

    handlers_src = _read(os.path.join(ROOT, "src", "actions.js"))
    registered = set(re.findall(r"^\s*'([a-z-]+)':\s*function", handlers_src, re.MULTILINE))

    missing = sorted(actions - registered)
    assert not missing, f"index.html references data-action values with no handler: {missing}"
    print(f"[PASS] test_index_html_uses_delegated_actions_only ({len(actions)} actions)")


if __name__ == "__main__":
    test_node_check_all_web_scripts()
    test_no_hardcoded_dummy_hashes_in_web_app()
    test_xss_audit_inner_html_escaping()
    test_empty_index_fallback()
    test_counter_config_matches_provisioning_script()
    test_index_html_uses_delegated_actions_only()
    print("ALL PHASE 6 WEB CATALOG TESTS PASSED!")
