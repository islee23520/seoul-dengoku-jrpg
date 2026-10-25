# S01 operational revision 2

This additive edition inherits all nine named groups from the hash-bound r1 scenario and its projection. It does not modify r1, wiki authority, communal issuer, actor placements, original custody or court membership. `operations.json` contains only the scoped approved candidate tables. `operations.schema.json` is a JSON Schema 2020-12 exact-edition `const`: changing any value or adding an execution boolean requires a new reviewed edition, not a permissive fallback.

The operational response and candidate SHA-256 are recorded in the pack. The approved appendix remains an external approval attachment and is not copied into the client data. Use `--appendix FILE` to verify its actual bytes against the approved hash. The CLI pins the descriptor and schema editions, verifies the source/content hashes, and checks actor/site/grant/topology cross-links before computing the baseline. A schema modified together with the data is not self-authorizing.

```
node scripts/tools/campaign-operation-pack.mjs --scenario game/data/scenarios/townhall-s01-r2 --manifest game/data/campaign/source-manifest.json --validate-data
node scripts/tools/campaign-operation-pack.mjs --scenario game/data/scenarios/townhall-s01-r2 --manifest game/data/campaign/source-manifest.json --check
```

Data validation and admission `--check` exit 0 only with the authenticated embedded start receipt, its SHA-256 and its matching appendix binding. `--start-scope S01-L,S01-O` requests only the named investigation at the K002 holding townhall: K568 ledger custody/comparison/return and K616 physical observation/received partial report. Any other scope rejects. Receipt removal, hash mismatch, scope expansion or an execution boolean cannot authorize start. No command starts a host or writes an output pack. Invalid input exits 1, with stderr diagnostics and empty stdout. `--help` exits 0; missing or unknown arguments fail.

The calculated sequential baseline is a data consistency proof, not a runtime execution claim. General combat, prices, growth, calibrated measurements and post-support activity stay closed. At 5400 world seconds support expires without stopping the world clock, creating supplies, changing custody, inventing rescue or erasing return obligations. Deployment/release is excluded from the start authorization and requires a separate final owner okay.
