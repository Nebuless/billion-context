# Architecture research handoff

## Next phase

Continue the [architecture review](architecture-review-2026-11-26.md), starting with the preflight one-shot lifecycle. Revalidate transitions, fork inheritance, persistence and request-level tests in both compression modes against the current tree. Independently investigate the decision-text discrepancies recorded in the review; ask the owner to clarify the intended contract before changing behavior or documentation. Select a candidate with the owner before designing interfaces or implementing changes.

The review was read-only; tests were inspected but not run. The separate OMO synthesizer could not launch its own independent subagent because its delegation tools were inactive.
