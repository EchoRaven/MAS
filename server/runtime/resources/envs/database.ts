// Database env on SQLite (node:sqlite). `image` may be "sqlite:<path>";
// otherwise the env gets its own file in the server's state folder.
// Query modes come from the env's DbQuerySpec: named templates, text-to-SQL
// within a table allowlist, or custom code. Read-only envs only run SELECTs.
import path from "node:path";
import type { DatabaseSync as DB } from "node:sqlite";
import type { EnvData, SysEdge, SysNode } from "@/model/types";
import { defaultDbQuery } from "@/model/pipelines";
import type { RunCtx } from "../../context";
import { llmCall, runFn } from "../../functions";
import { S, schema, type Resource, type RtTool } from "../types";

let sqlite: typeof import("node:sqlite") | null = null;
async function open(file: string): Promise<DB> {
  sqlite ??= await import("node:sqlite").catch(() => {
    throw new Error("SQLite needs Node 22.5+ started with --experimental-sqlite (npm run server does this)");
  });
  return new sqlite.DatabaseSync(file);
}

const READ = /^\s*(with\b[\s\S]*?\)\s*)?(select|pragma\s+table_info|explain)\b/i;

export class DatabaseEnv implements Resource {
  private db?: Promise<DB>;
  constructor(
    private rc: RunCtx,
    private node: SysNode<EnvData>,
  ) {}
  get id() {
    return this.node.id;
  }
  private get spec() {
    return this.node.data.db ?? defaultDbQuery();
  }
  private conn(): Promise<DB> {
    const img = this.node.data.image ?? "";
    const file = img.startsWith("sqlite:") ? path.resolve(img.slice(7)) : path.join(this.rc.store.stateDir(this.rc.doc.id, this.node.id), "db.sqlite");
    this.db ??= open(file);
    return this.db;
  }

  async query(sql: string, params: Record<string, unknown> = {}): Promise<string> {
    if (this.spec.read_only && !READ.test(sql)) throw new Error("this database is read-only: only SELECT queries run");
    const db = await this.conn();
    const stmt = db.prepare(sql);
    const named = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : (v as string | number | null)]));
    if (READ.test(sql)) {
      const rows = (Object.keys(named).length ? stmt.all(named as Record<string, string>) : stmt.all()).slice(0, this.spec.row_limit || 200);
      return rows.length ? JSON.stringify(rows, null, 1) : "(no rows)";
    }
    const r = Object.keys(named).length ? stmt.run(named as Record<string, string>) : stmt.run();
    return `${r.changes} row(s) changed`;
  }

  async schemaText(): Promise<string> {
    const db = await this.conn();
    const tables = (db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'").all() as { name: string; sql: string }[]).filter((t) => !this.spec.tables.length || this.spec.tables.includes(t.name));
    return tables.map((t) => t.sql).join(";\n");
  }

  async tools(_edge: SysEdge): Promise<RtTool[]> {
    const s = this.spec;
    if (s.mode === "templates")
      return s.templates.map((t) => {
        const params = [...new Set([...t.sql.matchAll(/:(\w+)/g)].map((m) => m[1]))];
        return { name: t.name, description: t.description || t.sql, input_schema: schema(Object.fromEntries(params.map((p) => [p, S]))), effect: READ.test(t.sql) ? "read" : "write", source: this.id, run: async (a) => this.query(t.sql, a) } satisfies RtTool;
      });
    if (s.mode === "text_to_sql")
      return [
        { name: "ask_database", description: `Ask ${this.node.data.name} a question in plain language`, input_schema: schema({ question: S }), effect: "read", source: this.id, run: async (a, c) => {
          const sql = (await llmCall(this.rc, c.node, `Write one SQLite ${s.read_only ? "SELECT " : ""}query that answers the question. Reply with the SQL only.\n\nSchema:\n${await this.schemaText()}\n\nQuestion: ${a.question}`, s.model)).replace(/```(sql)?/g, "").trim();
          return `SQL: ${sql}\n${await this.query(sql)}`;
        } },
        { name: "run_sql", description: "Run a SQL query", input_schema: schema({ sql: S }), effect: s.read_only ? "read" : "write", source: this.id, run: async (a) => this.query(String(a.sql)) },
      ];
    if (s.mode === "custom" && s.fn)
      return [{ name: "query_database", description: `Query ${this.node.data.name}`, input_schema: schema({ request: S }), effect: "read", source: this.id, run: async (a, c) => String(await runFn(s.fn!, a, this.rc, { node: c.node, helpers: { query: (sql: string, p?: Record<string, unknown>) => this.query(sql, p) } })) }];
    return [{ name: "run_sql", description: "Run a SQL query", input_schema: schema({ sql: S }), effect: s.read_only ? "read" : "write", source: this.id, run: async (a) => this.query(String(a.sql)) }];
  }

  async close() {
    if (this.db) (await this.db.catch(() => null))?.close();
  }
}
