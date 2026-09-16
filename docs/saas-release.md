# Multi-tenant SaaS implementation — September 2026

Resolution is a centrally hosted application. Customer workspaces own users, incidents,
credentials, connections, policies and billing. Customers do not deploy the application.

## Implemented in this release

- Server-owned conversation history, scoped to both tenant and user. A database lease prevents
  concurrent chat turns from overwriting history. Client-supplied assistant/tool history is rejected.
- Chat cannot approve or reject actions. Authorized users must review the exact action in Approvals.
- Public HTTPS MCP connections with encrypted bearer credentials. Plaintext config headers,
  embedded URL credentials, queries, IP literals and local hostnames are rejected; redirects are blocked.
- MCP catalog pagination and bounded SSE/JSON responses with response-ID validation.
- Tool descriptions and parameters displayed before admin review. Read-only hints are untrusted;
  a matching administrator-reviewed SHA-256 tool definition is required for execution. Refreshing
  the catalog disables discovered tools until review; execution checks for definition changes again.
- Per-connection disable/enable controls, with fresh checks during investigation and remediation.
- Credential rotation and local revocation in the UI and API; revoked credentials cannot be tested
  back into validity. Rotation explicitly restores usability. Revocation does not revoke tokens at
  the upstream provider; administrators must revoke upstream credentials there when compromised.
- Execution checks current tenant policy, enabled capability, incident environment and credential
  availability. RECOMMEND cannot execute. Database claims prevent duplicate execution of an action
  and concurrent approval decisions. A stable remediation key prevents duplicate proposals per RCA.
- Missing verification escalates an incident; it never silently marks it resolved. Rejected fixes
  escalate rather than closing an unresolved incident.
- Known MCP credentials and common secret fields redacted from results; nested audit metadata
  redacted. Production refuses development secrets and accidental mock AI fallback.
- Production billing without Stripe returns unavailable, and production email does not log reset
  links as a delivery fallback. Worker Stripe bindings are forwarded correctly.
- Wallet writes use optimistic concurrency and reject overdrafts. Real token-consumption metering
  is still a separate milestone; this does not introduce usage charges.

## Deployment

Existing Cloudflare Workers, Pages and D1 resources are retained. Apply only the additive
`00000000000008_chat_conversations/migration.sql` migration; never recreate the production schema.
Existing JWT and encryption root keys must be preserved. Local `.env` is ignored by Git.

`scripts/cloudflare_check.py` prints deployment status and secret names, never values.
`scripts/cloudflare-run.py` loads the Cloudflare token into the child process environment.
Use `sync-email` to upload the already configured Resend key; sender address belongs in Worker vars.
The configured AI model was verified through the provider's model-list endpoint. The Resend key
returned 403 for listing domains, so domain verification and real email delivery remain unverified.
Stripe credentials are not present; checkout remains explicitly unavailable.

## Required follow-up before enterprise general availability

This release is not a completed enterprise certification or the entire product roadmap.

1. OAuth/PKCE MCP connection flows, managed refresh-token lifecycle and provider compatibility tests.
2. SAML/OIDC SSO, MFA, SCIM, expiring invitations, scoped service accounts and granular team/service roles.
3. Durable orchestration with restart reconciliation, approval expiry and long-running health windows.
   Current queue consumers do not automatically reconcile every interrupted external operation.
4. Actual AI metering, subscription entitlements, tenant budgets and globally enforced rate limits.
5. Private connector agent and network-level egress policy. URL validation is not DNS pinning and
   does not by itself eliminate DNS-rebinding risks; restrict outbound destinations for enterprise use.
6. Managed key storage/versioning and rewrapping, retention controls and tested disaster recovery.
7. Real customer-system integration tests, browser accessibility checks, load testing and independent
   security review. Static bearer MCP support does not imply every vendor's hosted server works.

OAuth, private networking and SSO are not advertised as already implemented. Vendor connections
remain native Fabric/Datadog plus the generic MCP connector and existing incident-source adapters.

## Release verification

- Published to the existing `https://resolution-a7j.pages.dev` Pages application and
  `resolution-api` Worker. Additive D1 migration applied successfully.
- 444 automated tests passed, including real SQLite migrations, chat-lease concurrency,
  wallet concurrency, tenant-deletion cascading and the four signup-client regressions.
  Typecheck and the production build check passed; the final build reused the matching
  successful Turbo build cache.
- Lint passed with two existing `any` warnings in API test helpers.
- Live smoke test passed through the Pages API proxy: signup, two tenant workspaces,
  credential encryption/test/revocation/rotation, connection disabling, plaintext-config
  rejection, forged-chat-history rejection, a real AI chat response, persistence, cross-tenant
  404 responses and unconfigured production billing returning 503. Temporary records removed.
- Public landing and sign-in pages verified in a browser. Authenticated dashboard interactions
  were covered through API tests; a full browser regression suite is still pending.
- Resend secret configured, but the existing sender is `onboarding@resend.dev` (test sender).
  A customer-owned verified sender domain is required for general customer email delivery.

## Signup deployment correction

The first manual Pages publish omitted NEXT_PUBLIC_API_URL, and the old frontend fallback
embedded localhost:4000 in the browser bundle. Direct API smoke tests passed but did not catch
this browser-only failure. The API client now defaults to the same-origin Pages proxy in
production, with localhost:8787 used only for development. Production builds reject insecure
or loopback overrides. Turbo includes NEXT_PUBLIC_API_URL in its build key and caches out/.
Four browser-client regression tests, a production build, typecheck and lint passed. The
exported bundle was checked for localhost endpoints. Following publication, a disposable
account signed in through the browser, created a workspace and reached its dashboard.

## FixCaptain branding and domain

The product name is FixCaptain and its public address is `https://www.fixcaptain.com`.
The landing page, authentication screens, dashboard, platform administration, favicon,
AI assistant identity and password-reset email use this name. Production reset and checkout
links use the custom domain. Cloudflare project names, database identifiers, package names
and the existing Pages API proxy remain stable to preserve integrations and stored data.
The email sender display name is FixCaptain; its address remains the restricted Resend test
sender until customer-domain email verification is completed.
