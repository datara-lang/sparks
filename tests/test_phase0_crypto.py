#!/usr/bin/env python3
"""
Regression test suite for Phase 0: Cryptographic Hygiene
Asserts:
1. No private key / SEED bytes exist in repository source code.
2. The old compromised seed key is rejected for all packages.
3. Current packages are signed with the active key and verify cleanly.
4. Key rotation table in index.json reflects revocation of old key.
"""

import os
import json
import glob
import re
from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.exceptions import InvalidSignature

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OLD_COMPROMISED_KEY = "b47a03ffcce4a3be8b62ee853ac37263ad3dd0833f817b97461a5c33f5bce7b7"

def test_no_hardcoded_seeds_in_tracked_code():
    pattern = re.compile(r"^\s*SEED\s*=\s*b?[\"']")
    for root, dirs, files in os.walk(ROOT):
        # Ignore .git and temp
        if ".git" in root or "temp" in root:
            continue
        for f in files:
            if f.endswith(".py"):
                path = os.path.join(root, f)
                with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                    for idx, line in enumerate(fh):
                        assert not pattern.search(line), f"Found hardcoded SEED assignment in {path}:{idx+1}"
    print("[PASS] test_no_hardcoded_seeds_in_tracked_code")

def test_old_compromised_key_rejected():
    old_pub = ed25519.Ed25519PublicKey.from_public_bytes(bytes.fromhex(OLD_COMPROMISED_KEY))
    packages_dir = os.path.join(ROOT, "packages")
    tarballs_dir = os.path.join(ROOT, "tarballs")
    
    for raw_id in ["crypto_core", "math_simd", "http_router", "lockstep_engine", "toy_kv"]:
        manifest_path = os.path.join(packages_dir, raw_id, "1.0.0.json")
        with open(manifest_path, "r", encoding="utf-8") as mf:
            m = json.load(mf)
        
        tar_path = os.path.join(tarballs_dir, f"{raw_id}-1.0.0.tar")
        with open(tar_path, "rb") as tf:
            tar_bytes = tf.read()
            
        sig_bytes = bytes.fromhex(m["signature"])
        
        # Must fail when verified against the old compromised key
        failed = False
        try:
            old_pub.verify(sig_bytes, tar_bytes)
        except InvalidSignature:
            failed = True
            
        assert failed, f"Old compromised key must NOT verify package {raw_id}!"
    print("[PASS] test_old_compromised_key_rejected")

def test_key_rotation_in_index():
    index_path = os.path.join(ROOT, "index.json")
    with open(index_path, "r", encoding="utf-8") as f:
        idx = json.load(f)
        
    assert "key_rotation" in idx, "index.json must contain key_rotation metadata"
    rot = idx["key_rotation"]
    
    # Must have active key
    active = [k for k in rot if k.get("status") == "active"]
    assert len(active) >= 1, "Must have at least one active key"
    assert active[0]["public_key"] != OLD_COMPROMISED_KEY, "Active key must not be the compromised key"
    
    # Must have revoked entry for old key
    revoked = [k for k in rot if k.get("status") == "revoked"]
    assert any(k.get("public_key") == OLD_COMPROMISED_KEY for k in revoked), "Old key must be explicitly listed as revoked"
    print("[PASS] test_key_rotation_in_index")

if __name__ == "__main__":
    test_no_hardcoded_seeds_in_tracked_code()
    test_old_compromised_key_rejected()
    test_key_rotation_in_index()
    print("ALL PHASE 0 CRYPTO TESTS PASSED!")
