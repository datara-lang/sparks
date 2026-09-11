# Sparks Key Management & Cryptographic Hygiene

This document defines the cryptographic standards, key lifecycle procedures, and signing guidelines for the Sparks Package Registry.

---

## 1. Important Security Notice: Seed Keys vs. Author Keys

> [!CAUTION]
> The seed keys used to bootstrap the 5 default Sparks packages (`crypto_core`, `math_simd`, `http_router`, `lockstep_engine`, `toy_kv`) are **demonstration and registry bootstrapping keys**. 
> 
> In **production**, every third-party library author **must generate and securely manage their own private Ed25519 keypair**. The registry never stores, manages, or asks for private keys.

---

## 2. Generating an Ed25519 Author Keypair

Sparks standardizes on raw 32-byte Ed25519 asymmetric keys (RFC 8032).

### Option A: Using Python (`cryptography`)

```python
import secrets
from cryptography.hazmat.primitives.asymmetric import ed25519

# Generate 32 bytes of cryptographically secure random entropy
private_bytes = secrets.token_bytes(32)
private_key = ed25519.Ed25519PrivateKey.from_private_bytes(private_bytes)

# Public key
public_key = private_key.public_key()
public_hex = public_key.public_bytes_raw().hex()

print(f"Private Seed (HEX, KEEP SECRET): {private_bytes.hex()}")
print(f"Public Key   (HEX, PUBLISHABLE): {public_hex}")
```

### Option B: Using DPM CLI

```bash
dpm keygen --out author.key
# Outputs author.key (private) and author.pub (public hex)
```

---

## 3. Signing Package Archives

Every package release in Sparks consists of:
1. A deterministic POSIX ustar `.tar` archive.
2. An exact SHA-256 hex digest of the archive bytes.
3. A 64-byte Ed25519 signature over the exact archive bytes, encoded as a 128-character lowercase hex string.

### Signing with Python:

```python
from cryptography.hazmat.primitives.asymmetric import ed25519

# Load 32-byte private key from secure environment variable
import os
seed_hex = os.environ["SPARKS_AUTHOR_KEY"]
priv_key = ed25519.Ed25519PrivateKey.from_private_bytes(bytes.fromhex(seed_hex))

with open("mypkg-1.0.0.tar", "rb") as f:
    tar_bytes = f.read()

sig_hex = priv_key.sign(tar_bytes).hex()
print("Signature:", sig_hex)
```

### Signing via `scripts/spark_publish.py`:

```bash
python scripts/spark_publish.py --pkg-dir ./my_library --key-env SPARKS_AUTHOR_KEY
```

---

## 4. Key Storage Best Practices

- **Never commit private keys**: Add `.env`, `*.key`, and `*.pem` to `.gitignore`.
- **Environment variables**: Supply private keys in CI/CD via encrypted repository secrets (e.g. `SPARKS_SECRET_KEY`).
- **File permissions**: On POSIX systems, restrict key files to `chmod 600`.

---

## 5. Key Rotation & Compromise Response

When an author's private key is rotated or suspected of compromise:

1. **Generate New Keypair**: Create a new Ed25519 keypair and assign an incremented `key_id` (e.g., `author-alice-2026-v2`).
2. **Register Key Rotation**: In the next pull request to `sparks`, include the rotation entry:
   ```json
   {
     "key_id": "author-alice-2026-v2",
     "public_key": "<new_64_hex_pubkey>",
     "status": "active",
     "valid_from": "2026-09-11T00:00:00Z"
   }
   ```
3. **Revocation Record**: If the previous key was compromised, declare it revoked in `key_rotation`:
   ```json
   {
     "key_id": "author-alice-2026-v1",
     "public_key": "<old_64_hex_pubkey>",
     "status": "revoked",
     "revoked_at": "2026-09-11T00:00:00Z",
     "reason": "Suspected local workstation exposure"
   }
   ```
4. **Registry Enforcement**: The CI validator (`scripts/validate_registry.py`) rejects any new package versions signed with a revoked key.
