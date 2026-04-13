# Rule Collections — Future Plans

Tracking open questions and planned improvements for rule collections (see [#47](https://github.com/prototypdigital/bluetemberg/issues/47)).

## Open questions

### Separate repository for collections

Currently, rule collection packages live in the Bluetemberg monorepo under `packages/`. As the number of consumers grows or when open-sourcing, evaluate whether collections should move to a dedicated repository. A separate repo makes sense when:

- External contributors want to submit rules without touching the core tooling.
- Collections need independent CI/CD pipelines.
- The package count grows beyond what's manageable in a single repo.

**Decision**: Stay in-repo for now. Revisit at 4–5 consumers or before open-sourcing.

### When to publish to npm

The collections are currently unpublished. They become worth publishing when:

- More than 2 consumer projects need them (currently only 2 company repos).
- The project moves to public npm.
- External users want to consume official rules.

**Decision**: Revisit at 4–5 consumers or before open-sourcing.

### Agent and skill collections

The same collection pattern (domain-scoped packages with `bluetemberg-pack` keyword) should extend to agents and skills:

- `bluetemberg-agents-review` — code review, docs maintenance agents
- `bluetemberg-agents-testing` — test specialist agents
- `bluetemberg-skills-docs` — docs upkeep, code review skills
- `bluetemberg-skills-security` — security audit, dependency scanning skills

**Decision**: Start with rules only. Replicate the pattern once rules are validated.

### Version coupling

Should rule collections follow Bluetemberg's version or version independently?

**Decision**: Independent versioning — a typo fix in `rules-git` shouldn't bump `rules-typescript`. All start at `0.1.0` and drift naturally. Add a release script to the monorepo to simplify per-package publishing.

### Init backwards compatibility

Should `bluetemberg init` always support copying templates for users who don't want registry dependencies?

**Current state**: The init wizard offers a choice between "Rule collections (registry packages)" and "Individual templates (copied locally)". Both paths are supported.

**Future consideration**: Once collections are published and stable, consider making collections the only default and deprecating the template-copy path.

## References

- [Issue #47](https://github.com/prototypdigital/bluetemberg/issues/47) — original proposal
- [ESLint Shareable Configs](https://eslint.org/docs/latest/extend/shareable-configs)
- [Renovate Config Presets](https://docs.renovatebot.com/config-presets/)
