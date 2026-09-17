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

If the primary GitHub Pages endpoint (`https://datara-lang.github.io/sparks`) experiences regional disruption or throttling:

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
git clone https://github.com/datara-lang/sparks.git /opt/sparks

# 2. Configure dpm to use the file protocol
export DATARA_SPARKS_REGISTRY="file:///opt/sparks"

# 3. Add dependencies with full offline cryptographic verification
dpm add sparks/crypto_core
```

---

## 3. Full Backup Protocol

> [!TIP]
> `git clone https://github.com/datara-lang/sparks.git` represents a **100% bit-complete, independent backup** of the entire Sparks package ecosystem.

To archive or mirror the registry for disaster recovery:
```bash
git clone --mirror https://github.com/datara-lang/sparks.git sparks-mirror.git
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

---

## 6. Community Counter Operations

The web portal shows two download/appreciation figures that come from outside the
registry repository: a shared **public counter** (Abacus,
`https://abacus.jasoncameron.dev`). This section documents what that means for
operations.

### 6.1 What the counter is, and is not

- It is **not** part of the registry protocol. `dpm` never contacts it, and no
  manifest, tarball, signature or `index.json` field depends on it.
- It is a **best-effort presentation layer**. If the service is unreachable,
  rate-limited or switched off, the portal falls back to the value the manifest
  publishes and labels it `manifest, unverified`. It never invents a number.
- It **cannot be decremented** through the public API. A contribution is
  monotonic; the portal says so rather than implying a retractable vote.

### 6.2 Provisioning counters after publishing a package

The service answers `404` for a counter nobody has incremented yet. The portal
reads that correctly as a measured zero, but browsers log every 404 response as a
console error, which makes a healthy page look broken. Provisioning creates each
counter at 0 so reads answer `200`.

```bash
# Preview what would be created (no requests sent)
python scripts/init_counters.py --dry-run

# Provision every counter for the packages in index.json
python scripts/init_counters.py
```

The script is idempotent (`409 already present` is treated as success) and never
increments anything. Run it after merging a PR that adds a package.

> Creating a counter returns a one-time `admin_key`. The script deliberately does
> not store it: these are public counters, and no administrative operation
> (reset, set, delete) is part of the workflow. Discarding the key means a
> counter can never be silently rewritten — including by us.

### 6.3 Rate limits

The service allows **30 requests per 10 seconds per IP address**. The portal
issues two reads per visible package, caps itself at four concurrent requests,
and caches results for the session, so a normal page load stays well inside the
budget. On `429` it enters a 15-second cooldown, stops asking, and falls back to
published data.

Visitors behind a shared NAT can exhaust the budget collectively. That degrades
to the published-data fallback — it does not break the page and it never produces
a wrong number.

### 6.4 Configuration and opt-out

The endpoint, namespace and limits live in one place — `Sparks.CONFIG.counter` in
`src/core.js`. `scripts/init_counters.py` mirrors the namespace and the key
derivation; `tests/test_web_catalog.py` asserts the two agree, so drift fails the
build instead of silently 404-ing in production.

To remove the dependency entirely, set `enabled: false`. The portal then makes no
counter requests at all and renders published data with an explicit source label.

### 6.5 If the counter service disappears

Nothing in the registry becomes invalid. The portal's reads fail, the status pill
reports `unavailable`, and every figure falls back to the manifest value labelled
`manifest, unverified`. To migrate, point `Sparks.CONFIG.counter.endpoint` at a
replacement service that speaks the same `GET /get/<namespace>/<key>` →
`{"value": N}` and `GET /hit/<namespace>/<key>` contract, update the mirror in
`scripts/init_counters.py`, and re-provision.
