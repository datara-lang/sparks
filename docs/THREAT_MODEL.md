# Sparks Registry Threat Model & Security Boundaries

This document defines the security boundaries, threat actors, protections, and limitations of the Sparks decentralized package registry.

---

## 1. System Overview & Trust Architecture

```
[Package Author]
       │  (Builds POSIX ustar tarball + signs with Ed25519)
       ▼
[Pull Request to GitHub]
       │
       ▼
[CI Validation Gate (validate.yml)]
       │  (Schema check, SHA-256 match, signature verify, capability parity, tar safety)
       ▼
[Merge to main branch]
       │
       ▼
[GitHub Pages CDN Deployment]
       │  (Immutable static JSON endpoints & tarballs)
       ▼
[DPM Client (Developer Machine)]
       │  (Downloads, checks SHA-256, verifies Ed25519, extracts into project)
       ▼
[Datara Compiler]
       └─ (Compile-time capability enforcement from capabilities.json)
```

---

## 2. What Cryptographic Signatures Protect

| Threat Vector | Mitigation in Sparks |
|---|---|
| **Man-in-the-Middle (MitM) Alteration** | Any modification of tarball bytes in transit or on CDN mirrors invalidates both the SHA-256 checksum and Ed25519 signature. |
| **Mirror / Cache Poisoning** | Secondary mirrors or offline caches cannot forge valid signatures without the author's private key. |
| **Capability Escalation** | Discrepancies between declared manifest capabilities and the embedded `capabilities.json` sidecar are rejected by both CI and `dpm`. |
| **Path Traversal Attacks** | Malicious archives containing `../` or absolute file targets are rejected at validation and extraction. |

---

## 3. What Cryptographic Signatures Do NOT Protect

> [!WARNING]
> Cryptographic signatures guarantee **integrity and author authenticity**, but they do **not** guarantee that code is free of bugs, backdoors, or malicious intent.

1. **Private Key Compromise:** If an author's private key is stolen, the attacker can produce validly signed archives. 
   - *Mitigation:* Rapid key revocation via `key_rotation` in `index.json` and mandatory reporting to `security@datara.dev`.
2. **Abuse within Declared Capabilities:** If a package legitimately declares `Capability<FileWrite>` and uses it maliciously, the signature certifies only that the recognized author created it.
   - *Mitigation:* Datara's explicit compile-time capability lattice alerts developers when unexpected privileges are demanded.
3. **Upstream Source Tampering:** If an author's GitHub account is hijacked, an attacker could submit pull requests.
   - *Mitigation:* PR validation requires Ed25519 signing by the trusted key on file, and maintainer reviews are enforced via `CODEOWNERS`.

---

## 4. Compromise Response Playbook

In the event of a reported key compromise:
1. **Revoke Key:** Maintainers immediately push a commit adding the compromised `public_key` to `key_rotation` with `status: "revoked"`.
2. **Halt Releases:** CI validator rejects any incoming PR signed by the revoked key.
3. **Issue Advisory:** A GitHub Security Advisory is published alerting consumers to audit or pin their dependencies.
