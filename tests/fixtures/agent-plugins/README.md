# Agent Plugins schema fixtures

`1.0.0/plugin.schema.json` is the official Agent Plugins 1.0.0 manifest schema, copied unchanged from
[agentplugins/agent-plugins-spec](https://github.com/agentplugins/agent-plugins-spec/blob/v1.0.0/schemas/1.0.0/plugin.schema.json)
at tag `v1.0.0` (commit `642e7016613212f459cd7e03b68cd3eb7c1ae1b4`). It is licensed under the
Apache License 2.0 by the Agent Plugins project.

It is vendored so `tests/agent-plugins.test.ts` validates generated bundles without network access.
The spec forbids clients from fetching schemas at load time, and a test shouldn't either.
