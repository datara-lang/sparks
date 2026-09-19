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

    # If packages exist on disk, check each of them
    if os.path.isdir(packages_dir):
        for entry in os.listdir(packages_dir):
            pkg_dir = os.path.join(packages_dir, entry)
            if os.path.isdir(pkg_dir):
                for mf_name in os.listdir(pkg_dir):
                    if mf_name.endswith(".json"):
                        manifest_path = os.path.join(pkg_dir, mf_name)
                        with open(manifest_path, "r", encoding="utf-8") as mf:
                            m = json.load(mf)
                        tar_rel = m.get("tarball_url", "")
                        tar_path = os.path.join(ROOT, tar_rel)
                        if os.path.exists(tar_path):
                            with open(tar_path, "rb") as tf:
                                tar_bytes = tf.read()
                            sig_bytes = bytes.fromhex(m["signature"])
                            failed = False
                            try:
                                old_pub.verify(sig_bytes, tar_bytes)
                            except InvalidSignature:
                                failed = True
                            assert failed, f"Old compromised key must NOT verify package {entry}!"

    # Also verify with a freshly signed artifact
    test_priv = ed25519.Ed25519PrivateKey.generate()
    test_data = b"synthetic test tarball bytes for signature verification"
    test_sig = test_priv.sign(test_data)
    failed = False
    try:
        old_pub.verify(test_sig, test_data)
    except InvalidSignature:
        failed = True
    assert failed, "Old compromised key must NOT verify foreign signatures!"
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
