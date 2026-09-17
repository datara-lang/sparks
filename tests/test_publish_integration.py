#!/usr/bin/env python3
"""
Integration test: spark_publish.py -> validate_registry.py -> dpm add.
Tests the full author workflow end-to-end without mutating the live registry.
"""
import os
import sys
import json
import shutil
import tempfile
import subprocess
import http.server
import threading
import time

SPARKS_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DPM_PATH = r"D:\DATARA\datara + forgen\target\debug\dpm.exe"
PYTHON = sys.executable


class RegistryHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass  # quiet test output


def start_server(directory, port):
    def factory(*args, **kwargs):
        return RegistryHandler(*args, directory=directory, **kwargs)

    server = http.server.HTTPServer(("127.0.0.1", port), factory)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server


def main():
    checks = 0
    failures = 0

    def check(name, condition, detail=""):
        nonlocal checks, failures
        checks += 1
        if condition:
            print(f"[PASS] {name}")
        else:
            failures += 1
            print(f"[FAIL] {name}" + (f" -> {detail}" if detail else ""))

    tmpdir = tempfile.mkdtemp(prefix="sparks_integ_")
    try:
        # 1. Package source
        pkg_src = os.path.join(tmpdir, "pkg_src")
        os.makedirs(pkg_src)
        with open(os.path.join(pkg_src, "lib.dtr"), "w", encoding="utf-8") as f:
            f.write("// integration test package\nstruct MathUtil { factor: Int }\n")
        with open(os.path.join(pkg_src, "capabilities.json"), "w", encoding="utf-8") as f:
            json.dump({"capabilities": []}, f, indent=2)
        with open(os.path.join(pkg_src, "README.md"), "w", encoding="utf-8") as f:
            f.write("# test_integ_pkg\n\nIntegration test package for Sparks registry.")

        # 2. Temp registry destination
        reg_dir = os.path.join(tmpdir, "registry")
        os.makedirs(reg_dir)
        shutil.copy(os.path.join(SPARKS_ROOT, "schema.json"), os.path.join(reg_dir, "schema.json"))

        index_init = {
            "schema": 1,
            "url": "http://127.0.0.1:19876",
            "total_packages": 0,
            "packages": [],
            "key_rotation": [
                {
                    "key_id": "datara-core-2026-v2",
                    "public_key": "1e5b98204a627f872e09e8fb32e511abdc714b0f1b720d809b5e43e1ea97925d",
                    "status": "active",
                    "activated_at": "2026-09-12T00:00:00Z",
                    "comment": "Integration test key"
                }
            ]
        }
        with open(os.path.join(reg_dir, "index.json"), "w", encoding="utf-8") as f:
            json.dump(index_init, f, indent=2)

        # 3. Import and call publish_package directly with registry_root=reg_dir
        sys.path.insert(0, os.path.join(SPARKS_ROOT, "scripts"))
        from spark_publish import publish_package

        test_seed = "36418cf514338bccbefbf29c9869c83f0bb83b5e3738b9fb24e7f05b57027606"
        manifest, tar_bytes = publish_package(
            pkg_dir=pkg_src,
            name="sparks/test_integ_pkg",
            version="1.0.0",
            description="Integration test package",
            author="Test Runner <test@datara.dev>",
            license_id="MIT",
            key_id="datara-core-2026-v2",
            seed_hex=test_seed,
            registry_root=reg_dir
        )

        check("manifest generated with versions field", "versions" in manifest)
        check("tarball generated", len(tar_bytes) > 0)
        check("tarball written to disk", os.path.exists(os.path.join(reg_dir, "tarballs", "test_integ_pkg-1.0.0.tar")))
        check("manifest written to disk", os.path.exists(os.path.join(reg_dir, "packages", "test_integ_pkg", "1.0.0.json")))
        check("root snapshot written to disk", os.path.exists(os.path.join(reg_dir, "packages", "test_integ_pkg.json")))

        # 4. Validate the temp registry via validate_registry.py
        r = subprocess.run(
            [PYTHON, os.path.join(SPARKS_ROOT, "scripts", "validate_registry.py"), "--root", reg_dir],
            capture_output=True, text=True
        )
        check("validate_registry passes for published temp registry", r.returncode == 0, r.stderr + r.stdout)

        # 5. Test client installation via dpm if dpm binary exists
        if os.path.exists(DPM_PATH):
            port = 19876
            server = start_server(reg_dir, port)
            time.sleep(0.3)
            try:
                consumer_dir = os.path.join(tmpdir, "consumer")
                os.makedirs(consumer_dir)
                with open(os.path.join(consumer_dir, "datara.toml"), "w", encoding="utf-8") as f:
                    f.write('[project]\nname = "test_consumer"\nversion = "0.1.0"\n\n[dependencies]\n')

                env = os.environ.copy()
                env["DATARA_SPARKS_REGISTRY"] = f"http://127.0.0.1:{port}"

                res = subprocess.run(
                    [DPM_PATH, "add", "sparks/test_integ_pkg"],
                    cwd=consumer_dir,
                    env=env,
                    capture_output=True,
                    text=True,
                    timeout=30
                )
                check("dpm add sparks/test_integ_pkg succeeds", res.returncode == 0, res.stderr + res.stdout)

                installed_dtr = os.path.join(consumer_dir, "packages", "sparks", "test_integ_pkg", "lib.dtr")
                check("installed package contains lib.dtr", os.path.exists(installed_dtr))
            finally:
                server.shutdown()
        else:
            print(f"[SKIP] dpm.exe not found at {DPM_PATH}")

    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    print("---------------------------------")
    print(f"{checks - failures}/{checks} assertions passed")
    if failures > 0:
        print(f"INTEGRATION TEST FAILED ({failures} failures)")
        sys.exit(1)
    print("ALL PUBLISH INTEGRATION TESTS PASSED!")


if __name__ == "__main__":
    main()
