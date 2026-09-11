# Sparks Registry Operations, Uptime & Continuity Guide

This document details the operational architecture, disaster recovery procedures, key rotation checklists, and protocol stability guarantees of the Sparks package registry.

---

## 1. Uptime Architecture: Zero-Service Decentralization

Sparks employs a **zero-service, pure-data architecture**:
- **Distribution:** Hosted as a static site on GitHub Pages backed by GitHub's globally distributed Fastly/Cloudflare CDN edge cache.
- **Availability:** Inherits GitHub Pages 99.9% uptime SLA. Because there are no backend databases, dynamic query engines, or daemon processes to crash, server-side downtime risks are virtually zero.
- **Bandwidth & Limits:** Assets (tarballs and manifests) are served over static HTTP/HTTPS with aggressive cache headers and CORS enabled.

---

## 2. Redundancy, Mirrors & Offline Continuity

If the primary GitHub Pages endpoint (`https://waters1ze.github.io/sparks`) experiences regional disruption or throttling:

### 2.1 Secondary Mirroring
Any Git host (GitLab Pages, Sourcehut, AWS S3, Cloudflare Pages) can mirror Sparks with 100% fidelity simply by pushing the repository:
```bash
# Push mirror to secondary CDN
git remote add mirror https://gitlab.com/datara/sparks.git
git push mirror main
```

Consumers point `dpm` to the mirror with zero code modifications:
```bash
export DATARA_SPARKS_REGISTRY="https://datara.gitlab.io/sparks"
```

### 2.2 Air-Gapped & Offline `file://` Operation
The entire registry is self-contained. Cloned locally, it functions without network access:
```bash
# 1. Clone repository onto air-gapped machine or thumb drive
git clone https://github.com/waters1ze/sparks.git /opt/sparks

# 2. Configure dpm to use the file protocol
export DATARA_SPARKS_REGISTRY="file:///opt/sparks"

# 3. Add dependencies with full offline cryptographic verification
dpm add sparks/crypto_core
```

---

## 3. Full Backup Protocol

> [!TIP]
> `git clone https://github.com/waters1ze/sparks.git` represents a **100% bit-complete, independent backup** of the entire Sparks package ecosystem.

To archive or mirror the registry for disaster recovery:
```bash
git clone --mirror https://github.com/waters1ze/sparks.git sparks-mirror.git
tar -czf sparks-backup-$(date +%Y%m%d).tar.gz sparks-mirror.git
```

---

## 4. Key Rotation Checklist

When an author or maintainer key requires scheduled rotation or emergency revocation:

1. [ ] **Generate New Keypair:** Generate a new Ed25519 32-byte private key.
2. [ ] **Update Local Environment:** Export `SPARKS_SEED` or author key secret in the publishing environment.
3. [ ] **Record in `index.json`:** Add new public key entry to `key_rotation` with `status: "active"` and `valid_from` timestamp.
4. [ ] **Mark Prior Key Revoked (if compromised):** Update previous entry in `key_rotation` to `status: "revoked"`, with `revoked_at` and explanation in `reason`.
5. [ ] **Run Validator:** Execute `python scripts/validate_registry.py` locally. Confirm that packages signed by active keys pass and revoked keys are rejected.
6. [ ] **Submit PR:** Submit pull request to `main`. Once merged, GitHub Pages serves the updated key rotation table immediately.

---

## 5. Protocol Versioning & Compatibility Rules

Sparks manifests and index adhere to **Schema 1**:
- **Schema 1 Freeze:** Existing fields (`schema`, `name`, `version`, `tarball_url`, `sha256`, `public_key`, `signature`, `capabilities`) are immutable and strictly preserved.
- **Additive Evolution:** New features (such as `key_id`, `size_bytes`, `verify_command`) are added as optional, non-breaking fields.
- **Backward Compatibility:** `dpm` clients built for Schema 1 must never fail when encountering unknown additive fields.
- **Schema 2 Gate:** A breaking change (e.g. migration to quantum-resistant signatures) will increment `schema: 2`, maintaining Schema 1 endpoints in parallel for legacy compilers.
