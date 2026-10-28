# Knowledge feedback core

Node.js 22+, no npm dependencies. `node cli.mjs health` checks the pure core without creating a store, querying a library or calling a model. Run `node --test tests/core.test.mjs` for synthetic contracts.

`core.mjs` reduces immutable signals, issues, outcome links and control events; `host.mjs` scopes observations to a host/library/view lookup. A returned candidate is distinct from an actual read or use. Semantic increments require the current agent's assessment; no increment creates no ledger. Missing, disabled, expired or withdrawn bindings leave ordinary lookup available.

Persistence is optional. The host explicitly supplies an external private home, namespace, purpose, retention and confirmed analysis policy to `store.mjs`. Never place it inside managed packages, content corpora or Git metadata. File locks are local coordination, not encryption or an access-control service. There are no schedules, online pull jobs or author accounts in this package. The CLI accepts only health, finish, select, status, export, import and maintain with a packet path (or stdin) and optional --home; installation does not run them.
