# Sparks Capability-Native Security Specification

## 1. Overview
Every package published to the Sparks decentralized registry must declare explicit runtime capability sidecars (`.capabilities.json`).

## 2. Capability Primitives
- `network:inbound`: Bind and accept inbound socket connections
- `network:outbound`: Outbound network egress (CIDR restricted)
- `filesystem:read`: Lexically scoped read-only path access
- `filesystem:write`: Lexically scoped mutable path access
- `ffi:native`: Invocation of external dynamic C libraries
- `process:spawn`: Creation of child operating system processes

## 3. Cryptographic Verification
Manifests are hashed via BLAKE3 and signed with Ed25519 public keys.
