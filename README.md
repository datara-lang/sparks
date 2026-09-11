# Sparks: The Capability-Native Package Registry for Datara

[![Sparks Protocol](https://img.shields.io/badge/Protocol-Schema%201-21262d.svg?style=flat-square&logo=git&logoColor=white)](schema.json)
[![Datara 1.0.0](https://img.shields.io/badge/Language-Datara%201.0.0-21262d.svg?style=flat-square)](https://github.com/waters1ze/datara)
[![Security](https://img.shields.io/badge/Security-ed25519%20Signed-21262d.svg?style=flat-square)](#cryptographic-security--ed25519-signatures)
[![License](https://img.shields.io/badge/License-MIT%20OR%20Apache--2.0-21262d.svg?style=flat-square)](LICENSE)
[![Distribution](https://img.shields.io/badge/Distribution-GitHub%20Pages%20CAS-21262d.svg?style=flat-square)](https://waters1ze.github.io/sparks/)

Sparks is the official decentralized package registry for the **Datara** programming language. Operating as a **zero-service, pure-data sparse registry**, Sparks delivers packages over immutable static HTTPS via **GitHub Pages** without relying on centralized databases or proprietary API servers.

---

## Highlights

- **Compile-Time Capability Sandboxing:** Packages declare required system privileges in `capabilities.json`. `dpm` audits permissions prior to compilation and the Datara compiler enforces them at compile time.
- **ed25519 Cryptographic Signatures:** Every package archive is digitally signed by its author. `dpm` verifies signatures and SHA-256 digests automatically on download.
- **Reproducible Determinism Receipts:** Each release documents the exact compiler version, target architecture, and byte-for-byte checksum of its artifacts.
- **O(1) Sparse Protocol:** Only the manifests for requested packages are downloaded—avoiding cloning multi-gigabyte index repositories.
- **GitHub Pages Native:** Hosted on global CDN infrastructure, immutable, and accessible worldwide with zero operational overhead.

---

## Official Seed Packages

| Package | Version | Capabilities | Description |
| :--- | :---: | :---: | :--- |
| **`sparks/crypto_core`** | `1.0.0` | `None (Pure Compute)` | Constant-time slice comparison, bitwise rotation, ChaCha quarter-round |
| **`sparks/math_simd`** | `1.0.0` | `None (Pure Compute)` | Hardware-accelerated `float4`/`int4` vectors, dot product, 4x4 transform matrices |
| **`sparks/http_router`** | `1.0.0` | `None (Pure Compute)` | Zero-allocation radix-style path dispatcher and HTTP method multiplexer |
| **`sparks/lockstep_engine`** | `1.0.0` | `None (Pure Compute)` | Deterministic tick simulation state container and input queue |
| **`sparks/toy_kv`** | `1.0.0` | `Capability<FileRead>`, `Capability<FileWrite>` | Capability-governed append-only persistent storage engine |

> [!IMPORTANT]
> **Cryptographic Notice:** The official seed packages are signed with the Datara Core bootstrapping key. **Seed keys are for demonstration and bootstrapping.** In production, every package author must generate and safeguard their own private Ed25519 signing key locally. The registry never asks for or stores private keys. See [docs/KEY_MANAGEMENT.md](docs/KEY_MANAGEMENT.md) for instructions on key generation, signing, and rotation.

---

## Quickstart with DPM

### 1. Add a Package to Your Datara Project
```bash
dpm add sparks/crypto_core
```

### 2. Verify Package Integrity & ed25519 Signatures
```bash
dpm verify sparks/crypto_core
```

### 3. Use in Code (`src/main.dtr`)
```datara
use sparks/crypto_core

fn main() {
    let a: [Byte] = [0xAA, 0xBB]
    let b: [Byte] = [0xAA, 0xBB]
    let is_eq = crypto_core.constant_time_eq(a, b)
    println(is_eq)
}
```

---

## Registry Configuration, Mirrors & Offline Usage

By default, `dpm` queries the official Sparks GitHub Pages endpoint: `https://waters1ze.github.io/sparks`.

### 1. Environment Variable Override
Point `dpm` to any internal mirror, enterprise cache, or local mock server:
```bash
# Set custom HTTPS mirror or local server
export DATARA_SPARKS_REGISTRY="https://sparks-mirror.example.org"

# On Windows PowerShell:
$env:DATARA_SPARKS_REGISTRY = "http://127.0.0.1:18443"
```

### 2. Project-Level Configuration (`datara.toml`)
Configure custom package sources directly in your application manifest:
```toml
[project]
name = "my_service"
version = "1.0.0"

[registry]
default = "https://waters1ze.github.io/sparks"
# Alternative corporate mirror:
# default = "https://sparks.internal.corp"
```

### 3. Air-Gapped & Offline `file://` Mode
Because Sparks is completely static, a cloned git repository is a 100% complete, functional, air-gapped registry:
```bash
# 1. Clone or copy registry to offline machine
git clone https://github.com/waters1ze/sparks.git /var/sparks

# 2. Point dpm to local file URI
export DATARA_SPARKS_REGISTRY="file:///var/sparks"

# 3. dpm installs and cryptographically verifies packages completely offline
dpm add sparks/crypto_core
```

---

## Sparse Protocol Endpoints


Sparks serves structured JSON manifests following **Schema 1**:

```text
/index.json                     -> Root catalog snapshot & schema version
/schema.json                    -> Formal JSON Schema definition
/packages/<name>.json           -> Latest release manifest & version list
/packages/<name>/<version>.json -> Release manifest with sha256 & ed25519 signature
/tarballs/<name>-<version>.tar  -> POSIX ustar release archive
```

---

## How to Publish a Spark via GitHub PR

1. **Package your library:**
   ```bash
   tar -cf mypkg-1.0.0.tar main.dtr capabilities.json README.md
   ```

2. **Compute SHA-256 and Sign:**
   ```bash
   sha256sum mypkg-1.0.0.tar
   dpm sign mypkg-1.0.0.tar
   ```

3. **Generate Manifest:**
   Use the built-in generator on the [Sparks Web Portal](https://waters1ze.github.io/sparks/) or create `packages/mypkg/1.0.0.json`:
   ```json
   {
     "schema": 1,
     "name": "sparks/mypkg",
     "version": "1.0.0",
     "description": "My awesome Datara spark",
     "author": "Your Name <you@example.com>",
     "license": "MIT OR Apache-2.0",
     "tarball_url": "tarballs/mypkg-1.0.0.tar",
     "sha256": "5310cd3e1153db70f3cb8b48b41932ab73bfdfea11037b8086da1d496d57b818",
     "public_key": "1e5b98204a627f872e09e8fb32e511abdc714b0f1b720d809b5e43e1ea97925d",
     "signature": "...",
     "key_id": "author-2026",
     "size_bytes": 1359,
     "capabilities": [],
     "dependencies": {}
   }
   ```

4. **Submit a Pull Request:**
   Submit a PR adding your manifest and tarball to the `waters1ze/sparks` repository. Once merged, GitHub Pages serves it immediately to all Datara developers worldwide.

---

## Web Portal & Registry Explorer

The live registry portal is accessible at:  
**https://waters1ze.github.io/sparks/**

Features:
- Real-time client-side package search (keyboard shortcut: `/`)
- Capability sandbox transparency audit
- One-click copy commands with instant toast feedback
- Interactive Schema 1 manifest generator and validator

---

## License

Sparks is distributed under the terms of both the **MIT** license and the **Apache License (Version 2.0)**.

- [MIT License](LICENSE-MIT)
- [Apache License, Version 2.0](LICENSE-APACHE)

&copy; 2026 Datara Foundation. Released under the MIT OR Apache-2.0 License.
