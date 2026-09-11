## Sparks Package Publication Checklist

Please verify the following requirements before submitting this Pull Request:

### 1. Package Identity & Metadata
- [ ] Canonical name format conforms to `^sparks/[a-zA-Z0-9_-]+$`.
- [ ] Name does not infringe on reserved `sparks/datara-*` or `sparks/core-*` namespaces.
- [ ] Version is valid SemVer 2.0.0 and has not been published previously.
- [ ] Author contact information and SPDX license are specified.

### 2. Integrity & Cryptographic Signatures
- [ ] Tarball generated deterministically in POSIX ustar format (`mtime=1700000000`, `uid=0`, `gid=0`).
- [ ] `sha256` in manifest matches the exact SHA-256 hex digest of `tarballs/<name>-<version>.tar`.
- [ ] `signature` is a valid 128-hex Ed25519 signature verified by `public_key`.
- [ ] Archive size is within reasonable bounds (<= 10MB) and contains no absolute paths or `..` directory traversal sequences.

### 3. Capabilities & Sidecar
- [ ] `capabilities` array in manifest matches `capabilities.json` inside the tarball bit-for-bit.
- [ ] If pure compute, `capabilities` is empty and no sidecar privileges are requested.

### 4. Local Validation
- [ ] Ran `python scripts/validate_registry.py` locally and verified all checks pass (exit code 0).
