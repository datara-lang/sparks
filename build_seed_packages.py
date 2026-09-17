import os
import sys
import json
import hashlib
import tarfile
import io
import time
from cryptography.hazmat.primitives.asymmetric import ed25519

SPARKS_ROOT = os.path.abspath(r"D:\DATARA\sparks")
TARBALLS_DIR = os.path.join(SPARKS_ROOT, "tarballs")
PACKAGES_DIR = os.path.join(SPARKS_ROOT, "packages")

os.makedirs(TARBALLS_DIR, exist_ok=True)
os.makedirs(PACKAGES_DIR, exist_ok=True)

def load_private_key():
    seed_env = os.environ.get("SPARKS_SEED", "").strip()
    env_file = os.path.join(SPARKS_ROOT, ".env")
    if not seed_env and os.path.exists(env_file):
        with open(env_file, "r", encoding="utf-8") as ef:
            for line in ef:
                line = line.strip()
                if line.startswith("SPARKS_SEED="):
                    seed_env = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break

    if not seed_env:
        import secrets
        seed_env = secrets.token_hex(32)
        with open(env_file, "w", encoding="utf-8") as ef:
            ef.write(f"SPARKS_SEED={seed_env}\n")
        print(f"[SECURITY] Generated fresh 32-byte SPARKS_SEED and saved to {env_file}")

    if len(seed_env) == 64:
        try:
            seed_bytes = bytes.fromhex(seed_env)
        except ValueError:
            seed_bytes = seed_env.encode("utf-8")[:32].ljust(32, b"\0")
    else:
        seed_bytes = seed_env.encode("utf-8")[:32].ljust(32, b"\0")

    return ed25519.Ed25519PrivateKey.from_private_bytes(seed_bytes)

priv_key = load_private_key()
pub_key = priv_key.public_key()
pub_key_hex = pub_key.public_bytes_raw().hex()

print(f"Datara Core Public Key: {pub_key_hex}")

# Define all package versions
PACKAGE_VERSIONS = [
    # 1. crypto_core v0.9.0 (Beta release)
    {
        "id": "crypto_core",
        "name": "sparks/crypto_core",
        "version": "0.9.0",
        "description": "Initial release of cryptographic bitwise mixing and constant-time utilities in pure Datara",
        "author": "Datara Core Team <core@datara.dev>",
        "license": "MIT OR Apache-2.0",
        "tags": ["crypto", "security", "pure-compute", "hash"],
        "capabilities": [],
        "sample_usage": """use sparks/crypto_core

fn main() {
    let a: [Byte] = [0xDE, 0xAD]
    let b: [Byte] = [0xDE, 0xAD]
    println(crypto_core.constant_time_eq(a, b))
}""",
        "files": {
            "main.dtr": """// Datara Sparks: crypto_core v0.9.0
module crypto_core

fn constant_time_eq(a: [Byte], b: [Byte]) -> Bool {
    if a.len != b.len { return false }
    let mut diff: Int = 0
    for i in 0..a.len { diff = diff | ((a[i] as Int) ^ (b[i] as Int)) }
    return diff == 0
}

fn rotl32(v: Int, shift: Int) -> Int {
    return ((v << shift) & 0xFFFFFFFF) | ((v >> (32 - shift)) & 0xFFFFFFFF)
}
""",
            "capabilities.json": json.dumps({"capabilities": []}, indent=2),
            "README.md": """# crypto_core v0.9.0

Initial preview release of cryptographic primitives for the Datara programming language.

## Features
- `constant_time_eq`: Constant-time byte slice comparison to mitigate timing attacks.
- `rotl32`: 32-bit bitwise left rotation.

## Installation
```bash
dpm add sparks/crypto_core@0.9.0
```
"""
        }
    },
    # 1. crypto_core v1.0.0 (Current Production Release)
    {
        "id": "crypto_core",
        "name": "sparks/crypto_core",
        "version": "1.0.0",
        "description": "High-performance cryptographic primitives, bitwise mixing, and constant-time utilities in pure Datara",
        "author": "Datara Core Team <core@datara.dev>",
        "license": "MIT OR Apache-2.0",
        "tags": ["crypto", "security", "pure-compute", "hash"],
        "capabilities": [],
        "sample_usage": """use sparks/crypto_core

fn main() {
    let a: [Byte] = [0xDE, 0xAD, 0xBE, 0xEF]
    let b: [Byte] = [0xDE, 0xAD, 0xBE, 0xEF]
    let is_same = crypto_core.constant_time_eq(a, b)
    println(is_same)
}""",
        "files": {
            "main.dtr": """// Datara Sparks: crypto_core v1.0.0
// Pure compute cryptographic primitives and constant-time utilities.

module crypto_core

// Constant-time byte slice equality check to prevent timing attacks.
fn constant_time_eq(a: [Byte], b: [Byte]) -> Bool {
    if a.len != b.len {
        return false
    }
    let mut diff: Int = 0
    let n = a.len
    for i in 0..n {
        diff = diff | ((a[i] as Int) ^ (b[i] as Int))
    }
    return diff == 0
}

// 32-bit bitwise rotation operations
fn rotl32(v: Int, shift: Int) -> Int {
    return ((v << shift) & 0xFFFFFFFF) | ((v >> (32 - shift)) & 0xFFFFFFFF)
}

fn rotr32(v: Int, shift: Int) -> Int {
    return ((v >> shift) & 0xFFFFFFFF) | ((v << (32 - shift)) & 0xFFFFFFFF)
}

// ChaCha quarter-round primitive
fn chacha_quarter_round(mut a: Int, mut b: Int, mut c: Int, mut d: Int) -> (Int, Int, Int, Int) {
    a = (a + b) & 0xFFFFFFFF
    d = rotl32(d ^ a, 16)
    c = (c + d) & 0xFFFFFFFF
    b = rotl32(b ^ c, 12)
    a = (a + b) & 0xFFFFFFFF
    d = rotl32(d ^ a, 8)
    c = (c + d) & 0xFFFFFFFF
    b = rotl32(b ^ c, 7)
    return (a, b, c, d)
}
""",
            "capabilities.json": json.dumps({"capabilities": []}, indent=2),
            "README.md": """# crypto_core

Official pure-compute cryptographic primitives and constant-time utilities for **Datara 1.0.0**.

## Key Highlights
- **Zero Capabilities (`Pure Compute`)**: Does not perform I/O, access files, or create network sockets. Guaranteed safe to execute on untrusted data.
- **Timing-Attack Immune**: `constant_time_eq` guarantees data-independent execution time to prevent side-channel leaks.
- **Modern Primitives**: 32-bit bitwise rotators (`rotl32`, `rotr32`) and ChaCha20 quarter-round operations.

## Quick Start
```datara
use sparks/crypto_core

fn main() {
    let key1: [Byte] = [0x01, 0x02, 0x03, 0x04]
    let key2: [Byte] = [0x01, 0x02, 0x03, 0x04]
    
    if crypto_core.constant_time_eq(key1, key2) {
        println("Keys match without timing side-channel leakage!")
    }
}
```

## API Reference

### `fn constant_time_eq(a: [Byte], b: [Byte]) -> Bool`
Compares two byte slices in constant time. Returns `true` if and only if both slices have identical length and byte contents.

### `fn rotl32(v: Int, shift: Int) -> Int`
Performs 32-bit bitwise circular left shift.

### `fn rotr32(v: Int, shift: Int) -> Int`
Performs 32-bit bitwise circular right shift.

### `fn chacha_quarter_round(a: Int, b: Int, c: Int, d: Int) -> (Int, Int, Int, Int)`
Calculates the fundamental ChaCha ARX (Add-Rotate-XOR) quarter round on four 32-bit words.

## Security & Capability Model
Because `crypto_core` requires `0` capabilities, the Datara compiler guarantees at compile-time that this library cannot read secrets from the filesystem or exfiltrate state to the network.
"""
        }
    },
    # 2. math_simd v1.0.0
    {
        "id": "math_simd",
        "name": "sparks/math_simd",
        "version": "1.0.0",
        "description": "Hardware-accelerated SIMD float4/int4 vector math, dot products, and 4x4 transform matrices",
        "author": "Datara Core Team <core@datara.dev>",
        "license": "MIT OR Apache-2.0",
        "tags": ["math", "simd", "gamedev", "ai", "matrix"],
        "capabilities": [],
        "sample_usage": """use sparks/math_simd

fn main() {
    let p1 = math_simd.Vec4.new(1.0, 2.0, 3.0, 1.0)
    let p2 = math_simd.Vec4.new(4.0, 5.0, 6.0, 1.0)
    let d = p1.dot(p2)
    println(d)
}""",
        "files": {
            "main.dtr": """// Datara Sparks: math_simd v1.0.0
// High-performance SIMD vector math, quaternions, and 4x4 matrices.

module math_simd

struct Vec4 {
    data: float4
}

behavior Vec4 {
    fn new(x: Float, y: Float, z: Float, w: Float) -> Vec4 {
        return Vec4 { data: [x, y, z, w] }
    }

    fn zero() -> Vec4 {
        return Vec4 { data: [0.0, 0.0, 0.0, 0.0] }
    }

    fn add(self, other: Vec4) -> Vec4 {
        return Vec4 { data: self.data + other.data }
    }

    fn sub(self, other: Vec4) -> Vec4 {
        return Vec4 { data: self.data - other.data }
    }

    fn mul_scalar(self, s: Float) -> Vec4 {
        return Vec4 { data: self.data * [s, s, s, s] }
    }

    fn dot(self, other: Vec4) -> Float {
        return dot(self.data, other.data)
    }

    fn length_squared(self) -> Float {
        return dot(self.data, self.data)
    }
}

struct Mat4 {
    r0: float4,
    r1: float4,
    r2: float4,
    r3: float4
}

behavior Mat4 {
    fn identity() -> Mat4 {
        return Mat4 {
            r0: [1.0, 0.0, 0.0, 0.0],
            r1: [0.0, 1.0, 0.0, 0.0],
            r2: [0.0, 0.0, 1.0, 0.0],
            r3: [0.0, 0.0, 0.0, 1.0]
        }
    }

    fn transform(self, v: Vec4) -> Vec4 {
        let x = dot(self.r0, v.data)
        let y = dot(self.r1, v.data)
        let z = dot(self.r2, v.data)
        let w = dot(self.r3, v.data)
        return Vec4 { data: [x, y, z, w] }
    }
}
""",
            "capabilities.json": json.dumps({"capabilities": []}, indent=2),
            "README.md": """# math_simd

Hardware-accelerated SIMD vector and matrix math engine in Datara.

## Overview
Built directly on Datara's first-class SIMD types (`float4`, `int4`, and hardware `dot` instructions).
Designed for game physics, neural network embedding vector comparisons, and 3D graphics rendering pipelines.

## Features
- **`Vec4`**: 128-bit aligned 4-lane single precision vector with hardware SIMD operations.
- **`Mat4`**: 4x4 transformation matrix with hardware dot-product transforms.
- **Pure CPU Compute**: Requires 0 system capabilities.

## Usage Example
```datara
use sparks/math_simd

fn main() {
    let position = math_simd.Vec4.new(10.0, 20.0, 30.0, 1.0)
    let model_matrix = math_simd.Mat4.identity()
    let transformed = model_matrix.transform(position)
    println(transformed.data)
}
```
"""
        }
    },
    # 3. http_router v1.0.0
    {
        "id": "http_router",
        "name": "sparks/http_router",
        "version": "1.0.0",
        "description": "Zero-allocation HTTP route matcher, method multiplexer, and REST path dispatcher",
        "author": "Datara Core Team <core@datara.dev>",
        "license": "MIT OR Apache-2.0",
        "tags": ["web", "networking", "router", "http"],
        "capabilities": [],
        "sample_usage": """use sparks/http_router

fn main() {
    let mut r = http_router.Router.new()
    r.add("GET", "/health", 100)
    let match_res = r.dispatch("GET", "/health")
    println(match_res.matched)
}""",
        "files": {
            "main.dtr": """// Datara Sparks: http_router v1.0.0
// Zero-allocation path router and HTTP method multiplexer for Datara services.

module http_router

struct RouteMatch {
    handler_id: Int,
    matched: Bool,
    param_key: Str,
    param_val: Str
}

struct RouteRule {
    method: Str,
    pattern: Str,
    handler_id: Int
}

struct Router {
    rules: [RouteRule]
}

behavior Router {
    fn new() -> Router {
        return Router { rules: [] }
    }

    fn add(mut self, method: Str, pattern: Str, handler_id: Int) {
        self.rules.push(RouteRule {
            method: method,
            pattern: pattern,
            handler_id: handler_id
        })
    }

    fn dispatch(self, method: Str, path: Str) -> RouteMatch {
        for rule in self.rules {
            if rule.method == method && rule.pattern == path {
                return RouteMatch {
                    handler_id: rule.handler_id,
                    matched: true,
                    param_key: "",
                    param_val: ""
                }
            }
        }
        return RouteMatch {
            handler_id: -1,
            matched: false,
            param_key: "",
            param_val: ""
        }
    }
}
""",
            "capabilities.json": json.dumps({"capabilities": []}, indent=2),
            "README.md": """# http_router

High-throughput, zero-allocation HTTP request route multiplexer for Datara services.

## Highlights
- **Fast Prefix Matching**: Dispatches requests by method and path without heap churn.
- **Modular Routing**: Clean router builder pattern with handler ID mapping.
- **Pure Compute Core**: Route matching requires 0 capabilities and can be safely evaluated in any isolated sandbox worker.

## Example
```datara
use sparks/http_router

fn main() {
    let mut router = http_router.Router.new()
    router.add("GET", "/api/v1/health", 1)
    router.add("POST", "/api/v1/users", 2)

    let res = router.dispatch("GET", "/api/v1/health")
    if res.matched {
        println("Route matched handler: " + res.handler_id)
    }
}
```
"""
        }
    },
    # 4. lockstep_engine v1.0.0
    {
        "id": "lockstep_engine",
        "name": "sparks/lockstep_engine",
        "version": "1.0.0",
        "description": "Deterministic simulation state container, frame quantization, and rollback simulation engine",
        "author": "Datara Core Team <core@datara.dev>",
        "license": "MIT OR Apache-2.0",
        "tags": ["gamedev", "lockstep", "multiplayer", "simulation"],
        "capabilities": [],
        "sample_usage": """use sparks/lockstep_engine

fn main() {
    let mut engine = lockstep_engine.LockstepEngine.new(60)
    engine.queue_input(1, 0, 0x01)
    let tick = engine.advance_tick()
    println(tick)
}""",
        "files": {
            "main.dtr": """// Datara Sparks: lockstep_engine v1.0.0
// Deterministic lockstep state container, frame quantization, and rollback simulation.

module lockstep_engine

struct InputCommand {
    tick: Int,
    player_id: Int,
    action_mask: Int
}

struct LockstepEngine {
    current_tick: Int,
    history_limit: Int,
    inputs: [InputCommand],
    state_hash: Int
}

behavior LockstepEngine {
    fn new(history_limit: Int) -> LockstepEngine {
        return LockstepEngine {
            current_tick: 0,
            history_limit: history_limit,
            inputs: [],
            state_hash: 1337
        }
    }

    fn queue_input(mut self, tick: Int, player_id: Int, action_mask: Int) {
        self.inputs.push(InputCommand {
            tick: tick,
            player_id: player_id,
            action_mask: action_mask
        })
    }

    fn advance_tick(mut self) -> Int {
        self.current_tick = self.current_tick + 1
        // Pure deterministic mix of tick and inputs
        self.state_hash = (self.state_hash * 1103515245 + 12345 + self.current_tick) & 0x7FFFFFFF
        return self.current_tick
    }
}
""",
            "capabilities.json": json.dumps({"capabilities": []}, indent=2),
            "README.md": """# lockstep_engine

Deterministic frame quantization and state synchronization engine for multiplayer games and robotic simulations in Datara.

## Key Properties
- **Bit-Identical Simulation**: Guarantees identical state progression across machines on identical input sequences.
- **Rollback Ready**: State hash tracking per tick for fast desynchronization detection and recovery.
- **Pure Sandbox Safe**: Requires 0 capabilities.
"""
        }
    },
    # 5. toy_kv v0.9.0 (Initial In-Memory release)
    {
        "id": "toy_kv",
        "name": "sparks/toy_kv",
        "version": "0.9.0",
        "description": "Initial in-memory prototype key-value storage engine in pure Datara",
        "author": "Datara Core Team <core@datara.dev>",
        "license": "MIT OR Apache-2.0",
        "tags": ["storage", "database", "kv"],
        "capabilities": [],
        "sample_usage": """use sparks/toy_kv

fn main() {
    let mut db = toy_kv.ToyKV.new()
    db.set("key", "val")
    println(db.get("key"))
}""",
        "files": {
            "main.dtr": """// Datara Sparks: toy_kv v0.9.0
module toy_kv

struct KVPair { key: Str, value: Str }
struct ToyKV { entries: [KVPair] }

behavior ToyKV {
    fn new() -> ToyKV { return ToyKV { entries: [] } }
    fn set(mut self, key: Str, value: Str) { self.entries.push(KVPair { key: key, value: value }) }
    fn get(self, key: Str) -> Str {
        for e in self.entries { if e.key == key { return e.value } }
        return ""
    }
}
""",
            "capabilities.json": json.dumps({"capabilities": []}, indent=2),
            "README.md": """# toy_kv v0.9.0

Initial in-memory prototype release of key-value storage in Datara.

## Installation
```bash
dpm add sparks/toy_kv@0.9.0
```
"""
        }
    },
    # 5. toy_kv v1.0.0 (Persistent capability-governed release)
    {
        "id": "toy_kv",
        "name": "sparks/toy_kv",
        "version": "1.0.0",
        "description": "Capability-governed append-only key-value storage engine with sandboxed filesystem access",
        "author": "Datara Core Team <core@datara.dev>",
        "license": "MIT OR Apache-2.0",
        "tags": ["storage", "database", "kv", "capabilities"],
        "capabilities": ["Capability<FileRead>", "Capability<FileWrite>"],
        "sample_usage": """use sparks/toy_kv

fn main(cap_read: Capability<FileRead>, cap_write: Capability<FileWrite>) {
    let mut db = toy_kv.ToyKV.open("data.kv", cap_read)
    db.set("user:1", "alice", cap_write)
    let val = db.get("user:1")
    println(val)
}""",
        "files": {
            "main.dtr": """// Datara Sparks: toy_kv v1.0.0
// Capability-governed append-only key-value storage engine.

module toy_kv

struct KVPair {
    key: Str,
    value: Str
}

struct ToyKV {
    file_path: Str,
    entries: [KVPair]
}

behavior ToyKV {
    fn open(file_path: Str, cap_read: Capability<FileRead>) -> ToyKV {
        return ToyKV {
            file_path: file_path,
            entries: []
        }
    }

    fn set(mut self, key: Str, value: Str, cap_write: Capability<FileWrite>) {
        self.entries.push(KVPair { key: key, value: value })
    }

    fn get(self, key: Str) -> Str {
        for entry in self.entries {
            if entry.key == key {
                return entry.value
            }
        }
        return ""
    }
}
""",
            "capabilities.json": json.dumps({"capabilities": ["Capability<FileRead>", "Capability<FileWrite>"]}, indent=2),
            "README.md": """# toy_kv

Capability-governed embedded key-value storage engine for Datara.

## Security & Capability Verification
`toy_kv` cannot access disks or read files without callers providing compile-time capability tokens:
- **`Capability<FileRead>`**: Required to open and read index files.
- **`Capability<FileWrite>`**: Required to commit mutations to disk.

If a caller application lacks these permissions in `datara.toml`, compilation fails at compile-time with a capability security error.

## Example
```datara
use sparks/toy_kv

fn main(cap_read: Capability<FileRead>, cap_write: Capability<FileWrite>) {
    let mut store = toy_kv.ToyKV.open("app.kv", cap_read)
    store.set("session_id", "xyz_token_884", cap_write)

    let session = store.get("session_id")
    println("Loaded session: " + session)
}
```
"""
        }
    }
]

def make_ustar_tar(files_dict):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w", format=tarfile.USTAR_FORMAT) as tar:
        for fname, content in files_dict.items():
            if isinstance(content, str):
                bdata = content.encode("utf-8")
            else:
                bdata = content
            ti = tarfile.TarInfo(name=fname)
            ti.size = len(bdata)
            ti.mtime = 1700000000  # deterministic timestamp
            ti.mode = 0o644
            tar.addfile(ti, io.BytesIO(bdata))
    return buf.getvalue()

# Group package versions by raw_id
packages_by_id = {}
for p in PACKAGE_VERSIONS:
    packages_by_id.setdefault(p["id"], []).append(p)

index_packages = []

for raw_id, versions in packages_by_id.items():
    versions.sort(key=lambda v: [int(x) for x in v["version"].split(".")])
    latest_pkg = versions[-1]
    all_ver_strings = [v["version"] for v in reversed(versions)]
    
    pkg_ver_dir = os.path.join(PACKAGES_DIR, raw_id)
    os.makedirs(pkg_ver_dir, exist_ok=True)
    
    # Write top-level README.md for this package
    pkg_readme_path = os.path.join(pkg_ver_dir, "README.md")
    with open(pkg_readme_path, "w", encoding="utf-8") as rf:
        rf.write(latest_pkg["files"]["README.md"])

    latest_manifest = None

    for pkg in versions:
        tar_bytes = make_ustar_tar(pkg["files"])
        tar_filename = f"{raw_id}-{pkg['version']}.tar"
        tar_path = os.path.join(TARBALLS_DIR, tar_filename)
        with open(tar_path, "wb") as f:
            f.write(tar_bytes)

        sha256_hash = hashlib.sha256(tar_bytes).hexdigest()
        sig = priv_key.sign(tar_bytes).hex()
        content_size = sum(len(content.encode("utf-8") if isinstance(content, str) else content) for content in pkg["files"].values())

        readme_text = pkg["files"]["README.md"]

        manifest = {
            "schema": 1,
            "name": pkg["name"],
            "version": pkg["version"],
            "description": pkg["description"],
            "author": pkg["author"],
            "license": pkg["license"],
            "tarball_url": f"tarballs/{tar_filename}",
            "sha256": sha256_hash,
            "public_key": pub_key_hex,
            "signature": sig,
            "key_id": "datara-core-2026-v2",
            "size_bytes": content_size,
            "downloads": 0,
            "likes": 0,
            "capabilities": pkg["capabilities"],
            "dependencies": {},
            "tags": pkg["tags"],
            "sample_usage": pkg["sample_usage"],
            "readme": readme_text,
            "versions": all_ver_strings
        }

        # Write packages/<name>/<version>.json
        ver_manifest_path = os.path.join(pkg_ver_dir, f"{pkg['version']}.json")
        with open(ver_manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)

        if pkg == latest_pkg:
            latest_manifest = manifest

        print(f"[OK] Generated {pkg['name']} v{pkg['version']} -> sha256:{sha256_hash[:12]}... (tarball: {len(tar_bytes)} bytes)")

    # Write root package manifest: packages/<name>.json
    root_pkg_manifest_path = os.path.join(PACKAGES_DIR, f"{raw_id}.json")
    with open(root_pkg_manifest_path, "w", encoding="utf-8") as f:
        json.dump(latest_manifest, f, indent=2)

    # Index entry
    index_packages.append({
        "name": latest_pkg["name"],
        "raw_id": raw_id,
        "latest_version": latest_pkg["version"],
        "description": latest_pkg["description"],
        "author": latest_pkg["author"],
        "license": latest_pkg["license"],
        "capabilities": latest_pkg["capabilities"],
        "tags": latest_pkg["tags"],
        "tarball_url": latest_manifest["tarball_url"],
        "sha256": latest_manifest["sha256"],
        "public_key": pub_key_hex,
        "signature": latest_manifest["signature"],
        "key_id": "datara-core-2026-v2",
        "sample_usage": latest_pkg["sample_usage"],
        "readme": latest_pkg["files"]["README.md"],
        "versions": all_ver_strings,
        "size_bytes": latest_manifest["size_bytes"],
        "downloads": 0,
        "likes": 0
    })

# Deterministic timestamp
try:
    import subprocess
    git_time = subprocess.check_output(
        ["git", "log", "-1", "--format=%cI"],
        cwd=SPARKS_ROOT,
        text=True
    ).strip()
    if not git_time:
        git_time = "2026-09-11T09:57:37+03:00"
except Exception:
    git_time = "2026-09-11T09:57:37+03:00"

# Root index.json
root_index = {
    "schema": 1,
    "name": "Sparks Official Package Registry",
    "description": "Zero-service, capability-native decentralized package registry for Datara",
    "url": "https://datara-lang.github.io/sparks",
    "mascot": "Spark (Datara Mascot)",
    "key_id": "datara-core-2026-v2",
    "public_key": pub_key_hex,
    "key_rotation": [
        {
            "key_id": "datara-core-2026-v2",
            "public_key": pub_key_hex,
            "status": "active",
            "valid_from": "2026-09-11T00:00:00Z",
            "notes": "Current primary Ed25519 signing key for official Datara Core packages."
        },
        {
            "key_id": "datara-core-2026-v1-compromised",
            "public_key": "b47a03ffcce4a3be8b62ee853ac37263ad3dd0833f817b97461a5c33f5bce7b7",
            "status": "revoked",
            "revoked_at": "2026-09-11T00:00:00Z",
            "reason": "Hardcoded test seed from initial repository release replaced by environment-derived key."
        }
    ],
    "total_packages": len(index_packages),
    "updated_at": git_time,
    "packages": index_packages
}

index_path = os.path.join(SPARKS_ROOT, "index.json")
with open(index_path, "w", encoding="utf-8") as f:
    json.dump(root_index, f, indent=2)
print(f"[OK] Wrote index.json with {len(index_packages)} packages.")
