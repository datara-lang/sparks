import os
import sys
import json
import hashlib
import tarfile

SPARKS_ROOT = os.path.dirname(os.path.abspath(__file__))
INDEX_FILE = os.path.join(SPARKS_ROOT, "index.json")
SCHEMA_FILE = os.path.join(SPARKS_ROOT, "schema.json")
PACKAGES_DIR = os.path.join(SPARKS_ROOT, "packages")
TARBALLS_DIR = os.path.join(SPARKS_ROOT, "tarballs")

def run_checks():
    errors = []
    print("=== Sparks Registry Integrity Check ===")
    
    # 1. Check index.json
    if not os.path.exists(INDEX_FILE):
        errors.append("index.json is missing!")
        return errors
        
    with open(INDEX_FILE, "r", encoding="utf-8") as f:
        try:
            index_data = json.load(f)
        except Exception as e:
            errors.append(f"index.json invalid JSON: {e}")
            return errors
            
    packages = index_data.get("packages", [])
    print(f"[OK] index.json parsed ({len(packages)} packages listed)")
    
    # 2. Verify each package
    for pkg in packages:
        name = pkg.get("name")
        version = pkg.get("latest_version")
        raw_id = name.replace("sparks/", "")
        
        # Check package manifest
        ver_manifest_path = os.path.join(PACKAGES_DIR, raw_id, f"{version}.json")
        if not os.path.exists(ver_manifest_path):
            errors.append(f"Manifest missing: {ver_manifest_path}")
            continue
            
        with open(ver_manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)
            
        # Check tarball
        tar_filename = f"{raw_id}-{version}.tar"
        tar_path = os.path.join(TARBALLS_DIR, tar_filename)
        if not os.path.exists(tar_path):
            errors.append(f"Tarball missing for {name}: {tar_path}")
            continue
            
        with open(tar_path, "rb") as f:
            tar_bytes = f.read()
            
        # Verify SHA-256
        actual_sha = hashlib.sha256(tar_bytes).hexdigest()
        expected_sha = manifest.get("sha256", "").replace("sha256:", "").strip()
        if actual_sha != expected_sha:
            errors.append(f"SHA-256 mismatch for {name}! Expected {expected_sha}, got {actual_sha}")
            continue
            
        # Verify capabilities in tarball match manifest
        try:
            import io
            bio = io.BytesIO(tar_bytes)
            with tarfile.open(fileobj=bio, mode="r") as tar:
                names = tar.getnames()
                if "capabilities.json" in names:
                    cap_f = tar.extractfile("capabilities.json")
                    cap_json = json.load(cap_f)
                    caps = cap_json.get("capabilities", [])
                    if sorted(caps) != sorted(manifest.get("capabilities", [])):
                        errors.append(f"Capability declaration mismatch for {name}")
        except Exception as e:
            errors.append(f"Failed to inspect tarball {name}: {e}")
            
        print(f"[OK] Verified {name} v{version} (sha256:{actual_sha[:12]}...)")
        
    return errors

if __name__ == "__main__":
    errs = run_checks()
    if errs:
        print("\nERRORS ENCOUNTERED:")
        for err in errs:
            print(" -", err)
        sys.exit(1)
    else:
        print("\nALL SPARKS PACKAGES AND MANIFESTS VERIFIED 100% CLEAN!")
        sys.exit(0)
