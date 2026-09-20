# mcp-clockodo

**Unofficial** MCP (Model Context Protocol) server for the
[Clockodo](https://www.clockodo.com) time-tracking API — read tools for daily
use, guarded write tools with explicit confirmation for destructive actions.

> ⚠️ Not affiliated with or endorsed by Clockodo GmbH. For a scoped, audited,
> officially maintained MCP endpoint for your product, see
> [MCP Clinic](https://mcpclinic.dev).

## Why

Your time-tracking data is exactly what a coding assistant should be able to
answer ("how did I split my hours this week?") without you opening a browser.
This server exposes Clockodo through 12 well-described tools with a safety
model that doesn't trust the LLM:

- **Reads by default** — list/get for entries, customers, projects, users,
  entry texts, clock status.
- **Destructive actions are gated** — `clockodo_delete_entry` and
  `clockodo_clock_delete` require an explicit `confirm: true` *and* a user
  approval before they do anything.
- **Honest semantics** — Clockodo never hard-deletes time entries; the tool
  description says "DEACTIVATES" and the running-clock delete says it
  *discards* unbooked time. The LLM can't promise something the API doesn't do.
- **Upstream errors stay upstream** — Clockodo's own error messages are passed
  through so the model can react to the real cause.

## Tools

| Tool | Kind | Notes |
|---|---|---|
| `clockodo_me` | read | authenticated user |
| `clockodo_list_entries` | read | **requires explicit time range**, paginated |
| `clockodo_get_entry` | read | |
| `clockodo_list_customers` | read | |
| `clockodo_list_projects` | read | filter by customer/name/active |
| `clockodo_list_users` | read | |
| `clockodo_list_entry_texts` | read | predefined descriptions |
| `clockodo_clock_status` | read | currently running clock |
| `clockodo_create_entry` | write | customer/project/service + time or duration |
| `clockodo_update_entry` | write | partial update |
| `clockodo_delete_entry` | destructive | deactivates; needs `confirm: true` |
| `clockodo_clock_start` | write | starts live tracking |
| `clockodo_clock_delete` | destructive | stops the clock and **discards** unbooked time; needs `confirm: true` |

## Setup

Get your API key in Clockodo → *My settings → API*, then register the server
in your MCP client:

```json
{
  "mcpServers": {
    "clockodo": {
      "command": "npx",
      "args": ["-y", "mcp-clockodo"],
      "env": {
        "CLOCKODO_API_USER": "you@company.com",
        "CLOCKODO_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Development

```bash
npm install
npm test   # unit tests with injected fetch — no Clockodo account needed
```

## Safety notes

- The delete tool **deactivates** (Clockodo semantics); it never hard-deletes.
- The running-clock delete **discards unbooked time** — the description says so
  and the tool refuses without `confirm: true`.
- Time-range listing requires an explicit range, so a stray "show me
  everything" can't pull your whole history.
- Your API key stays in your client config; this server talks only to
  `my.clockodo.com`.

## License

MIT — unofficial community project by [MCP Clinic](https://mcpclinic.dev).
We build scoped, audited MCP endpoints for B2B SaaS products (that one is the
official, supported route for vendors).
