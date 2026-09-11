#!/usr/bin/env python3
"""
Negative fixture test suite for Phase 2: CI Validation (validate.yml / validate_registry.py)
Asserts that faulty PRs and malformed packages are strictly rejected:
1. schema_invalid: Manifest missing required field ('version')
2. sha256_tampered: Tarball bytes modified after checksum calculation
3. signature_corrupted: Ed25519 signature altered
4. capability_mismatch: Manifest claims [] but tarball has Capability<FileRead>
5. path_traversal: Tarball contains '../escaped.dtr' or absolute path
6. semver_invalid: Version is non-semver (e.g. 'v1' or 'beta')
"""

import os
import sys
import json
import io
import tarfile
import tempfile
import shutil
from cryptography.hazmat.primitives.asymmetric import ed25519

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from validate_registry import validate_package_entry, load_json
from spark_publish import build_deterministic_tar

def get_valid_base():
    seed = bytes.fromhex("11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff")
    priv = ed25519.Ed25519PrivateKey.from_private_bytes(seed)
    pub_hex = priv.public_key().public_bytes_raw().hex()
    
    files = {
        "main.dtr": "fn main() {}\n",
        "capabilities.json": '{"capabilities": ["Capability<FileRead>"]}'
    }
    tar_bytes = build_deterministic_tar(files)
    import hashlib
    sha_hex = hashlib.sha256(tar_bytes).hexdigest()
    sig_hex = priv.sign(tar_bytes).hex()
    
    manifest = {
        "schema": 1,
        "name": "sparks/fixture_test",
        "version": "1.0.0",
        "description": "Fixture test package",
        "author": "Fixture Author <author@datara.dev>",
        "license": "MIT",
        "tarball_url": "tarballs/fixture_test-1.0.0.tar",
        "sha256": sha_hex,
        "public_key": pub_hex,
        "signature": sig_hex,
        "capabilities": ["Capability<FileRead>"],
        "dependencies": {}
    }
    return manifest, tar_bytes, priv

def test_fixture_1_schema_invalid():
    schema = load_json(os.path.join(ROOT, "schema.json"))
    manifest, tar_bytes, _ = get_valid_base()
    del manifest["version"]  # Required field
    errs = validate_package_entry(manifest, tar_bytes, schema, "fixture_schema_invalid")
    assert any("Schema validation error" in e for e in errs), f"Expected schema error, got {errs}"
    print("[PASS] Fixture 1: schema_invalid caught")

def test_fixture_2_sha256_tampered():
    schema = load_json(os.path.join(ROOT, "schema.json"))
    manifest, tar_bytes, _ = get_valid_base()
    tampered_tar = bytearray(tar_bytes)
    tampered_tar[50] ^= 0xAA
    errs = validate_package_entry(manifest, bytes(tampered_tar), schema, "fixture_sha256_tampered")
    assert any("SHA-256 artifact checksum mismatch" in e for e in errs), f"Expected SHA-256 mismatch, got {errs}"
    print("[PASS] Fixture 2: sha256_tampered caught")

def test_fixture_3_signature_corrupted():
    schema = load_json(os.path.join(ROOT, "schema.json"))
    manifest, tar_bytes, _ = get_valid_base()
    sig = list(manifest["signature"])
    sig[0] = 'a' if sig[0] != 'a' else 'b'
    manifest["signature"] = "".join(sig)
    errs = validate_package_entry(manifest, tar_bytes, schema, "fixture_signature_corrupted")
    assert any("ed25519 package verification failed" in e for e in errs), f"Expected ed25519 failure, got {errs}"
    print("[PASS] Fixture 3: signature_corrupted caught")

def test_fixture_4_capability_mismatch():
    schema = load_json(os.path.join(ROOT, "schema.json"))
    manifest, tar_bytes, priv = get_valid_base()
    # Manifest claims no capabilities, but tarball has Capability<FileRead>
    manifest["capabilities"] = []
    # Re-sign to isolate capability failure from signature failure
    manifest["signature"] = priv.sign(tar_bytes).hex()
    errs = validate_package_entry(manifest, tar_bytes, schema, "fixture_capability_mismatch")
    assert any("Capability declaration mismatch" in e for e in errs), f"Expected capability mismatch, got {errs}"
    print("[PASS] Fixture 4: capability_mismatch caught")

def test_fixture_5_path_traversal():
    schema = load_json(os.path.join(ROOT, "schema.json"))
    manifest, _, priv = get_valid_base()
    
    # Create malicious tarball with ../path
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tar:
        data = b"evil content"
        ti = tarfile.TarInfo(name="../escape.dtr")
        ti.size = len(data)
        tar.addfile(ti, io.BytesIO(data))
    bad_tar = buf.getvalue()
    
    import hashlib
    manifest["sha256"] = hashlib.sha256(bad_tar).hexdigest()
    manifest["signature"] = priv.sign(bad_tar).hex()
    manifest["capabilities"] = []
    
    errs = validate_package_entry(manifest, bad_tar, schema, "fixture_path_traversal")
    assert any("Tarball contains path traversal" in e for e in errs), f"Expected path traversal rejection, got {errs}"
    print("[PASS] Fixture 5: path_traversal caught")

def test_fixture_6_semver_invalid():
    schema = load_json(os.path.join(ROOT, "schema.json"))
    manifest, tar_bytes, _ = get_valid_base()
    manifest["version"] = "v1.0-badver"
    errs = validate_package_entry(manifest, tar_bytes, schema, "fixture_semver_invalid")
    assert any("Invalid version" in e or "Schema validation error" in e for e in errs), f"Expected semver error, got {errs}"
    print("[PASS] Fixture 6: semver_invalid caught")

if __name__ == "__main__":
    test_fixture_1_schema_invalid()
    test_fixture_2_sha256_tampered()
    test_fixture_3_signature_corrupted()
    test_fixture_4_capability_mismatch()
    test_fixture_5_path_traversal()
    test_fixture_6_semver_invalid()
    print("ALL 6 NEGATIVE CI VALIDATION FIXTURES CAUGHT CLEANLY!")
