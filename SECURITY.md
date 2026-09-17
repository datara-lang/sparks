# Security Policy: Sparks Package Registry

The Datara Core Team and Sparks registry maintainers take the security of the package ecosystem seriously.

---

## 1. Reporting a Vulnerability

If you discover a security vulnerability in the Sparks registry infrastructure, client verification logic, or any official core package (`sparks/*`), please do **not** disclose it publicly via GitHub issues.

### Confidential Reporting Channels:
- **Email:** `security@datara.dev`
- **GitHub Security Advisory:** Submit a private vulnerability report via [GitHub Security Advisories](https://github.com/datara-lang/sparks/security/advisories/new).

Please include:
1. A clear description of the vulnerability and its potential impact.
2. Reproducible steps, proof-of-concept code, or HTTP request traces.
3. Any affected package names and versions.

---

## 2. Response & SLA Commitments

- **Initial Acknowledgment:** Within **24 hours** of receipt.
- **Triage & Assessment:** Within **48 hours**.
- **Fix & Disclosure Plan:** Within **7 days** for critical severity, **14 days** for moderate severity.
- Coordinated public disclosure follows after a remediation patch is deployed.

---

## 3. Scope

### In Scope:
- Tampering with package tarballs, manifests, or `index.json`.
- Ed25519 signature bypass or cryptographic verification flaws.
- Capability sidecar declaration forgery or bypass.
- GitHub Actions CI validation workflows (`validate.yml`).
- Registry client package resolution and installation logic in `dpm`.

### Out of Scope:
- Bugs in third-party community packages that do not affect registry integrity.
- Denial-of-service against third-party hosting mirrors.
- Social engineering attacks targeting external repository contributors.

---

## 4. Key Compromise Protocol

If a publisher's private key is compromised:
1. Contact `security@datara.dev` immediately with proof of key ownership.
2. The maintainers will flag the compromised key as `revoked` in `index.json`'s `key_rotation` registry.
3. Any new releases signed by the revoked key will be blocked by CI validation.
