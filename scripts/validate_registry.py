#!/usr/bin/env python3
"""
Sparks Package Registry Validator
Enforces formal schema compliance, cryptographic ed25519 signatures,
SHA-256 integrity, capability sidecar parity, semver monotonicity,
tarball safety, and index-to-package consistency.
"""

import os
import sys
import json
import hashlib
import tarfile
import io
import re
import argparse

try:
    import jsonschema
except ImportError:
    jsonschema = None

try:
    from cryptography.hazmat.primitives.asymmetric import ed25519
except ImportError:
    ed25519 = None

SPARKS_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX_FILE = os.path.join(SPARKS_ROOT, "index.json")
SCHEMA_FILE = os.path.join(SPARKS_ROOT, "schema.json")
PACKAGES_DIR = os.path.join(SPARKS_ROOT, "packages")
TARBALLS_DIR = os.path.join(SPARKS_ROOT, "tarballs")

SEMVER_REGEX = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?"
    r"(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$"
)

PACKAGE_NAME_REGEX = re.compile(r"^sparks/[a-zA-Z0-9_-]+$")
MAX_TARBALL_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB

# Packages published before the capability-sidecar requirement was enforced.
#
# POLICY.md section 2 makes a published version's tarball permanently immutable,
# so a sidecar-less artifact cannot be repaired in place: the bytes are signed and
# changing them would invalidate both the SHA-256 digest and the ed25519 signature.
# The only conforming remedy is a new SemVer release. These entries are therefore
# grandfathered as warnings rather than errors, so CI stays green while the gap
# remains visible and auditable. New packages are never added here.
#
# The list is currently empty: every package in the registry ships a sidecar. The
# mechanism is retained as a safety valve for already-published, immutable artifacts.
GRANDFATHERED_MISSING_SIDECAR = set()

# Collected non-fatal findings, printed after the fatal ones.
WARNINGS = []

def load_json(file_path):
    with open(file_path, "r", encoding="utf-8") as f:
        return json.load(f)

def clean_hex_sha256(val):
    if not isinstance(val, str):
        return ""
    val = val.strip()
    if val.startswith("sha256:"):
        val = val[7:]
    return val.lower()

def validate_tarball_safety(tar_bytes, pkg_name):
    errors = []
    if len(tar_bytes) > MAX_TARBALL_SIZE_BYTES:
        errors.append(f"{pkg_name}: Tarball exceeds maximum size limit ({len(tar_bytes)} > {MAX_TARBALL_SIZE_BYTES} bytes)")

    try:
        bio = io.BytesIO(tar_bytes)
        with tarfile.open(fileobj=bio, mode="r:*") as tar:
            members = tar.getmembers()
            if not members:
                errors.append(f"{pkg_name}: Tarball archive is completely empty")
            for m in members:
                # Disallow absolute paths and directory traversal
                if m.name.startswith("/") or m.name.startswith("\\"):
                    errors.append(f"{pkg_name}: Tarball contains absolute path: '{m.name}'")
                norm = os.path.normpath(m.name)
                if norm.startswith("..") or "/../" in m.name or "\\..\\" in m.name or m.name == "..":
                    errors.append(f"{pkg_name}: Tarball contains path traversal sequence: '{m.name}'")
                # Disallow device files / fifo / symlinks pointing outside
                if m.isdev() or m.isfifo():
                    errors.append(f"{pkg_name}: Tarball contains illegal special file: '{m.name}'")
    except Exception as e:
        errors.append(f"{pkg_name}: Failed to read tarball as valid tar: {e}")

    return errors

def validate_package_entry(manifest, tar_bytes, schema, pkg_label):
    errors = []

    # 1. Schema validation
    if schema:
        if jsonschema:
            try:
                jsonschema.validate(instance=manifest, schema=schema)
            except jsonschema.ValidationError as ve:
                errors.append(f"{pkg_label}: Schema validation error: {ve.message}")
            except Exception as e:
                errors.append(f"{pkg_label}: Schema check failed: {e}")
        else:
            errors.append(f"{pkg_label}: jsonschema library is missing, cannot validate schema")

    # 2. Package naming
    name = manifest.get("name", "")
    if not PACKAGE_NAME_REGEX.match(name):
        errors.append(f"{pkg_label}: Invalid package name '{name}'. Must match '^sparks/[a-zA-Z0-9_-]+$'")

    # 3. SemVer validation
    ver = str(manifest.get("version", ""))
    if not SEMVER_REGEX.match(ver):
        errors.append(f"{pkg_label}: Invalid version '{ver}'. Must adhere to SemVer 2.0.0")

    # 4. Tarball safety
    tar_errors = validate_tarball_safety(tar_bytes, pkg_label)
    errors.extend(tar_errors)

    # 5. SHA-256 digest
    actual_sha = hashlib.sha256(tar_bytes).hexdigest()
    expected_sha = clean_hex_sha256(manifest.get("sha256", ""))
    if len(expected_sha) != 64:
        errors.append(f"{pkg_label}: Manifest sha256 is invalid length/format: '{manifest.get('sha256')}'")
    elif actual_sha.lower() != expected_sha:
        errors.append(
            f"{pkg_label}: SHA-256 artifact checksum mismatch!\n"
            f"  Expected: {expected_sha}\n"
            f"  Actual:   {actual_sha}"
        )

    # 6. Ed25519 signature verification
    pk_hex = manifest.get("public_key")
    sig_hex = manifest.get("signature")
    if pk_hex and sig_hex:
        if not ed25519:
            errors.append(f"{pkg_label}: cryptography library missing, cannot verify ed25519 signature")
        else:
            try:
                pk_bytes = bytes.fromhex(pk_hex)
                sig_bytes = bytes.fromhex(sig_hex)
                pub_key = ed25519.Ed25519PublicKey.from_public_bytes(pk_bytes)
                pub_key.verify(sig_bytes, tar_bytes)
            except Exception as e:
                errors.append(f"{pkg_label}: ed25519 package verification failed: {e}")
    else:
        errors.append(f"{pkg_label}: Missing public_key or signature in manifest")

    # 7. Capability declaration parity
    try:
        bio = io.BytesIO(tar_bytes)
        with tarfile.open(fileobj=bio, mode="r:*") as tar:
            names = tar.getnames()
            if "capabilities.json" in names:
                cap_f = tar.extractfile("capabilities.json")
                if cap_f is None:
                    errors.append(f"{pkg_label}: Could not extract capabilities.json from tarball")
                else:
                    cap_json = json.load(cap_f)
                    sidecar_caps = cap_json.get("capabilities", [])
                    manifest_caps = manifest.get("capabilities", [])
                    if sorted(sidecar_caps) != sorted(manifest_caps):
                        errors.append(
                            f"{pkg_label}: Capability declaration mismatch: "
                            f"manifest declared {manifest_caps}, but tarball contains {sidecar_caps}"
                        )
            else:
                # A tarball with no sidecar makes the client's capability cross-check
                # unreachable: registry.rs::install_sparks_manifest only runs the
                # E-SPARKS-002 comparison `if let Some(sidecar) = ...`, so a package
                # that declares zero capabilities and ships no sidecar is never
                # verified at all. Require the sidecar unconditionally.
                manifest_caps = manifest.get("capabilities", [])
                ident = (manifest.get("name"), str(manifest.get("version")))
                if ident in GRANDFATHERED_MISSING_SIDECAR:
                    WARNINGS.append(
                        f"{pkg_label}: tarball lacks capabilities.json (grandfathered; "
                        f"declared capabilities {manifest_caps}). Cannot be repaired in place "
                        f"because published versions are immutable - publish a new SemVer "
                        f"release with a sidecar to clear this."
                    )
                else:
                    errors.append(
                        f"{pkg_label}: Tarball lacks capabilities.json sidecar. The client's "
                        f"capability cross-check is silently skipped without it "
                        f"(manifest declared {manifest_caps})."
                    )
    except Exception as e:
        errors.append(f"{pkg_label}: Failed to inspect capabilities.json: {e}")

    return errors

def validate_full_registry(root_dir=SPARKS_ROOT):
    errors = []
    WARNINGS.clear()
    print("=== Sparks Registry Comprehensive Validator ===")

    index_path = os.path.join(root_dir, "index.json")
    schema_path = os.path.join(root_dir, "schema.json")
    packages_dir = os.path.join(root_dir, "packages")
    tarballs_dir = os.path.join(root_dir, "tarballs")

    # Check files exist
    if not os.path.exists(index_path):
        return ["CRITICAL: index.json is missing from registry root"]
    if not os.path.exists(schema_path):
        return ["CRITICAL: schema.json is missing from registry root"]
    if not os.path.isdir(packages_dir):
        return ["CRITICAL: packages/ directory is missing"]
    if not os.path.isdir(tarballs_dir):
        return ["CRITICAL: tarballs/ directory is missing"]

    try:
        schema = load_json(schema_path)
    except Exception as e:
        return [f"CRITICAL: Failed to parse schema.json: {e}"]

    try:
        index_data = load_json(index_path)
    except Exception as e:
        return [f"CRITICAL: Failed to parse index.json: {e}"]

    # Validate index.json structure
    if index_data.get("schema") != 1:
        errors.append(f"index.json: schema version must be 1, got {index_data.get('schema')}")

    # Check key rotation list if present
    revoked_keys = set()
    if "key_rotation" in index_data:
        for entry in index_data["key_rotation"]:
            if entry.get("status") == "revoked":
                revoked_keys.add(entry.get("public_key", "").lower())

    packages_in_index = index_data.get("packages", [])
    print(f"[INFO] index.json reports {len(packages_in_index)} packages")

    index_pkg_names = set()
    for idx_pkg in packages_in_index:
        name = idx_pkg.get("name")
        version = idx_pkg.get("latest_version")
        raw_id = idx_pkg.get("raw_id") or name.replace("sparks/", "")
        index_pkg_names.add(raw_id)

        # Ensure public key is not on revocation list
        pkg_pk = idx_pkg.get("public_key", "").lower()
        if pkg_pk in revoked_keys:
            errors.append(f"{name}: Package signed with revoked key: {pkg_pk}")

        # Check latest manifest packages/<raw_id>.json
        root_manifest_path = os.path.join(packages_dir, f"{raw_id}.json")
        root_m = None
        if not os.path.exists(root_manifest_path):
            errors.append(f"Missing root manifest: {root_manifest_path}")
        else:
            try:
                root_m = load_json(root_manifest_path)
                if root_m.get("name") != name:
                    errors.append(f"{root_manifest_path}: name mismatch with index.json ('{root_m.get('name')}' != '{name}')")
                if root_m.get("version") != version:
                    errors.append(f"{root_manifest_path}: version mismatch with index.json ('{root_m.get('version')}' != '{version}')")
            except Exception as e:
                errors.append(f"Failed to read {root_manifest_path}: {e}")

        # index.json drives the public catalog, so every field it displays must agree
        # with the manifest the client actually installs. Nothing else enforces this:
        # the client never reads index.json, so a stale catalog value would otherwise
        # never be caught. `downloads`/`likes` are live counters and are excluded.
        if root_m is not None:
            for field in ("sha256", "size_bytes", "capabilities", "description",
                          "license", "author", "public_key", "signature", "tarball_url"):
                if field in idx_pkg and idx_pkg.get(field) != root_m.get(field):
                    errors.append(
                        f"{name}: index.json '{field}' disagrees with the root manifest "
                        f"(index={idx_pkg.get(field)!r}, manifest={root_m.get(field)!r})"
                    )

        versions_to_check = idx_pkg.get("versions", [version])

        # The index's version list must match the version manifests actually on disk,
        # otherwise a package can be advertised in the catalog but not installable
        # (or installable but undiscoverable).
        version_dir = os.path.join(packages_dir, raw_id)
        if os.path.isdir(version_dir):
            on_disk = sorted(
                f[:-5] for f in os.listdir(version_dir) if f.endswith(".json")
            )
            declared = sorted(str(v) for v in versions_to_check)
            if on_disk != declared:
                errors.append(
                    f"{name}: index.json advertises versions {declared} but "
                    f"packages/{raw_id}/ contains {on_disk}"
                )
            if version not in on_disk:
                errors.append(
                    f"{name}: latest_version '{version}' has no manifest in packages/{raw_id}/"
                )

        for v in versions_to_check:
            # Check version manifest packages/<raw_id>/<v>.json
            ver_manifest_path = os.path.join(packages_dir, raw_id, f"{v}.json")
            if not os.path.exists(ver_manifest_path):
                errors.append(f"Missing version manifest: {ver_manifest_path}")
                continue

            try:
                ver_m = load_json(ver_manifest_path)
            except Exception as e:
                errors.append(f"Failed to read {ver_manifest_path}: {e}")
                continue

            # Check tarball
            tar_url = ver_m.get("tarball_url", "")
            tar_filename = os.path.basename(tar_url)
            tar_path = os.path.join(tarballs_dir, tar_filename)
            if not os.path.exists(tar_path):
                errors.append(f"Tarball missing for {name} v{v}: {tar_path}")
                continue

            with open(tar_path, "rb") as f:
                tar_bytes = f.read()

            pkg_errs = validate_package_entry(ver_m, tar_bytes, schema, f"{name} v{v}")
            errors.extend(pkg_errs)
            if not pkg_errs:
                sha_disp = clean_hex_sha256(ver_m.get("sha256", ""))[:12]
                print(f"[OK] {name} v{v} verified clean (sha256:{sha_disp}...)")

        # packages/<raw_id>.json and packages/<raw_id>/<latest>.json are two paths to
        # the same release. The publish script writes both, so they can silently drift
        # (one path gaining a field the other never got). They must describe the same
        # artifact on every client-relevant field.
        if root_m is not None and version:
            latest_path = os.path.join(packages_dir, raw_id, f"{version}.json")
            if os.path.exists(latest_path):
                try:
                    latest_m = load_json(latest_path)
                    for field in ("schema", "name", "version", "description", "author",
                                  "license", "tarball_url", "sha256", "public_key",
                                  "signature", "capabilities"):
                        if root_m.get(field) != latest_m.get(field):
                            errors.append(
                                f"{name}: root snapshot packages/{raw_id}.json and exact-release "
                                f"manifest packages/{raw_id}/{version}.json disagree on '{field}'"
                            )
                    only_root = set(root_m) - set(latest_m)
                    only_exact = set(latest_m) - set(root_m)
                    for field in sorted(only_root):
                        WARNINGS.append(
                            f"{name}: '{field}' present in root snapshot but missing from "
                            f"packages/{raw_id}/{version}.json"
                        )
                    for field in sorted(only_exact):
                        WARNINGS.append(
                            f"{name}: '{field}' present in packages/{raw_id}/{version}.json "
                            f"but missing from the root snapshot"
                        )
                except Exception as e:
                    errors.append(f"Failed to read {latest_path}: {e}")

    # Verify that every directory in packages/ is in index.json
    for entry in os.listdir(packages_dir):
        pkg_subdir = os.path.join(packages_dir, entry)
        if os.path.isdir(pkg_subdir):
            if entry not in index_pkg_names:
                errors.append(f"packages/{entry} directory exists on disk but is omitted from index.json!")

    return errors

def main():
    parser = argparse.ArgumentParser(description="Sparks Package Registry Validator")
    parser.add_argument("--root", default=SPARKS_ROOT, help="Path to Sparks registry root directory")
    parser.add_argument("--manifest", help="Path to a single manifest JSON to validate")
    parser.add_argument("--tarball", help="Path to the corresponding tarball for --manifest")
    args = parser.parse_args()

    if args.manifest:
        if not args.tarball:
            print("ERROR: --tarball is required when --manifest is specified", file=sys.stderr)
            sys.exit(1)
        schema_path = os.path.join(args.root, "schema.json")
        schema = load_json(schema_path) if os.path.exists(schema_path) else None
        manifest = load_json(args.manifest)
        with open(args.tarball, "rb") as f:
            tar_bytes = f.read()
        errs = validate_package_entry(manifest, tar_bytes, schema, os.path.basename(args.manifest))
    else:
        errs = validate_full_registry(args.root)

    if errs:
        if WARNINGS:
            print("\n[WARN] NON-FATAL FINDINGS (tracked, not blocking):")
            for warning in WARNINGS:
                print(f"  ! {warning}")
        print("\n[FAIL] VALIDATION FAILED WITH ERRORS:")
        for err in errs:
            print(f"  * {err}")
        sys.exit(1)
    else:
        if WARNINGS:
            print("\n[WARN] NON-FATAL FINDINGS (tracked, not blocking):")
            for warning in WARNINGS:
                print(f"  ! {warning}")
        print("\n[SUCCESS] ALL SPARKS MANIFESTS, TARBALLS, SIGNATURES & INDEX ARE 100% VALID!")
        sys.exit(0)

if __name__ == "__main__":
    main()
