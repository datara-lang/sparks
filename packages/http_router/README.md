# http_router

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
