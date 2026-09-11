# crypto_core

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
