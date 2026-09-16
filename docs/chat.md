# Chat assistant

Chat uses the session cookie and validated `X-Tenant-Id` membership. The model never chooses
the tenant. Conversation reads and writes also require the initiating user's ID.

- `POST /api/chat`: `{ message, conversationId? }`. Returns `{ conversationId, messages, isMock }`.
- `GET /api/chat/conversations`: latest 50 conversations owned by this user in this tenant.
- `GET /api/chat/conversations/:id`: persisted conversation; another user's or tenant's ID returns 404.
- `DELETE /api/chat/conversations/:id`: delete an idle conversation owned by the caller.

The server loads prior messages. Client assistant messages and fabricated tool results are rejected.
A single initial user message in the old `messages` shape is accepted for migration compatibility.
Turns are bounded to ten tool iterations, user inputs to 10,000 characters and conversations to
roughly 180 messages before starting another conversation. A database lease serializes turns.
The response currently returns once a turn completes; token streaming is a future milestone.

The assistant can read incidents, start investigations and propose remediation. It cannot decide
approvals, even if a model tries to invoke that tool. Review exact actions in the Approvals page.
MOCK_MODE is explicit. Production requires a real AI key unless mock mode was deliberately enabled.
