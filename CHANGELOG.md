# Changelog

All notable changes to the Sparks Package Registry will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.1] - 2026-09-11

### Security Hardening (P0 / P1 Fixes)
- **Cryptographic Hygiene (P0):** Eliminated hardcoded seed keys from `build_seed_packages.py`. Keys are now derived securely from environment variables (`SPARKS_SEED`) or local `.env` files.
- **Official Seed Key Rotation:** Re-signed all 5 official seed packages (`crypto_core`, `math_simd`, `http_router`, `lockstep_engine`, `toy_kv`) with a fresh 32-byte Ed25519 key. The initial development key (`b47a03ff...`) has been revoked and recorded in the registry key rotation ledger.
- **Key Rotation Ledger:** Added formal `key_rotation` tracking in `index.json` and optional `key_id` in `schema.json` to monitor key lifecycle and reject revoked credentials.
- **Honest Web Generator (P0):** Replaced dummy hash (`e3b0c442...`) and hardcoded foreign signature in `app.js` with browser-native SHA-256 calculation via `crypto.subtle.digest` on uploaded tarballs.
- **XSS Audit:** Audited and strictly sanitized all dynamic DOM insertions using `escapeHtml()` across the web catalog.

### Added
- **CI Pull Request Validation Workflow (`.github/workflows/validate.yml`):** Automatically validates schema compliance, SHA-256 integrity, Ed25519 signatures, capability sidecar parity, SemVer format, archive path safety, and index consistency on every pull request and push to `main`.
- **CLI Packaging Tool (`scripts/spark_publish.py`):** Authoring CLI that packages deterministic POSIX ustar archives (`mtime=1700000000`, `uid=0`, `gid=0`), calculates SHA-256, signs with Ed25519, and generates pull-request-ready manifests.
- **Local Validator (`scripts/validate_registry.py`):** Standalone integrity checker enforcing the same 7 validation invariants locally and in CI.
- **Automated Client E2E Testing (`scripts/e2e_client.ps1`):** End-to-end integration script verifying package resolution, signature checking, and installation using the real `dpm` binary against local HTTP endpoints.
- **Compiler Remote Test (`tests/test_sparks_remote.rs`):** Added remote Sparks resolution test suite in the Datara compiler repository.
- **Negative Test Fixtures (`tests/test_ci_validation_fixtures.py`):** 6 regression fixtures verifying rejection of invalid schemas, corrupted checksums, tampered signatures, capability mismatches, path traversal attacks, and invalid SemVer.
- **Documentation Suite:**
  - `SECURITY.md`: Vulnerability disclosure guidelines, SLA, and contacts.
  - `POLICY.md`: Namespace reservation rules (`sparks/datara-*`), package immutability, and security takedown procedures.
  - `docs/KEY_MANAGEMENT.md`: Author Ed25519 key creation, signing, and rotation guide.
  - `docs/THREAT_MODEL.md`: Comprehensive threat model and trust boundary definitions.
  - `docs/OPERATIONS.md`: Zero-service uptime architecture, backup protocols, and disaster recovery.
  - `.github/PULL_REQUEST_TEMPLATE.md`: Publisher checklist for pull requests.
  - `.github/CODEOWNERS`: Enforced maintainer review policies for `packages/` and `tarballs/`.

### Changed
- **Digest Normalization (P1):** Standardized SHA-256 checksums everywhere to canonical clean 64-character lowercase hex strings (without `sha256:` prefix) in `schema.json`, `index.json`, and all package manifests.
- **Accurate Content Sizing (P2):** Replaced tar-padding block size (`10240`) with actual unpadded content size (`size_bytes`) in manifests and `index.json`.
- **Deterministic Metadata:** Replaced dynamic execution timestamps with deterministic timestamps derived from git commit history.
- **Determinism Receipts:** Omitted unverified MD5 receipt stubs from static seed manifests in favor of honest verifiable metadata.

---

## [1.0.0] - 2026-09-11

### Initial Release
- Initial release of Sparks capability-native package registry for Datara 1.0.0.
- Sparse index endpoints (`/index.json`, `/packages/<name>.json`, `/packages/<name>/<version>.json`).
- Initial 5 official seed packages (`crypto_core`, `math_simd`, `http_router`, `lockstep_engine`, `toy_kv`).
- Static web catalog with search, filtering, and manifest preview.
