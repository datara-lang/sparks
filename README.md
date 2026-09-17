# Sparks: The Capability-Native Package Registry for Datara

[![Sparks Protocol](https://img.shields.io/badge/Protocol-Schema%201-21262d.svg?style=flat-square&logo=git&logoColor=white)](schema.json)
[![Datara 1.0.0](https://img.shields.io/badge/Language-Datara%201.0.0-21262d.svg?style=flat-square)](https://github.com/waters1ze/datara)
[![Security](https://img.shields.io/badge/Security-ed25519%20Signed-21262d.svg?style=flat-square)](#cryptographic-security--ed25519-signatures)
[![License](https://img.shields.io/badge/License-MIT%20OR%20Apache--2.0-21262d.svg?style=flat-square)](LICENSE)
[![Distribution](https://img.shields.io/badge/Distribution-GitHub%20Pages%20CAS-21262d.svg?style=flat-square)](https://datara-lang.github.io/sparks/)

Sparks is the official decentralized package registry for the **Datara** programming language. Operating as a **zero-service, pure-data sparse registry**, Sparks delivers packages over immutable static HTTPS via **GitHub Pages** without relying on centralized databases or proprietary API servers.

---

## Highlights

- **Compile-Time Capability Sandboxing:** Packages declare required system privileges in `capabilities.json`. `dpm` audits permissions prior to compilation and the Datara compiler enforces them at compile time.
- **ed25519 Cryptographic Signatures:** Every package archive is digitally signed by its author. `dpm` verifies signatures and SHA-256 digests automatically on download.
- **Reproducible Determinism Receipts:** Each release documents the exact compiler version, target architecture, and byte-for-byte checksum of its artifacts.
- **O(1) Sparse Protocol:** Only the manifests for requested packages are downloaded—avoiding cloning multi-gigabyte index repositories.
- **GitHub Pages Native:** Hosted on global CDN infrastructure, immutable, and accessible worldwide with zero operational overhead.

---

## Official Packages

The registry currently indexes the following first-party releases. This table mirrors `index.json`; `dpm` treats every package identically regardless of origin.

| Package | Version | Capabilities | Description |
| :--- | :---: | :---: | :--- |
| **`sparks/crypto_core`** | `1.0.0` | `None (Pure Compute)` | Constant-time slice comparison, bitwise rotation, ChaCha quarter-round |
| **`sparks/math_simd`** | `1.0.0` | `None (Pure Compute)` | Hardware-accelerated `float4`/`int4` vectors, dot product, 4x4 transform matrices |
| **`sparks/http_router`** | `1.0.0` | `None (Pure Compute)` | Zero-allocation radix-style path dispatcher and HTTP method multiplexer |
| **`sparks/lockstep_engine`** | `1.0.0` | `None (Pure Compute)` | Deterministic tick simulation state container and input queue |
| **`sparks/toy_kv`** | `1.0.0` | `Capability<FileRead>`, `Capability<FileWrite>` | Capability-governed append-only persistent storage engine |
| **`sparks/forgen_ai`** | `1.4.0` | `None (Pure Compute)` | Official AI developer companion and epistemic engine for Datara |

> [!IMPORTANT]
> **Cryptographic Notice:** The official packages above are signed with the Datara Core key (`datara-core-2026-v2`). **Bootstrapping keys are for demonstration and first-party releases.** In production, every package author must generate and safeguard their own private Ed25519 signing key locally. The registry never asks for or stores private keys. See [docs/KEY_MANAGEMENT.md](docs/KEY_MANAGEMENT.md) for instructions on key generation, signing, and rotation.

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

By default, `dpm` queries the official Sparks GitHub Pages endpoint: `https://datara-lang.github.io/sparks`.

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
default = "https://datara-lang.github.io/sparks"
# Alternative corporate mirror:
# default = "https://sparks.internal.corp"
```

### 3. Air-Gapped & Offline `file://` Mode
Because Sparks is completely static, a cloned git repository is a 100% complete, functional, air-gapped registry:
```bash
# 1. Clone or copy registry to offline machine
git clone https://github.com/datara-lang/sparks.git /var/sparks

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

`dpm` resolves a package by fetching `packages/<name>.json` (or
`packages/<name>/<version>.json` when a version is pinned), resolving `tarball_url`
against the registry root, then verifying `sha256` and the ed25519 signature before
extraction. `index.json` is not on that path - it exists to drive the web catalog.

See [docs/REGISTRY_LAYOUT.md](docs/REGISTRY_LAYOUT.md) for the full layout, how it
compares to npm / crates.io / PyPI / the Go module proxy / Maven Central, and the one
known non-conforming artifact (`sparks/forgen_ai@1.4.0` ships no `capabilities.json`
sidecar and is grandfathered because published versions are immutable).

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
   Use the built-in generator on the [Sparks Web Portal](https://datara-lang.github.io/sparks/) or create `packages/mypkg/1.0.0.json`:
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
   Submit a PR adding your manifest and tarball to the `datara-lang/sparks` repository. Once merged, GitHub Pages serves it immediately to all Datara developers worldwide.

---

## Web Portal & Registry Explorer

The live registry portal is accessible at:  
**https://datara-lang.github.io/sparks/**

Features:
- Real-time client-side package search (keyboard shortcut: `/`)
- Capability sandbox transparency audit
- One-click copy commands with instant toast feedback
- Interactive Schema 1 manifest generator and validator
- Favourites: local, per-browser bookmarks with a dedicated filter
- Live community counter for downloads and appreciations

### Where the numbers come from

The portal never invents a figure. Every count it shows is labelled with its source:

| Label | Meaning |
|-------|---------|
| `public counter` | Measured by the shared community counter. Every visitor sees the same value; a `.tar` click or a first-time favourite adds one. |
| `manifest, unverified` | The value the publisher wrote into the manifest. It is not independently measured, and it renders dashed and amber. |
| `no data` | Neither the manifest nor the counter reports anything yet. |

A claimed figure is never added to a measured one. The status pill under the hero
reports whether the counter is `live`, `connecting`, `throttled`, `unavailable`
or `disabled`, so a published number is never mistaken for a measured one.

The counter is a third-party service and is deliberately optional — with
`Sparks.CONFIG.counter.enabled = false` the portal makes no network calls and
falls back to published data only.

### Front-end layout

The portal is buildless: no bundler, no `npm install`, no transpile step. It is
also expected to work when `index.html` is opened directly from disk, which is
why the modules are classic scripts rather than ES modules (a `type="module"`
fetch is CORS-blocked on a `file://` origin). Each file attaches exactly one
surface to the shared `Sparks` namespace and the load order in `index.html` is
significant:

| File | Responsibility |
|------|----------------|
| `src/core.js` | Namespace, configuration, inline SVG icon builders |
| `src/util.js` | Storage, escaping, formatting, clipboard, toasts |
| `src/markdown.js` | Safe Markdown renderer |
| `src/store.js` | Observable application state |
| `src/registry.js` | `index.json` and per-version manifest transport |
| `src/counters.js` | Public community counter and local counters |
| `src/catalog.js` | The package grid |
| `src/modal.js` | The package detail modal |
| `src/generator.js` | The Schema 1 manifest generator |
| `src/actions.js` | Delegated `data-action` event wiring |
| `app.js` | Bootstrap only |

`index.html` contains no inline event handler attributes: every control is bound
through the single delegated registry in `src/actions.js`, so the markup cannot
reference a handler the JavaScript does not define.

To provision the community counters for the packages in `index.json` (run after
merging a new package):

```bash
python scripts/init_counters.py
```

---

## License

Sparks is distributed under the terms of both the **MIT** license and the **Apache License (Version 2.0)**.

- [MIT License](LICENSE-MIT)
- [Apache License, Version 2.0](LICENSE-APACHE)

&copy; 2026 Datara Foundation. Released under the MIT OR Apache-2.0 License.
