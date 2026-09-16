# FixCaptain: market findings and product flow

Research date: 16 September 2026. Vendor descriptions below are their published claims, not independent benchmarks.

| Product | Pattern worth adopting | FixCaptain decision |
| --- | --- | --- |
| [Resolve AI](https://docs.resolve.ai/integrations) | Investigation connects telemetry and environment context across tools. | Keep incident sources separate from investigation/repair connections; match environment names. |
| [Rootly AI SRE](https://rootly.com/ai-sre) | Evidence, uncertainty, similar incidents, and human review are visible. | Put evidence, recommendations, chat, approvals and action results on the incident journey. |
| [incident.io Investigations](https://incident.io/investigations) | Context follows the incident; findings include sources and next steps. | Persist incident-bound conversations and structured recommended resolution steps. |
| [PagerDuty SRE Agent](https://www.pagerduty.com/fr/platform/ai-agents/sre/) | Approved automation and confirmation of recovery complete the response loop. | Require a deterministic recovery check before resolution; sync source status separately. |

The recommended positioning is **an AI incident-resolution workspace for teams that already have an ITSM and observability stack**. A complete on-call replacement would require substantially more functionality. Do not advertise universal autonomous repair, vendor parity, compliance certification, or measured MTTR improvements without evidence.

## Customer journey

1. Create a workspace and invite the response team. Credentials, sources, conversations, policies and incident data stay scoped to that workspace.
2. Store the vendor credential in the encrypted vault. Connect Jira Cloud, Azure Monitor or ServiceNow, set the environment, and enable collection. Collection runs every five minutes, one page of up to 100 items per source per run. Larger backlogs take multiple cycles. Datadog and other platforms use authenticated webhooks.
3. Connect an HTTPS MCP server with a vault credential. Discover tools, inspect their schemas, and approve individual tools for read or write access. Tool definition changes require another review. Static bearer-token MCP connections are supported; OAuth-only and private-network servers need additional integration work.
4. Each new incident starts an investigation. The agent uses enabled read tools, records evidence, proposes a root cause with uncertainty, and saves ordered resolution steps including risks and recovery checks. With insufficient evidence it should state the missing access or next diagnostic action.
5. Open the incident assistant for questions and a repair proposal. Conversations retain incident context. Suggested steps are advisory; the execution record shows what actually happened.
6. Workspace mode and capability policy decide whether a repair is blocked, requires an authorized human approval, or can run autonomously. The default stays observation-only. Chat cannot grant approval.
7. Pair a mutating MCP tool with an enabled read-only recovery tool. Map the repaired resource's input into the check and configure the exact expected structured health value. A successful tool call alone is insufficient. Failed or unavailable checks escalate; the repair is not blindly repeated.
8. After verification passes, FixCaptain records resolution and drafts a postmortem. If an administrator enabled source closure, it transitions Jira to the configured Done state, resolves ServiceNow with the configured close code, or closes Azure's alert after Azure also reports the condition as recovered. Source errors remain visible and retry independently of the repair.

## Source setup

| Source | Collection | Credential | Source closure |
| --- | --- | --- | --- |
| Jira Cloud | Enhanced JQL search, cursor pagination; existing webhook support | BASIC_AUTH: account email and API token; hosted `*.atlassian.net` URL | Explicit transition ID whose destination belongs to Done; final state reread |
| Azure Monitor | Alerts Management API, active alerts in the last 30 days, subscription-scoped pagination | SERVICE_PRINCIPAL: directory tenant ID, client ID, secret; subscription ID on source | Requires verified repair and `monitorCondition=Resolved`; state changed to Closed and reread |
| ServiceNow | Active incidents through Table API; existing webhook support | BASIC_AUTH with Table API access; hosted `*.service-now.com` URL | State 6 with tenant-configured close code and verification reference; final state reread |
| Datadog | Authenticated monitor webhooks | Vault credential for evidence tools | Not implemented by this source adapter |
| Other tools | Generic authenticated JSON webhook | Generated per-source webhook secret | Not implemented by the generic source adapter |

For Azure, grant the service principal read access at the subscription being collected (Monitoring Reader is a starting point). Source closure additionally needs `Microsoft.AlertsManagement/alerts/changestate/action`. Grant only the rights used by the tenant's chosen flow. A monitoring credential does not automatically grant infrastructure repair rights; MCP credentials are reviewed separately.

## Reliability and limits

- Incident identity includes tenant and source instance. Event hashes include both, preventing cross-customer deduplication.
- Queue delivery is at least once. Incident uniqueness and investigation claims handle duplicates. The event is marked processed only after downstream dispatch; persisted dispatch markers support scheduled reconciliation.
- Source collection uses a database lease, a persisted cursor, bounded HTTP timeouts, and blocked redirects. Jira/ServiceNow support hosted vendor domains in this release, not arbitrary internal URLs.
- Source write-back is opt-in and requires persisted successful verification. Source closure rereads state before and after changes, avoiding repeated confirmed transitions after retries.
- This is bounded single-action remediation with advisory multi-step plans. Durable multi-action runbooks, delayed recovery windows, rollback orchestration, private agents, OAuth onboarding, event correlation/reopened-incident lifecycle, SSO/SCIM, and production-scale load/chaos validation remain future work.
- Vendor HTTP contract tests are mocked; no customer Jira, Azure or ServiceNow account was available for live adapter acceptance. Each customer must test its connection, permissions, workflow transition and MCP recovery rule before enabling autonomous repair.

Technical references: [Jira enhanced search](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/), [Azure alert listing](https://learn.microsoft.com/en-us/rest/api/alerts-management/alerts/alerts/get-all?view=rest-alerts-management-alerts-2019-03-01), [Azure alert state change](https://learn.microsoft.com/en-us/rest/api/alerts-management/alerts/alerts/change-state?view=rest-alerts-management-alerts-2019-03-01).
