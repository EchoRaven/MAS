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

  /** One line per table, with columns and what they point at: compact enough for a tool description. */
  async compactSchema(): Promise<string> {
    const db = await this.conn();
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).filter((t) => !this.spec.tables.length || this.spec.tables.includes(t.name));
    return tables
      .map((t) => {
        const cols = db.prepare(`PRAGMA table_info("${t.name.replace(/"/g, "")}")`).all() as { name: string; type: string }[];
        const fks = db.prepare(`PRAGMA foreign_key_list("${t.name.replace(/"/g, "")}")`).all() as { from: string; table: string }[];
        const ref = new Map(fks.map((f) => [f.from, f.table]));
        return `${t.name}(${cols.map((c) => c.name + (ref.has(c.name) ? `→${ref.get(c.name)}` : "")).join(", ")})`;
      })
      .join("; ");
  }

  /** The SELECT statements in what a model wrote: fences, comments and prose around them dropped. */
  static statements(text: string): string[] {
    const body = text.replace(/```(?:sql)?/gi, "\n").replace(/--[^\n]*/g, "");
    return body
      .split(";")
      .map((s) => s.trim())
      .map((s) => s.slice(Math.max(0, s.search(/\b(select|with)\b/i))))
      .filter((s) => READ.test(s));
  }

  async schemaText(): Promise<string> {
    const db = await this.conn();
    const tables = (db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'").all() as { name: string; sql: string }[]).filter((t) => !this.spec.tables.length || this.spec.tables.includes(t.name));
    return tables.map((t) => t.sql).join(";\n");
  }

  async tools(_edge: SysEdge): Promise<RtTool[]> {
    const s = this.spec;
    // the tools say what is in the database, so a model writes the right SQL the first time
    const shape = await this.compactSchema().catch(() => "");
    const holds = shape ? ` Tables: ${shape}.` : "";
    if (s.mode === "templates")
      return s.templates.map((t) => {
        const params = [...new Set([...t.sql.matchAll(/:(\w+)/g)].map((m) => m[1]))];
        return { name: t.name, description: t.description || t.sql, input_schema: schema(Object.fromEntries(params.map((p) => [p, S]))), effect: READ.test(t.sql) ? "read" : "write", source: this.id, run: async (a) => this.query(t.sql, a) } satisfies RtTool;
      });
    if (s.mode === "text_to_sql")
      return [
        { name: "ask_database", description: `Ask ${this.node.data.name} a question in plain language; it writes and runs the SQL.${holds}`, input_schema: schema({ question: S }), effect: "read", source: this.id, run: async (a, c) => {
          const ask = (extra: string) => llmCall(this.rc, c.node, `Write SQLite ${s.read_only ? "SELECT " : ""}queries that answer the question: one statement per part of it, separated by semicolons. Reply with the SQL only.\n\nSchema:\n${shape || "(unknown)"}\n${extra}\nQuestion: ${a.question}`, s.model);
          let sqls = DatabaseEnv.statements(await ask(""));
          let out: string[] = [];
          try {
            if (!sqls.length) throw new Error("no SELECT statement in the reply");
            for (const q of sqls) out.push(`SQL: ${q}\n${await this.query(q)}`);
          } catch (e) {
            // one repair: the error goes back with the schema
            sqls = DatabaseEnv.statements(await ask(`The last attempt failed: ${(e as Error).message}. Fix it.\n`));
            out = [];
            for (const q of sqls) out.push(`SQL: ${q}\n${await this.query(q)}`);
          }
          return out.join("\n\n");
        } },
        { name: "run_sql", description: `Run a SQL query${s.read_only ? " (SELECT only)" : ""}.${holds}`, input_schema: schema({ sql: S }), effect: s.read_only ? "read" : "write", source: this.id, run: async (a) => this.query(String(a.sql)) },
      ];
    if (s.mode === "custom" && s.fn)
      return [{ name: "query_database", description: `Query ${this.node.data.name}`, input_schema: schema({ request: S }), effect: "read", source: this.id, run: async (a, c) => String(await runFn(s.fn!, a, this.rc, { node: c.node, helpers: { query: (sql: string, p?: Record<string, unknown>) => this.query(sql, p) } })) }];
    return [{ name: "run_sql", description: `Run a SQL query${s.read_only ? " (SELECT only)" : ""}.${holds}`, input_schema: schema({ sql: S }), effect: s.read_only ? "read" : "write", source: this.id, run: async (a) => this.query(String(a.sql)) }];
  }

  async close() {
    if (this.db) (await this.db.catch(() => null))?.close();
  }
}
