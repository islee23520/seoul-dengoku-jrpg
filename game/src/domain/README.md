# SP-1.0.0 domain kernel

Run from the repository root with Node 24 or newer (erasable TypeScript syntax):

```sh
node --test --test-reporter=tap game/src/domain/*.test.ts
tsc -p game/tsconfig.json
```

The exact glob is intentional: it selects the colocated TypeScript tests. No package manager, framework, engine build or gate.sh integration is needed. Typechecking reuses the checkout's existing engine/node_modules/@types/node declarations; it does not compile or alter engine sources.

The thirteen modules contain immutable JSON-plain facts and pure transitions. The only platform import is node:crypto for canonical JSON SHA-256. Callers supply world time, schema/rule/content versions and Seoul scope. Undefined stress, trait effects, trust deltas and succession procedure/legitimacy inputs throw MissingRuleInput rather than supplying gameplay defaults. Ability ranges come from game-thesis b5/b6; trust classes from sp1.b79. Engineering integers (zero, revision increments, array cursors) are not gameplay parameters.

Authority facts are independent. A title, office, holding, key, custody record, service relation, camera exposure or skill grants no other right. Mandates carry task-33's mandatory fields, check SP b12 preflight order and cannot execute before receipt and consent. The host owns scheduling and recording returned transitions in EventLedger; domain functions do not advance clocks, mutate stores or silently create ledger records.

Succession preserves candidates, contracts and institutional assets; rights move per item only after injected procedure and ratification. Screen subject changes carry their own BodySuccession event and never copy personal traits, skill or relations. Competition, recruitment execution, scheduling, economy, persistence adapters and views belong to later tasks.

Fixtures are isolated in fixtures/opening.ts. Every constructed runtime fixture is TESTINPUT; nested CANON source pointers identify task-31 observations without asserting spawn, office, numerical-rule or publication approval. The kernel imports no fixtures.
