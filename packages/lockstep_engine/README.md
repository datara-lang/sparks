# lockstep_engine

Deterministic frame quantization and state synchronization engine for multiplayer games and robotic simulations in Datara.

## Key Properties
- **Bit-Identical Simulation**: Guarantees identical state progression across machines on identical input sequences.
- **Rollback Ready**: State hash tracking per tick for fast desynchronization detection and recovery.
- **Pure Sandbox Safe**: Requires 0 capabilities.
