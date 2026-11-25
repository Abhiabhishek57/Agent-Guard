# AgentGuard

A working prototype for evaluating AI agent tool requests before sandbox execution.


## Current implementation

This version implements deterministic policy decisions on the server, an approval queue, sandbox tool execution, and persistent request/audit records. The web console includes a request editor, sample scenarios, decision explanations, searchable activity, and JSON export.

This is a newly built prototype based on the earlier AgentGuard design. It uses JavaScript and Cloudflare Workers with D1 storage. The earlier Python, OpenAI API and Supabase architecture was a design discussion; those integrations are not implemented in this version.

## Try it

1. Open the private deployment and sign in with the owning account.
2. In **Policy lab**, evaluate `list_files` with `{"path":"/workspace"}`.
3. Choose **Execute in sandbox** to receive fixture results.
4. Try **Protected file** to see a block, or **Email approval** to review an approval request.
5. Approve or reject email requests in **Approvals**. Approval permits a separate sandbox execution.
6. Review **Audit log** or export the saved activity as JSON.

Use sample data only. Email recipient, subject and body are redacted before storage. Restricted paths are replaced by a placeholder. There is no automatic email delivery or real filesystem access.

## Implemented rules

| Tool | Decision and scope |
| --- | --- |
| `list_files` | Allow listing `/workspace` sandbox fixtures only. |
| `read_file` | Allow `/workspace/README.md` and `/workspace/notes.txt` only. |
| `delete_file` | Always block. |
| `send_email` | Require approval before simulated execution. |
| Unknown tool | Block by default. |

Requests have immutable tool arguments. Approval/rejection only applies to pending requests. Execution only applies to allowed or approved requests, and conditional database updates prevent repeating the same transition. The prototype records evaluation, approval, rejection and execution events. It is not a production security guarantee or protection for external tools that bypass this application.

## Run locally

Requires Node.js 22.13 or newer with the built-in `node:sqlite` module. No package installation or API key is required.

```sh
npm run dev
```

Open `http://127.0.0.1:8787`. Local mode uses a local identity and an ignored SQLite database in `.local/`; it binds to loopback only. The hosted version uses Sites identity headers and owner-private access, with D1 records scoped to the signed-in user.

```sh
npm run build
node scripts/validate-artifact.mjs
```

Build output is `dist/server/index.js`. The build embeds `ui.html` and the policy module in a single Worker. `.openai/hosting.json` declares the Sites project and `DB` binding. Database schema migrations live in `drizzle/` and are applied through Sites publication. Local preview initializes a separate database.

## Source layout

- `ui.html`: responsive console and client interactions.
- `worker/policy.js`: validation, rules and sandbox fixtures.
- `worker/index.js`: HTTP API, ownership checks and state transitions.
- `drizzle/`: database schema migration and journal.
- `scripts/build.mjs`: dependency-free Worker build.
- `scripts/dev.mjs`: local preview with SQLite.

## API

- `GET /api/state`: latest 250 requests and current rules.
- `POST /api/evaluate`: evaluate `{ "tool": "list_files", "arguments": { "path": "/workspace" } }`.
- `POST /api/requests/:id/approve`: approve a pending request.
- `POST /api/requests/:id/reject`: reject a pending request.
- `POST /api/requests/:id/execute`: execute an eligible sandbox request.
- `GET /api/export`: export latest 250 requests and 500 audit events.
- `GET /health`: service health response.

Action endpoints accept an empty JSON object and do not accept changed tool arguments. Hosted API requests require signed-in identity. Write requests also require the same Origin as the application.

## Deferred work

Formal tests, broader security review, real agent/MCP integration, external tool connectors and AI-provider integration are not included. There are no benchmark, coverage or production-readiness claims. The dashboard counts reflect the latest 250 loaded requests.
