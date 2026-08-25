# Changelog

## 1.0.0 (2026-08-25)


### ⚠ BREAKING CHANGES

* `INTEGER` is withdrawn from `schema.type`; use `NUMBER`, with `pattern: '^-?[0-9]+$'` where whole numbers are required. `format` MUST now be null where `type` is not `STRING`. ADR 0005 §1's pre-publication window applies: no `v<N>` directory and no migration note, since no version has been tagged.
* a SERVICE declaring no endpoints, or an empty endpoints mapping, is now rejected. No new v<N> directory: no family has been published, git tag -l is empty and the release-please manifest reads 0.0.0, so §3's compatibility guarantee has no released version to run from. ADR 0005 §1 sets out that window and §4 records this decision. The window closes on the first tag.

### Additions

* **blueprint:** specify how an authored parameter binds to component inputs ([#36](https://github.com/musher-dev/spec/issues/36)) ([311be77](https://github.com/musher-dev/spec/commit/311be778852b0ecf0ae08af71b601dd005e91e14))
* **blueprint:** specify node compute — the size grammar, the Compute Profile catalog, and the advanced pins ([#35](https://github.com/musher-dev/spec/issues/35)) ([0a6e4b2](https://github.com/musher-dev/spec/commit/0a6e4b24101f191ba28c169c33307f5df967e998))
* bootstrap the canonical Musher specification repository ([e3b8ea5](https://github.com/musher-dev/spec/commit/e3b8ea5e574ef63d54ec75c7c8527301401f01e7))
* close the endpoint, environment-variable, and graph-rule specification gaps ([#31](https://github.com/musher-dev/spec/issues/31)) ([3b7110c](https://github.com/musher-dev/spec/commit/3b7110c606a1ad9b685c3e30e63f5812767a3882))
* fill the spec.md TODOs from implemented behaviour, and settle cycle detection ([#13](https://github.com/musher-dev/spec/issues/13)) ([be77e19](https://github.com/musher-dev/spec/commit/be77e192233e3c15ea524a7485f4af5228cfb332))
* reconcile the specification/platform divergences, and expose the edge address ([#41](https://github.com/musher-dev/spec/issues/41)) ([af2dec0](https://github.com/musher-dev/spec/commit/af2dec0cde046a3307fb7154c918bbf57c42c5f2))
* reconcile the value-shape vocabulary — STRING, NUMBER, BOOLEAN, JSON ([#57](https://github.com/musher-dev/spec/issues/57)) ([fbab4ba](https://github.com/musher-dev/spec/commit/fbab4bac0e856899e1fd540f21e4c8180d6a4485))
* **repo:** rebuild exact-version schemas from tags, and harden the specification for 1.0.0 ([#42](https://github.com/musher-dev/spec/issues/42)) ([e840e6d](https://github.com/musher-dev/spec/commit/e840e6dab459ffaa2cfcf977b04f79c7a02734e9))


### Corrections

* **blueprint:** stop §10 rejecting a cycle §4.2 permits ([#48](https://github.com/musher-dev/spec/issues/48)) ([234a173](https://github.com/musher-dev/spec/commit/234a1736146c28c8dfa0142bc67b3796f4663baf))
* **blueprint:** suppress ERR_UNBOUND_PARAMETER where a node's component is unreadable ([#40](https://github.com/musher-dev/spec/issues/40)) ([a40b3a9](https://github.com/musher-dev/spec/commit/a40b3a997d2b334b5fd0e371919b4499e818fea7))
* enforce the §2 unknown-property rule below the envelope ([#10](https://github.com/musher-dev/spec/issues/10)) ([cdc3cc4](https://github.com/musher-dev/spec/commit/cdc3cc42d08e0144beaa91145dd5645263218fc5))


### Specification prose

* **component:** specify the behaviour when a document uses a field from a newer schema release ([#26](https://github.com/musher-dev/spec/issues/26)) ([0ce4997](https://github.com/musher-dev/spec/commit/0ce4997f968549170adc7c288819d390421ed96f))
