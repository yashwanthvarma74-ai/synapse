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
| [0005](0005-mongodb-storage.md) | MongoDB for storage and search (and what would tip it to Postgres) |
| [0006](0006-stateless-gateways-redis.md) | Stateless gateways with Redis pub/sub, and what breaks first at 10x |
| [0007](0007-authentication.md) | Authentication, and its known weaknesses |
| [0008](0008-canvas-model-and-rendering.md) | The canvas as one Yjs map, drawn by PixiJS |
| [0009](0009-comment-anchors.md) | Comments anchored with Yjs relative positions |
| [0010](0010-failure-handling.md) | Failure handling and self-healing (from the fault-injection results) |
| [0011](0011-observability.md) | Metrics with OpenTelemetry, Prometheus and Grafana (and what they cannot see) |
| [0012](0012-guest-accounts-and-invite-links.md) | Guest accounts and invite links, and their risks |
| [0013](0013-atlas-search.md) | Atlas Search for workspace search |
| [0014](0014-uploads-with-presigned-urls.md) | Uploads straight to S3/R2 with pre-signed URLs |
| [0015](0015-client-state-query-and-zustand.md) | TanStack Query for server data, Zustand for UI-only state |
| [0016](0016-ai-summary.md) | The AI summary action and its guard rails |

Related: [benchmarks](../BENCHMARKS.md), [fault injection](../FAULT-INJECTION.md), [accessibility](../ACCESSIBILITY.md), [observability](../OBSERVABILITY.md), [project README](../../README.md).
