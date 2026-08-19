# ADR 0010: Reconciling the specification against implemented *runtime* behaviour

- **Status:** Accepted
- **Date:** 2026-08-19
- **Extends:** [ADR 0005](0005-platform-divergence-reconciliation.md)
- **Relies on:** [ADR 0005](0005-platform-divergence-reconciliation.md) §1

## Context

[ADR 0005](0005-platform-divergence-reconciliation.md) tested four
specification/platform disagreements one at a time, and decided each on its
merits rather than by invoking
[ADR 0001](0001-canonical-repository-architecture.md) §1 and moving on. It read
the platform's **schemas**.

Reading the platform's **runtime** — the resolvers, the scheduler, the host
agent — turns up seven more. They are of a different kind, and that is the whole
reason this ADR exists rather than a batch of quiet fixes: a schema divergence
is two documents disagreeing about what validates, and every one of ADR 0005's
was visible in a diff. These are not. In each case the two repositories agree
about what a document *is* and differ about what it *does*, which no gate either
of them runs can see.

Two facts frame every decision below.

**The schemas are in lockstep.** Diffing all three published bundles against
`apps/api/docs/schemas/catalog-*.v1.json` gives zero structural divergence —
every difference is `description` wording — and the platform's
`EXPECTED_DIVERGENT` pins are empty for all three families. Nothing here is a
symptom of the two drifting apart. They agree, and the agreement was not enough.

**The window is open.** `git tag -l` is empty and the three `1.0.0` release pull
requests are still open, so [ADR 0005](0005-platform-divergence-reconciliation.md)
§1 applies to every decision that narrows validation. Each closes for good at the
first tag.

## Decision

### 1. Nothing schedules a `CRON` workload, and the dialect is pinned anyway

**Neither repository is defective. The contract is underspecified and the
capability is unbuilt.**

`schedule.cron` is `{"type": "string"}` with no `pattern`, and component §5 says
nothing about the dialect — not the field count, not whether `@daily` is
accepted, not whether day-of-month and day-of-week combine as *and* or as *or*.
The platform matches it exactly: no cron library appears in the lockfile, no
component reads `cron_expression`, and no trigger fires. A `CRON` component can
be authored, validated, and published, and it will never run.

The temptation is to say nothing until something implements it. That is
backwards. The field already exists and already accepts any string, so adding a
`pattern` later rejects documents that validate today — a new major. **The
choice is between specifying the dialect now, for free, and never specifying it
inside v1.**

So the contract pins it, along with `timeZone`,
`concurrencyPolicy` and `missedRunPolicy`, which a cron expression alone does
not determine and which every mature scheduled-workload system exposes.

The platform is filed to either implement it or reject `SCHEDULED_JOB` in the
`capability` phase. What it may not keep doing is accepting the workload and
silently never running it.

### 2. `command` has semantics nobody wrote down, so the contract stops needing them

**The specification is defective.**

`command` is one string, and neither the schema nor the prose says whether it is
shell-interpreted, split into argv, or handed to a runtime as `ENTRYPOINT`. The
host agent had to decide and did: it splits with Docker-Compose word-splitting —
POSIX quoting, no implicit `sh -c`, no variable or glob expansion — and appends
the result after the image reference, overriding the image's `CMD` and inheriting
its `ENTRYPOINT`.

That is a defensible choice and it is invisible. An author writing
`command: start.sh && migrate` gets `&&` as an argument.

**`command` becomes an argument vector, with `args` beside it.** This does not
specify the splitting grammar; it deletes the need for one. The author writes the
argv they mean, and a shell becomes something they ask for:

```yaml
command: [/bin/sh]
args: ['-c', 'migrate && start-server']
```

The `ENTRYPOINT` interaction is stated rather than left to the adapter, and
`musher-cli` already models the field as `[]string`, so one of the three
implementations is already there.

### 3. Two probe knobs are accepted and ignored

**The platform is defective. The rules stand.**

`startup` probes never reach the host agent — the runtime adapter projects
`readiness`, falling back to `liveness`, onto a single agent-facing field — and
`periodSeconds` is validated against a 1–300 bound and then dropped, because the
agent polls on a hardcoded one-second interval.

[ADR 0001](0001-canonical-repository-architecture.md) §1 decides this: the
implementation is behind, and staged probes with configurable timings are worth
having. The rules are unchanged and the gap is filed.

It is recorded here rather than merely fixed downstream because of what it costs
an author in the meantime. A knob that is validated and discarded is worse than
one that is absent: the author tunes a number, the contract accepts it, and
nothing happens. Until the agent reads it, that is a defect anyone can trip over
and nobody can see.

### 4. The contract compels a probe that cannot work

**The specification is defective.**

Component §5.4 *requires* `readiness` on a `SERVICE` exposing a `PUBLIC` `GRPC`
endpoint. Every probe is an HTTP path. The platform's domain model agrees —
`GRPC` counts as HTTP-family and is a legal probe target — and the agent then
issues a plain HTTP/1.1 `GET` expecting `200` against an HTTP/2,
protobuf-framed server.

So the one protocol where the contract leaves an author no choice is a protocol
the probe does not work against. Both repositories implement this consistently,
which is why no gate caught it.

**Probes become a union discriminated on `type`, and gain a `GRPC` branch**
speaking `grpc.health.v1.Health`. `HTTP` and `TCP` are free — the agent already
implements exactly those two check shapes. `GRPC` is new work, filed against the
platform.

Rejected: dropping `GRPC` from the HTTP family so readiness is never compelled
there. It removes the contradiction by removing the guarantee, and a public gRPC
service with no readiness gate routes traffic to a replica that is running and
not yet serving — the failure §5.4 exists to prevent.

### 5. A connection into a `USER` input disappears

**The specification is defective, and the behaviour is worse than the gap
implies.**

[Blueprint §4.2](../../specifications/blueprint/v1/spec.md#connections) records:
"Nothing stops a connection filling an input whose `suppliedBy` is `USER`. A
wire and the install form would then both claim the value, with nothing saying
which arrives."

What arrives is the install form. The wire is resolved into the binding map and
then never consulted, because materialisation selects inputs by their declared
`suppliedBy`. So the author's wire is not ambiguous — it is silently discarded,
and no diagnostic anywhere says so.

That is not a precedence rule the specification failed to write down. It is an
accident of iteration order, and it fails the test this contract applies
everywhere else: [§5.2](../../specifications/blueprint/v1/spec.md#merge) rejects
silent first-wins because it "settles the ambiguity without telling anyone there
was one".

**A connection naming an input the component does not fill from a connection is
rejected.** Phase 7's value-source union makes that structural rather than a
rule to remember.

### 6. Sensitivity does not cross a wire

**Both are defective, in opposite directions.**

[§4.2](../../specifications/blueprint/v1/spec.md#connections) says `isSensitive`
"takes no part in the decision" and calls it a gap. The implementation goes
further: masking is read **only** from the consuming input's own declaration, so
a producer that marked its output sensitive has that marking dropped the moment
the value crosses into an input that did not.

The direction that matters is therefore the reverse of the obvious one. A
consumer forgetting to mark an input is not merely under-protected — it
*declassifies* a value the producer classified, and does it at the point where
the document that knew is no longer being read.

**A wire carries the union of both ends' sensitivity.** A value is secret
material if either end says so. This is stated as a rule about handling rather
than as a compatibility check, so it rejects no composition: an author who marks
one end has protected the value, which is what marking is for.

### 7. The listing `license` bound disagrees with its own column

**The platform is defective, and this contract is not involved.**

`license` is `max_length=256` in the request model and `String(120)` in the
database, so a 121–256 character value validates and then fails or truncates at
write time. This repository's bound is 256, which is neither number's fault.

It is recorded here for one reason: this pass replaces `license` with an SPDX
`licenseExpression` and has to choose a length for it. Choosing
it while one implementation holds two different answers is how a third number
gets invented.

## Consequences

**Four parts of the pre-v1 pass now have a recorded reason.** The scheduling
block, the probe union and its bounds, the connection rules, and the `command`
vector each trace to a numbered section here rather than to a review comment.

**Three defects are the platform's and are filed as such.** The dropped probe
knobs, the discarded wire, and the declassifying wire are all things the platform
does that no test of theirs asserts. Filing them is not a courtesy — ADR 0001 §1
makes the implementation defective when the two disagree, and an unfiled defect
is a divergence nobody is carrying.

**A class of divergence is now known to be invisible.** Every gate either
repository runs compares documents: the corpus, the drift check, the parity
check, `EXPECTED_DIVERGENT`. All of them were green throughout, and all seven
findings here are about behaviour behind an agreed document. That is worth
stating plainly, because the honest conclusion is that this ADR was produced by
someone reading code, and nothing schedules that.

**ADR 0005's method is reaffirmed rather than extended.** Each divergence above
was decided on its merits, and ADR 0001 §1 decided who changes only after. Three
went against the platform, two against this specification, one against both, and
one against neither.
