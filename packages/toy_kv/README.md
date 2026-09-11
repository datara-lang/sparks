# toy_kv

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
