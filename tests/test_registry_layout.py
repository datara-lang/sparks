#!/usr/bin/env python3
"""Registry storage-layout conformance tests for Sparks.

These tests answer one question: if the real `dpm`/`sparks` client resolved a
package the way `src/project/pm/registry.rs::fetch_and_install_sparks` does,
would it get a correct, verifiable artifact?

The client's actual resolution path (verified against the compiler source) is:

    no version pinned  -> GET {registry}/packages/{name}.json
    version pinned     -> GET {registry}/packages/{name}/{version}.json

It parses the result as `SparksPackageManifest` (schema/name/version/tarball_url/
sha256/public_key/signature/capabilities/...), resolves `tarball_url` against the
registry root, fetches the tarball and verifies SHA-256 + ed25519.

The client never reads `index.json` and never reads any version-list field, so
those are catalog-only concerns. This suite pins both facts down.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKAGES = ROOT / "packages"
TARBALLS = ROOT / "tarballs"
INDEX = ROOT / "index.json"
SCHEMA = ROOT / "schema.json"

sys.path.insert(0, str(ROOT / "scripts"))
from validate_registry import GRANDFATHERED_MISSING_SIDECAR  # noqa: E402

failures: list[str] = []
checks = 0


def check(condition: bool, message: str) -> None:
    global checks
    checks += 1
    if not condition:
        failures.append(message)


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def raw_id(name: str) -> str:
    return name[len("sparks/"):] if name.startswith("sparks/") else name


def main() -> int:
    index = load_json(INDEX)
    schema = load_json(SCHEMA)
    schema_props = set(schema.get("properties", {}).keys())
    entries = index.get("packages", [])
    check(isinstance(entries, list) and entries, "index.json must expose a non-empty packages list")

    index_names = set()
    for entry in entries:
        name = entry.get("name", "")
        pid = raw_id(name)
        index_names.add(pid)
        latest = entry.get("latest_version")

        # --- 1. Client path: packages/<name>.json ---------------------------
        root_manifest_path = PACKAGES / f"{pid}.json"
        check(root_manifest_path.is_file(), f"{pid}: root manifest packages/{pid}.json is missing")
        if not root_manifest_path.is_file():
            continue
        root = load_json(root_manifest_path)

        for key in ("schema", "name", "version", "description", "author", "license", "tarball_url", "sha256"):
            check(key in root, f"{pid}: root manifest lacks required key '{key}'")
        check(root.get("schema") == 1, f"{pid}: root manifest schema must be 1, got {root.get('schema')!r}")
        check(root.get("name") == name, f"{pid}: root manifest name {root.get('name')!r} != index {name!r}")
        check(root.get("version") == latest,
              f"{pid}: root manifest version {root.get('version')!r} != index latest_version {latest!r}")

        # --- 2. Client path: packages/<name>/<version>.json -----------------
        versions = entry.get("versions") or []
        check(bool(versions), f"{pid}: index exposes no version list")
        for version in versions:
            version_path = PACKAGES / pid / f"{version}.json"
            check(version_path.is_file(), f"{pid}: pinned-version manifest packages/{pid}/{version}.json is missing")
        if latest:
            latest_path = PACKAGES / pid / f"{latest}.json"
            check(latest_path.is_file(), f"{pid}: latest manifest packages/{pid}/{latest}.json is missing")
            if latest_path.is_file():
                exact = load_json(latest_path)
                # The two paths must describe the same artifact. Byte-equality is the
                # strict form; we assert semantic equality on every client-relevant field
                # and separately report cosmetic drift.
                for key in ("schema", "name", "version", "tarball_url", "sha256", "public_key", "signature"):
                    check(root.get(key) == exact.get(key),
                          f"{pid}: root snapshot and exact-release manifest disagree on '{key}'")
                only_root = set(root) - set(exact)
                only_exact = set(exact) - set(root)
                for key in sorted(only_root):
                    print(f"[note] {pid}: '{key}' in root snapshot but not in packages/{pid}/{latest}.json")
                for key in sorted(only_exact):
                    print(f"[note] {pid}: '{key}' in packages/{pid}/{latest}.json but not in root snapshot")

        # --- 2b. index.json is what the catalog renders; it must not lie ------
        for field in ("sha256", "size_bytes", "capabilities", "description",
                      "license", "author", "public_key", "signature", "tarball_url"):
            if field in entry:
                check(entry.get(field) == root.get(field),
                      f"{pid}: index.json '{field}' disagrees with the root manifest")

        # --- 3. The real invariant: sha256 == tarball digest -----------------
        sha = str(root.get("sha256", "")).strip()
        clean = sha[len("sha256:"):] if sha.startswith("sha256:") else sha
        check(len(clean) == 64 and all(c in "0123456789abcdef" for c in clean),
              f"{pid}: sha256 is not 64 lowercase hex chars: {sha!r}")

        tarball_url = str(root.get("tarball_url", ""))
        check(bool(tarball_url), f"{pid}: tarball_url is empty")
        rel = tarball_url
        for prefix in ("https://datara-lang.github.io/sparks/", "http://localhost:8080/"):
            if rel.startswith(prefix):
                rel = rel[len(prefix):]
        rel = rel.lstrip("/")
        tarball_path = ROOT / rel
        check(tarball_path.is_file(), f"{pid}: tarball_url {tarball_url!r} does not resolve to a file ({rel})")
        if tarball_path.is_file():
            actual = sha256_of(tarball_path)
            check(actual == clean,
                  f"{pid}: sha256 mismatch — manifest {clean}, tarball {actual}")
            check(tarball_path.stat().st_size > 0, f"{pid}: tarball is empty")

            # --- 4. Archive must be a readable POSIX ustar with a sidecar -----
            try:
                with tarfile.open(tarball_path, "r:") as archive:
                    members = archive.getnames()
                check(bool(members), f"{pid}: tarball contains no members")
                has_sidecar = any(m.endswith("capabilities.json") for m in members)
                if not has_sidecar:
                    # A missing sidecar makes the client's E-SPARKS-002 capability
                    # cross-check unreachable. Already-published versions are immutable
                    # (POLICY.md section 2), so a known set is grandfathered.
                    ident = (f"sparks/{pid}", str(root.get("version")))
                    if ident in GRANDFATHERED_MISSING_SIDECAR:
                        print(f"[note] {pid} {ident[1]}: no capabilities.json sidecar "
                              f"(grandfathered immutable release; remedy is a new version)")
                    else:
                        check(False, f"{pid}: tarball has no capabilities.json sidecar")
                else:
                    check(True, f"{pid}: tarball carries a capabilities.json sidecar")
            except tarfile.TarError as exc:
                check(False, f"{pid}: tarball is not a readable tar archive: {exc}")

        # --- 5. Signature shape ---------------------------------------------
        pk = root.get("public_key")
        sig = root.get("signature")
        if pk is not None:
            check(isinstance(pk, str) and len(pk) == 64 and all(c in "0123456789abcdef" for c in pk),
                  f"{pid}: public_key must be 32-byte lowercase hex")
        if sig is not None:
            check(isinstance(sig, str) and len(sig) == 128 and all(c in "0123456789abcdef" for c in sig),
                  f"{pid}: signature must be 64-byte lowercase hex")
        check(pk is not None and sig is not None,
              f"{pid}: manifest is unsigned (public_key/signature missing) — client skips verification")

    # --- 6. No orphan artifacts ---------------------------------------------
    for manifest in PACKAGES.glob("*.json"):
        check(manifest.stem in index_names,
              f"orphan: packages/{manifest.name} is not listed in index.json")
    for tarball in TARBALLS.glob("*.tar"):
        check(tarball.stat().st_size > 0, f"orphan: tarballs/{tarball.name} is empty")

    # --- 7. Catalog-only field naming ---------------------------------------
    # Canonical field name is `versions` across schema.json, index.json and manifests.
    schema_has_versions = "versions" in schema_props
    check(schema_has_versions, "schema.json must document `versions`")
    schema_has_all = "all_versions" in schema_props
    check(not schema_has_all, "schema.json must not document deprecated `all_versions`")

    print(f"\n{checks} checks, {len(failures)} failure(s)")
    for failure in failures:
        print(f"  FAIL  {failure}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
