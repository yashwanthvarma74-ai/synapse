# Architecture decision records

Each record states the context, the decision, the evidence in this repository,
the consequences (including the costs), and the alternatives. They are meant to
answer "why not X?".

| # | Decision |
|---|---|
| [0001](0001-crdt-yjs-over-ot.md) | A CRDT (Yjs) instead of operational transformation |
| [0002](0002-two-consistency-domains.md) | Two consistency domains: content is eventually consistent, access is server-authoritative |
| [0003](0003-custom-ws-gateway.md) | A hand-written WebSocket gateway instead of Socket.IO or Hocuspocus |
| [0004](0004-update-log-and-snapshots.md) | Update log plus snapshots, compacted by merging stored data |
| [0006](0006-stateless-gateways-redis.md) | Stateless gateways with Redis pub/sub, and what breaks first at 10x |

Related: [benchmarks](../BENCHMARKS.md), [fault injection](../FAULT-INJECTION.md), [accessibility](../ACCESSIBILITY.md), [observability](../OBSERVABILITY.md), [project README](../../README.md).
