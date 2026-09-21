#!/usr/bin/env node
// mcp-clockodo — unofficial MCP server for Clockodo time tracking (stdio).
//
// Safety model (mirrors MCP Clinic's mcp-basis):
//   - read tools are the default; every destructive tool requires confirm: true
//   - Clockodo "deletes" time entries by deactivating them — the tool description
//     says exactly that, so the LLM never promises a hard delete
//   - clock delete removes the RUNNING clock without saving it — called out loudly
//   - errors from upstream are passed through verbatim so the model can recover

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ClockodoClient, ClockodoError } from "./clockodo.ts";

const API_USER = process.env.CLOCKODO_API_USER ?? "";
const API_KEY = process.env.CLOCKODO_API_KEY ?? "";

const client = new ClockodoClient(API_USER, API_KEY);

const server = new McpServer(
  { name: "mcp-clockodo", version: "0.1.0" },
  {
    instructions:
      "Unofficial Clockodo time-tracking tools. Time entries are queried with an explicit time range (time_since/time_until, format YYYY-MM-DDTHH:mm:ss). " +
      "Destructive actions (delete entry, delete running clock) require confirm: true after the user approved. " +
      "Deleting a time entry in Clockodo DEACTIVATES it (it stays visible in reports with 'deactivated' flag); deleting the running clock DISCARDS the unbooked time.",
  },
);

function text(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function track(_tool: string) {
  return async (fn: () => Promise<unknown>) => {
    try {
      const data = await fn();
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    } catch (err: any) {
      const msg = err instanceof ClockodoError ? `Clockodo ${err.status}: ${err.message}` : String(err?.message ?? err);
      return { content: [{ type: "text" as const, text: msg }], isError: true };
    }
  };
}

// —— reads ————————————————————————————————————————————————

server.registerTool(
  "clockodo_me",
  {
    description:
      "Returns the authenticated Clockodo user (name, e-mail, role, default hourly rate, time format). Use this first to verify the connection.",
    inputSchema: {},
  },
  async () =>
    track("clockodo_me")(async () => {
      const res = await client.get<any>("/v4/users/me");
      return res?.data ?? res;
    }),
);

server.registerTool(
  "clockodo_list_entries",
  {
    description:
      "Lists time entries in a time range. Required: time_since and time_until (ISO, e.g. 2026-09-01T00:00:00). Optional: customers_id, projects_id, users_id, page (1-based, 50 per page). The response includes paging — fetch further pages only if the user asks for more.",
    inputSchema: {
      time_since: z.string().describe("range start, ISO datetime YYYY-MM-DDTHH:mm:ss"),
      time_until: z.string().describe("range end, ISO datetime YYYY-MM-DDTHH:mm:ss"),
      customers_id: z.number().optional().describe("filter by customer id"),
      projects_id: z.number().optional().describe("filter by project id"),
      users_id: z.number().optional().describe("filter by user id"),
      page: z.number().optional().describe("1-based page number"),
    },
    annotations: { readOnlyHint: true },
  },
  async (args) =>
    track("clockodo_list_entries")(async () => {
      const res = await client.list("/v2/entries", {
        time_since: args.time_since,
        time_until: args.time_until,
        customers_id: args.customers_id,
        projects_id: args.projects_id,
        users_id: args.users_id,
        page: args.page,
      });
      return {
        entries: res.items,
        page: res.page,
        totalPages: res.totalPages,
        hint: res.page < res.totalPages ? "more pages available — increase page to continue" : undefined,
      };
    }),
);

server.registerTool(
  "clockodo_get_entry",
  {
    description: "Fetches a single time entry by id, including its deactivated flag.",
    inputSchema: { id: z.number().describe("entry id") },
    annotations: { readOnlyHint: true },
  },
  async (args) =>
    track("clockodo_get_entry")(async () => {
      const res = await client.get<any>(`/v2/entries/${args.id}`);
      return res?.data ?? res;
    }),
);

server.registerTool(
  "clockodo_list_customers",
  {
    description: "Lists customers. Optional: page, name filter.",
    inputSchema: {
      page: z.number().optional(),
      name: z.string().optional().describe("filter by name substring"),
    },
    annotations: { readOnlyHint: true },
  },
  async (args) =>
    track("clockodo_list_customers")(async () => {
      const res = await client.list<any>("/v3/customers", { page: args.page, filter: args.name ? JSON.stringify({ name: args.name }) : undefined });
      return { customers: res.items, page: res.page, totalPages: res.totalPages };
    }),
);

server.registerTool(
  "clockodo_list_projects",
  {
    description: "Lists projects. Optional: page, customers_id filter, name filter, active-only flag.",
    inputSchema: {
      page: z.number().optional(),
      customers_id: z.number().optional().describe("only projects of this customer"),
      name: z.string().optional().describe("filter by name substring"),
      active: z.boolean().optional().describe("only active projects"),
    },
    annotations: { readOnlyHint: true },
  },
  async (args) =>
    track("clockodo_list_projects")(async () => {
      const filter: Record<string, unknown> = {};
      if (args.customers_id) filter.customers_id = args.customers_id;
      if (args.name) filter.name = args.name;
      if (args.active !== undefined) filter.active = args.active;
      const res = await client.list<any>("/v4/projects", {
        page: args.page,
        filter: Object.keys(filter).length ? JSON.stringify(filter) : undefined,
      });
      return { projects: res.items, page: res.page, totalPages: res.totalPages };
    }),
);

server.registerTool(
  "clockodo_list_users",
  {
    description: "Lists all users (team members) with ids and roles.",
    inputSchema: { page: z.number().optional() },
    annotations: { readOnlyHint: true },
  },
  async (args) =>
    track("clockodo_list_users")(async () => {
      const res = await client.list<any>("/v3/users", { page: args.page });
      return { users: res.items, page: res.page, totalPages: res.totalPages };
    }),
);

server.registerTool(
  "clockodo_list_entry_texts",
  {
    description:
      "Lists the account's predefined entry texts (recurring descriptions). Pass one as 'text' when creating entries for consistent naming.",
    inputSchema: {
      term: z.string().optional().describe("search substring"),
      page: z.number().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async (args) =>
    track("clockodo_list_entry_texts")(async () => {
      const res = await client.list<any>("/v3/entriesTexts", { term: args.term, page: args.page });
      return { texts: res.items, page: res.page, totalPages: res.totalPages };
    }),
);

server.registerTool(
  "clockodo_clock_status",
  {
    description:
      "Returns the currently running clocked time (started but not yet saved), if any. The running entry has type 'clock'.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () =>
    track("clockodo_clock_status")(async () => {
      const res = await client.get<any>("/v2/clock");
      return res?.data ?? res;
    }),
);

// —— writes ————————————————————————————————————————————————

server.registerTool(
  "clockodo_create_entry",
  {
    description:
      "Creates a time entry. Required: customers_id, projects_id, services_id, billable. Time: either time_since + time_until, or time_since + duration (minutes). Optional: text (use clockodo_list_entry_texts for consistent naming), users_id (admin only).",
    inputSchema: {
      customers_id: z.number(),
      projects_id: z.number(),
      services_id: z.number(),
      billable: z.boolean().describe("whether the time counts as billable"),
      time_since: z.string().describe("ISO datetime YYYY-MM-DDTHH:mm:ss"),
      time_until: z.string().optional().describe("ISO datetime; required unless duration is given"),
      duration: z.number().optional().describe("duration in MINUTES; required unless time_until is given"),
      text: z.string().optional(),
      users_id: z.number().optional().describe("admin only: create for another user"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async (args) =>
    track("clockodo_create_entry")(async () => {
      const body: Record<string, unknown> = {
        customers_id: args.customers_id,
        projects_id: args.projects_id,
        services_id: args.services_id,
        billable: args.billable,
        time_since: args.time_since,
      };
      if (args.time_until) body.time_until = args.time_until;
      if (args.duration !== undefined) body.duration = args.duration;
      if (args.text) body.text = args.text;
      if (args.users_id) body.users_id = args.users_id;
      const res = await client.post<any>("/v2/entries", body);
      return res?.data ?? res;
    }),
);

server.registerTool(
  "clockodo_update_entry",
  {
    description:
      "Updates an existing time entry. Pass only the fields to change; at least one. Note: customers_id/projects_id must stay consistent (a project belongs to its customer).",
    inputSchema: {
      id: z.number(),
      customers_id: z.number().optional(),
      projects_id: z.number().optional(),
      services_id: z.number().optional(),
      billable: z.boolean().optional(),
      time_since: z.string().optional(),
      time_until: z.string().optional(),
      duration: z.number().optional().describe("duration in minutes"),
      text: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (args) =>
    track("clockodo_update_entry")(async () => {
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(args)) if (v !== undefined) patch[k] = v;
      const res = await client.put<any>(`/v2/entries/${args.id}`, patch);
      return res?.data ?? res;
    }),
);

server.registerTool(
  "clockodo_delete_entry",
  {
    description:
      "DEACTIVATES a time entry (Clockodo has no hard delete — the entry stays in reports flagged 'deactivated'). Ask the user to confirm before calling. Requires 'confirm': true.",
    inputSchema: {
      id: z.number(),
      confirm: z.boolean().describe("must be true; the user must have approved the deactivation explicitly"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  async (args) =>
    track("clockodo_delete_entry")(async () => {
      if (args.confirm !== true) {
        return {
          content: [{ type: "text" as const, text: "Refused: pass confirm=true only after the user explicitly approved deactivating this entry." }],
          isError: true,
        };
      }
      const res = await client.delete<any>(`/v2/entries/${args.id}`);
      return { deactivated: true, id: args.id, response: res ?? null };
    }),
);

server.registerTool(
  "clockodo_clock_start",
  {
    description:
      "Starts the running clock (live tracking). Required: customers_id, services_id. Optional: projects_id, text, billable. Only one clock can run at a time — check clockodo_clock_status first. Time is counted live until stopped.",
    inputSchema: {
      customers_id: z.number(),
      services_id: z.number(),
      projects_id: z.number().optional(),
      billable: z.boolean().optional(),
      text: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async (args) =>
    track("clockodo_clock_start")(async () => {
      const body: Record<string, unknown> = {
        customers_id: args.customers_id,
        services_id: args.services_id,
        billable: args.billable ?? true,
      };
      if (args.projects_id) body.projects_id = args.projects_id;
      if (args.text) body.text = args.text;
      const res = await client.post<any>("/v2/clock", body);
      return res?.data ?? res;
    }),
);

server.registerTool(
  "clockodo_clock_delete",
  {
    description:
      "STOPS the running clock and DISCARDS the unbooked time — this does NOT save a time entry. To keep tracked time, use clockodo_update via the running entry id from clockodo_clock_status instead. Ask the user to confirm. Requires 'confirm': true.",
    inputSchema: {
      id: z.number().describe("id of the running clock entry (from clockodo_clock_status)"),
      confirm: z.boolean().describe("must be true; the tracked time will be discarded"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  async (args) =>
    track("clockodo_clock_delete")(async () => {
      if (args.confirm !== true) {
        return {
          content: [{ type: "text" as const, text: "Refused: pass confirm=true only after the user explicitly approved discarding the running clock." }],
          isError: true,
        };
      }
      const res = await client.delete<any>(`/v2/clock/${args.id}`);
      return { stopped: true, discarded: true, response: res ?? null };
    }),
);

async function main() {
  // Initialize even without credentials (directory scanners run the server
  // cold); tool calls fail with a clear message instead.
  await server.connect(new StdioServerTransport());
  if (!API_USER || !API_KEY) {
    process.stderr.write(
      "mcp-clockodo: set CLOCKODO_API_USER and CLOCKODO_API_KEY environment variables (Clockodo → My settings → API).\n",
    );
    return;
  }
  process.stderr.write("mcp-clockodo running on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err?.message ?? err}\n`);
  process.exit(1);
});
