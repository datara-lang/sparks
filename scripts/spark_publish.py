#!/usr/bin/env python3
"""
Sparks Official Package Publisher CLI
Builds deterministic ustar archives, calculates SHA-256, signs with Ed25519,
generates schema-compliant manifests, and prepares pull request files.
"""

import os
import sys
import json
import hashlib
import tarfile
import io
import re
import argparse
from cryptography.hazmat.primitives.asymmetric import ed25519
import jsonschema

SPARKS_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEMA_PATH = os.path.join(SPARKS_ROOT, "schema.json")
TARBALLS_DIR = os.path.join(SPARKS_ROOT, "tarballs")
PACKAGES_DIR = os.path.join(SPARKS_ROOT, "packages")
INDEX_PATH = os.path.join(SPARKS_ROOT, "index.json")

DETERMINISTIC_MTIME = 1700000000  # Fixed epoch for byte-for-byte reproducibility

def load_private_key(key_env=None, seed_hex=None, key_pem=None):
    if seed_hex:
        return ed25519.Ed25519PrivateKey.from_private_bytes(bytes.fromhex(seed_hex.strip()))
    
    if key_env and key_env in os.environ:
        val = os.environ[key_env].strip()
        if len(val) == 64:
            return ed25519.Ed25519PrivateKey.from_private_bytes(bytes.fromhex(val))
        return ed25519.Ed25519PrivateKey.from_private_bytes(val.encode("utf-8")[:32].ljust(32, b"\0"))

    if key_pem and os.path.exists(key_pem):
        from cryptography.hazmat.primitives import serialization
        with open(key_pem, "rb") as kf:
            return serialization.load_pem_private_key(kf.read(), password=None)

    # Fallback to SPARKS_SEED in environment or .env
    env_seed = os.environ.get("SPARKS_SEED", "").strip()
    if not env_seed:
        env_file = os.path.join(SPARKS_ROOT, ".env")
        if os.path.exists(env_file):
            with open(env_file, "r", encoding="utf-8") as ef:
                for line in ef:
                    line = line.strip()
                    if line.startswith("SPARKS_SEED="):
                        env_seed = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break

    if env_seed:
        if len(env_seed) == 64:
            return ed25519.Ed25519PrivateKey.from_private_bytes(bytes.fromhex(env_seed))
        return ed25519.Ed25519PrivateKey.from_private_bytes(env_seed.encode("utf-8")[:32].ljust(32, b"\0"))

    raise RuntimeError("No private key provided! Use --key-env, --seed-hex, --key-pem, or set SPARKS_SEED.")

def build_deterministic_tar(files_dict):
    """
    Builds a bit-for-bit reproducible POSIX ustar archive.
    Files are sorted lexicographically by relative path.
    Timestamps, uid/gid, and modes are normalized.
    """
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w", format=tarfile.USTAR_FORMAT) as tar:
        for fname in sorted(files_dict.keys()):
            data = files_dict[fname]
            if isinstance(data, str):
                bdata = data.encode("utf-8")
            else:
                bdata = data
            
            # Normalize member metadata
            ti = tarfile.TarInfo(name=fname.replace("\\", "/"))
            ti.size = len(bdata)
            ti.mtime = DETERMINISTIC_MTIME
            ti.mode = 0o644
            ti.uid = 0
            ti.gid = 0
            ti.uname = ""
            ti.gname = ""
            tar.addfile(ti, io.BytesIO(bdata))
    return buf.getvalue()

def publish_package(
    pkg_dir,
    name,
    version,
    description,
    author,
    license_id="MIT OR Apache-2.0",
    key_env=None,
    seed_hex=None,
    key_pem=None,
    key_id="author-default",
    tags=None,
    sample_usage=None,
    dry_run=False,
    registry_root=SPARKS_ROOT
):
    if not os.path.isdir(pkg_dir):
        raise ValueError(f"Package source directory '{pkg_dir}' does not exist!")

    if not name.startswith("sparks/"):
        name = f"sparks/{name}"

    raw_id = name.replace("sparks/", "")

    # 1. Read files from package directory
    files = {}
    ignored_names = {".git", ".forgen_cache", "target", "__pycache__", ".DS_Store"}
    for root, dirs, filenames in os.walk(pkg_dir):
        dirs[:] = [d for d in dirs if d not in ignored_names]
        for fn in filenames:
            if fn.endswith(".tmp") or fn.endswith(".tar"):
                continue
            full_path = os.path.join(root, fn)
            rel_path = os.path.relpath(full_path, pkg_dir).replace("\\", "/")
            with open(full_path, "rb") as f:
                files[rel_path] = f.read()

    if not files:
        raise ValueError(f"Package directory '{pkg_dir}' contains no files!")

    # 2. Extract capabilities from capabilities.json if present
    capabilities = []
    if "capabilities.json" in files:
        try:
            cap_data = json.loads(files["capabilities.json"].decode("utf-8"))
            capabilities = sorted(cap_data.get("capabilities", []))
        except Exception as e:
            raise ValueError(f"Failed to parse capabilities.json inside package: {e}")

    readme_text = ""
    if "README.md" in files:
        readme_text = files["README.md"].decode("utf-8", errors="ignore")
        if not description:
            first_line = readme_text.strip().split("\n")[0]
            description = first_line.lstrip("#").strip() or f"Datara Sparks package {name}"
    description = description or f"Datara Sparks package {name}"

    # 4. Assemble deterministic tarball
    tar_bytes = build_deterministic_tar(files)
    tar_filename = f"{raw_id}-{version}.tar"

    # 5. Calculate digest and sign
    sha256_hash = hashlib.sha256(tar_bytes).hexdigest().lower()
    priv_key = load_private_key(key_env, seed_hex, key_pem)
    pub_key = priv_key.public_key()
    pub_key_hex = pub_key.public_bytes_raw().hex().lower()
    sig_hex = priv_key.sign(tar_bytes).hex().lower()
    content_size = sum(len(b) for b in files.values())

    # 6. Build Manifest (Schema 1)
    manifest = {
        "schema": 1,
        "name": name,
        "version": version,
        "description": description,
        "author": author,
        "license": license_id,
        "tarball_url": f"tarballs/{tar_filename}",
        "sha256": sha256_hash,
        "public_key": pub_key_hex,
        "signature": sig_hex,
        "key_id": key_id,
        "size_bytes": content_size,
        "downloads": 0,
        "capabilities": capabilities,
        "dependencies": {},
        "tags": tags or ["datara", raw_id],
        "sample_usage": sample_usage or f"use {name}\n\nfn main() {{\n    println(\"Using {name}\")\n}}",
        "readme": readme_text
    }

    # 7. Validate Manifest against schema.json
    schema_path = os.path.join(registry_root, "schema.json")
    with open(schema_path, "r", encoding="utf-8") as sf:
        schema = json.load(sf)
    jsonschema.validate(instance=manifest, schema=schema)

    # Verify signature locally
    pub_key.verify(bytes.fromhex(sig_hex), tar_bytes)

    if dry_run:
        print(f"[DRY-RUN] Manifest and tarball validated cleanly for {name} v{version}.")
        return manifest, tar_bytes

    # 8. Write to registry tree
    tarballs_dir = os.path.join(registry_root, "tarballs")
    packages_dir = os.path.join(registry_root, "packages")
    os.makedirs(tarballs_dir, exist_ok=True)
    os.makedirs(packages_dir, exist_ok=True)

    # Write tarball
    tar_dest = os.path.join(tarballs_dir, tar_filename)
    with open(tar_dest, "wb") as f:
        f.write(tar_bytes)

    # Write version manifest: packages/<raw_id>/<version>.json
    pkg_ver_dir = os.path.join(packages_dir, raw_id)
    os.makedirs(pkg_ver_dir, exist_ok=True)
    ver_manifest_path = os.path.join(pkg_ver_dir, f"{version}.json")
    with open(ver_manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    # Write or update latest manifest: packages/<raw_id>.json
    root_manifest_path = os.path.join(packages_dir, f"{raw_id}.json")
    all_versions = [version]
    if os.path.exists(root_manifest_path):
        try:
            with open(root_manifest_path, "r", encoding="utf-8") as rmf:
                existing_root = json.load(rmf)
                all_versions = existing_root.get("all_versions", [])
                if version not in all_versions:
                    all_versions.append(version)
        except Exception:
            pass

    # Sort versions using SemVer
    def semver_sort_key(v_str):
        parts = []
        for p in v_str.split("."):
            num = ""
            for ch in p:
                if ch.isdigit():
                    num += ch
                else:
                    break
            parts.append(int(num) if num else 0)
        return parts

    all_versions.sort(key=semver_sort_key)
    latest_ver = all_versions[-1]

    # Also write packages/<raw_id>/README.md if readme_text is present
    if readme_text:
        pkg_readme_path = os.path.join(pkg_ver_dir, "README.md")
        with open(pkg_readme_path, "w", encoding="utf-8") as rf:
            rf.write(readme_text)

    pkg_manifest_copy = dict(manifest)
    pkg_manifest_copy["all_versions"] = all_versions[::-1]  # descending for display
    pkg_manifest_copy["version"] = latest_ver
    with open(root_manifest_path, "w", encoding="utf-8") as f:
        json.dump(pkg_manifest_copy, f, indent=2)

    # Update index.json
    index_path = os.path.join(registry_root, "index.json")
    with open(index_path, "r", encoding="utf-8") as idxf:
        idx_data = json.load(idxf)

    pkg_list = idx_data.get("packages", [])
    entry_found = False
    for p in pkg_list:
        if p.get("name") == name:
            p.update({
                "latest_version": latest_ver,
                "description": description,
                "author": author,
                "license": license_id,
                "capabilities": capabilities,
                "tags": manifest["tags"],
                "tarball_url": f"tarballs/{tar_filename}" if version == latest_ver else p.get("tarball_url"),
                "sha256": sha256_hash if version == latest_ver else p.get("sha256"),
                "public_key": pub_key_hex,
                "signature": sig_hex if version == latest_ver else p.get("signature"),
                "key_id": key_id,
                "sample_usage": manifest["sample_usage"],
                "readme": readme_text or p.get("readme", ""),
                "size_bytes": content_size if version == latest_ver else p.get("size_bytes", content_size),
                "downloads": p.get("downloads", 0),
                "likes": p.get("likes", 0)
            })
            p["versions"] = all_versions[::-1]
            entry_found = True
            break

    if not entry_found:
        pkg_list.append({
            "name": name,
            "raw_id": raw_id,
            "latest_version": latest_ver,
            "description": description,
            "author": author,
            "license": license_id,
            "capabilities": capabilities,
            "tags": manifest["tags"],
            "tarball_url": f"tarballs/{tar_filename}",
            "sha256": sha256_hash,
            "public_key": pub_key_hex,
            "signature": sig_hex,
            "key_id": key_id,
            "sample_usage": manifest["sample_usage"],
            "readme": readme_text,
            "versions": all_versions[::-1],
            "size_bytes": content_size,
            "downloads": 0,
            "likes": 0
        })

    idx_data["packages"] = pkg_list
    idx_data["total_packages"] = len(pkg_list)

    with open(index_path, "w", encoding="utf-8") as idxf:
        json.dump(idx_data, idxf, indent=2)

    print(f"\n[SUCCESS] Published {name} v{version}!")
    print(f"  Tarball:   {tar_dest} ({len(tar_bytes)} bytes)")
    print(f"  SHA-256:   {sha256_hash}")
    print(f"  Public Key:{pub_key_hex}")
    print(f"  Manifest:  {ver_manifest_path}")
    print("\nNext steps for submitting to Sparks:")
    print(f"  git checkout -b spark/{raw_id}-{version}")
    print(f"  git add packages/{raw_id}/ packages/{raw_id}.json tarballs/{tar_filename} index.json")
    print(f"  git commit -m \"feat(sparks): add {name} {version}\"")
    print(f"  gh pr create --title \"feat: publish {name} {version}\" --fill")

    return manifest, tar_bytes

def main():
    parser = argparse.ArgumentParser(description="Publish a Datara package to Sparks registry")
    parser.add_argument("--pkg-dir", required=True, help="Directory containing package sources (main.dtr, etc.)")
    parser.add_argument("--name", required=True, help="Package name (e.g. sparks/fast_json)")
    parser.add_argument("--version", required=True, help="SemVer version (e.g. 1.0.0)")
    parser.add_argument("--description", default="", help="Concise package summary")
    parser.add_argument("--author", required=True, help="Author name & contact")
    parser.add_argument("--license", default="MIT OR Apache-2.0", help="SPDX license")
    parser.add_argument("--key-env", help="Env var name holding Ed25519 private key hex")
    parser.add_argument("--seed-hex", help="Raw 32-byte private key in hex")
    parser.add_argument("--key-pem", help="Path to PEM private key")
    parser.add_argument("--key-id", default="author-2026", help="Author key identifier")
    parser.add_argument("--dry-run", action="store_true", help="Simulate without writing files")

    args = parser.parse_args()
    try:
        publish_package(
            pkg_dir=args.pkg_dir,
            name=args.name,
            version=args.version,
            description=args.description,
            author=args.author,
            license_id=args.license,
            key_env=args.key_env,
            seed_hex=args.seed_hex,
            key_pem=args.key_pem,
            key_id=args.key_id,
            dry_run=args.dry_run
        )
    except Exception as e:
        print(f"[ERROR] Publication failed: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
