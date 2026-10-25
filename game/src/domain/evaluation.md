# Relation, opinion and stress evaluation

`applyRelationEvent` is the task-14 state transition boundary. It returns immutable
relations together with a dedicated relation EventLedger and receipt. The ledger
stores the cause, caller-supplied world time, actor, directional target, full
before/after snapshots and hashes, rule/content versions and ResultId. Replaying
the identical request returns its original receipt without applying it again;
reusing a ResultId with a changed request conflicts. The host persists the returned
relations and ledger together. The task-12 primitive functions remain available
for composition; they do not themselves provide exactly-once application.

`evaluateOpinion` classifies existing trust using sp1.b79 only: friend >=25,
enemy <=-25, rival <=-50 (the strongest enemy class). Relation facts are returned
as evidence, not added as opinion modifiers. Missing trust remains unknown even
when a service or family fact exists. `evaluateOpinions` aggregates existing
outgoing edges only. Reputation, regional legitimacy, obligations and collective
grievances are not trust inputs or additional affection axes. Task-33's direct
retainer and personal-liege facts imply neither unconditional obedience nor
authority. No delta formula is approved: numeric changes require an injected
TrustDeltaRules entry; absent entries fail with MissingRuleInput.

`evaluateStress` composes task-12 StressState/StressRules into the CK3-port-4
structure: steady, rising, falling and breaking. The caller supplies the
breaking threshold marker and penalty/recovery-scene identifiers for every
threshold. Only upward crossings emit consequences, with their marker keys and
the triggering cause/time; the host owns presentation and scheduling. This does
not add a second clock or automatic decay. Trait-violating actions may be passed
as explicit event keys, but trait-to-event mappings, deltas, thresholds, penalties
and recovery values still require approved injected rules. No CK3 numerical
values are imported. All numeric examples in the colocated tests are TESTINPUT.

Task 10 owns the existing event-option trait gate pipeline in `game/src/events`.
This layer supplies relation classifications and stress evaluation, not a second
trait gate engine or a change to that pipeline.
