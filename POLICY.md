# Sparks Registry Governance & Package Policy

This document defines the official policies governing package publishing, naming conventions, immutability, and moderation in the Sparks registry.

---

## 1. Package Naming Policy

Every package in Sparks is identified by a canonical identifier matching the pattern:
```regex
^sparks/[a-zA-Z0-9_-]+$
```

### 1.1 Reserved Names & Prefixes
The following name namespaces are strictly reserved for official Datara projects:
- `sparks/datara-*` (e.g., `sparks/datara-std`, `sparks/datara-runtime`)
- `sparks/core-*` (e.g., `sparks/core-alloc`)
- Any top-level package that attempts to impersonate official compiler tools, mascottes, or core team members.

### 1.2 Anti-Impersonation & Typosquatting
- Package names must not mimic existing established packages with deceptive variations (e.g. `crypto-core`, `crypt0_core` vs `crypto_core`).
- Maintainers reserve the right to rename or reject packages intended to mislead users.

---

## 2. Package Immutability

Sparks operates as an append-only, content-addressed registry:

1. **Versions Are Permanent:** Once a specific version (e.g. `sparks/math_simd` `1.0.0`) is merged to `main`, its manifest and tarball are **permanently immutable**.
2. **No Overwrites:** Submitting a pull request that alters the checksum, code, or metadata of an existing version will fail CI validation and be rejected.
3. **Bug Fixes:** Any fix, patch, or change requires a new SemVer release (e.g. `1.0.1` or `1.1.0`).

---

## 3. Takedown & Deprecation Policy

### 3.1 Deprecation
Authors may mark an old package or version as deprecated by submitting a PR updating the description or adding a deprecation notice. The files remain downloadable to preserve build reproducibility.

### 3.2 Security Takedown Criteria
A package version will be removed or replaced with an advisory tombstone **only** under the following critical circumstances:
1. **Malware / Backdoors:** Verified malicious payload, unauthorized data exfiltration, or undeclared privilege escalation.
2. **Severe Legal Violations:** Unambiguous copyright infringement, DMCA takedown notice, or trademark violation.
3. **Private Key Leakage:** Author key compromise where malicious releases were published.

When a package is tombstoned, its entry will be archived with a public security advisory explaining the removal.

---

## 4. Capability Declaration Honesty

Every package requesting system access (such as `Capability<FileRead>`, `Capability<NetworkConnect>`) must explicitly declare it in `capabilities.json` matching its manifest. 

Any package attempting to circumvent compiler capability sandbox guarantees will be immediately delisted.
