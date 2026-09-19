#!/usr/bin/env python3
"""
Test suite for Phase 1: scripts/spark_publish.py and Cryptographic Integrity
Asserts:
1. End-to-end publication of a sample package via spark_publish.py
2. Output manifest validates against schema.json and signature verifies
3. Tampered byte in tarball triggers SHA-256 mismatch
4. Corrupted signature triggers Ed25519 verification failure
5. Determinism: duplicate execution produces byte-for-byte identical tarball
"""

import os
import sys
import shutil
import tempfile
import json
import hashlib
from cryptography.hazmat.primitives.asymmetric import ed25519

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from spark_publish import publish_package, build_deterministic_tar
from validate_registry import validate_package_entry, load_json

def create_sample_pkg_dir(dir_path):
    os.makedirs(dir_path, exist_ok=True)
    with open(os.path.join(dir_path, "main.dtr"), "w", encoding="utf-8") as f:
        f.write("module sample_pkg\nfn add(a: Int, b: Int) -> Int { return a + b }\n")
    with open(os.path.join(dir_path, "capabilities.json"), "w", encoding="utf-8") as f:
        f.write(json.dumps({"capabilities": ["Capability<FileRead>"]}, indent=2))
    with open(os.path.join(dir_path, "README.md"), "w", encoding="utf-8") as f:
        f.write("# Sample Package\nDemonstration library for Sparks.\n")

def test_spark_publish_e2e():
    temp_dir = tempfile.mkdtemp(prefix="sparks_test_pub_")
    try:
        pkg_src = os.path.join(temp_dir, "sample_lib")
        create_sample_pkg_dir(pkg_src)
        
        # Test registry clone
        fake_reg = os.path.join(temp_dir, "reg")
        os.makedirs(os.path.join(fake_reg, "tarballs"), exist_ok=True)
        os.makedirs(os.path.join(fake_reg, "packages"), exist_ok=True)
        shutil.copy(os.path.join(ROOT, "schema.json"), os.path.join(fake_reg, "schema.json"))
        with open(os.path.join(fake_reg, "index.json"), "w", encoding="utf-8") as f:
            json.dump({"schema": 1, "name": "Test Registry", "packages": []}, f)
            
        test_seed = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        manifest, tar_bytes = publish_package(
            pkg_dir=pkg_src,
            name="sparks/sample_lib",
            version="1.0.0",
            description="Sample library for unit test",
            author="Tester <tester@datara.dev>",
            seed_hex=test_seed,
            registry_root=fake_reg
        )
        
        # Verify files created
        tar_path = os.path.join(fake_reg, "tarballs", "sample_lib-1.0.0.tar")
        assert os.path.exists(tar_path), "Tarball must be created"
        ver_manifest_path = os.path.join(fake_reg, "packages", "sample_lib", "1.0.0.json")
        assert os.path.exists(ver_manifest_path), "Version manifest must be created"
        root_manifest_path = os.path.join(fake_reg, "packages", "sample_lib.json")
        assert os.path.exists(root_manifest_path), "Root manifest must be created"
        
        # Validate entry
        schema = load_json(os.path.join(ROOT, "schema.json"))
        errs = validate_package_entry(manifest, tar_bytes, schema, "sample_lib v1.0.0")
        assert not errs, f"Validation errors on published package: {errs}"
        print("[PASS] test_spark_publish_e2e")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

def _create_signed_test_package():
    priv = ed25519.Ed25519PrivateKey.generate()
    pub_hex = priv.public_key().public_bytes_raw().hex()
    files = {
        "src/main.dtr": "fn main() { println(42) }\n",
        "README.md": "# Test\n",
        "capabilities.json": '{"capabilities": []}'
    }
    tar_bytes = build_deterministic_tar(files)
    sha_hex = hashlib.sha256(tar_bytes).hexdigest()
    sig_hex = priv.sign(tar_bytes).hex()
    manifest = {
        "schema": 1,
        "name": "sparks/tamper_test",
        "version": "1.0.0",
        "description": "Tamper test package",
        "author": "Test Author <test@datara.dev>",
        "license": "MIT",
        "tarball_url": "tarballs/tamper_test-1.0.0.tar",
        "sha256": sha_hex,
        "public_key": pub_hex,
        "signature": sig_hex,
        "capabilities": []
    }
    return manifest, tar_bytes

def test_tamper_sha256_detection():
    schema = load_json(os.path.join(ROOT, "schema.json"))
    raw_id = "tamper_test"
    manifest, tar_bytes = _create_signed_test_package()
    tar_bytes = bytearray(tar_bytes)

    # Flip 1 byte
    tar_bytes[100] ^= 0xFF
    errs = validate_package_entry(manifest, bytes(tar_bytes), schema, raw_id)
    assert any("SHA-256 artifact checksum mismatch" in e for e in errs), "Tampered byte must be caught by SHA-256 check!"
    print("[PASS] test_tamper_sha256_detection")

def test_tamper_signature_detection():
    schema = load_json(os.path.join(ROOT, "schema.json"))
    raw_id = "tamper_test"
    manifest, tar_bytes = _create_signed_test_package()
    manifest = dict(manifest)

    # Corrupt signature hex by modifying one character
    sig = list(manifest["signature"])
    sig[10] = '0' if sig[10] != '0' else '1'
    manifest["signature"] = "".join(sig)

    errs = validate_package_entry(manifest, tar_bytes, schema, raw_id)
    assert any("ed25519 package verification failed" in e for e in errs), "Corrupted signature must be rejected by ed25519 verification!"
    print("[PASS] test_tamper_signature_detection")

def test_deterministic_tar_packaging():
    files = {
        "src/main.dtr": "fn main() { println(42) }\n",
        "README.md": "# Test\n",
        "capabilities.json": '{"capabilities": []}'
    }
    tar1 = build_deterministic_tar(files)
    tar2 = build_deterministic_tar(files)
    assert tar1 == tar2, "build_deterministic_tar must produce bit-for-bit identical archives!"
    assert hashlib.sha256(tar1).hexdigest() == hashlib.sha256(tar2).hexdigest()
    print("[PASS] test_deterministic_tar_packaging")

if __name__ == "__main__":
    test_spark_publish_e2e()
    test_tamper_sha256_detection()
    test_tamper_signature_detection()
    test_deterministic_tar_packaging()
    print("ALL PHASE 1 PUBLISH & SIGNATURE TESTS PASSED!")
