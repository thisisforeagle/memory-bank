#!/usr/bin/env tsx
/**
 * memory.ts — the memory-bank drift checker.
 *
 * Structured, machine-verifiable memory records for AI agents: decisions,
 * conventions, facts, features, deferred work. Records live in the HOST repo
 * under memory/records/<kind>/<ID>-<slug>.md with rigid YAML frontmatter;
 * this script validates them and verifies their assertions against the code.
 *
 * Zero dependencies beyond node builtins — run with `tsx` (or any TS runner).
 *
 * Subcommands:
 *   check    [--json] [--skip-commands] [--root <dir>]   verify everything, exit 1 on drift
 *   verify   <id> [--root <dir>]                          verify a single record
 *   stale    [--root <dir>]                               records whose anchors changed since last sync
 *   index    [--root <dir>]                               regenerate memory/INDEX.md
 *   anchors  --match <file> [--root <dir>]                record IDs anchored to a file
 *   new      <kind> --title "..." [--root <dir>]          scaffold a record from templates/
 *   sync     --all | --only <id> [--skip-commands] [--root <dir>]
 *                                                         green check, then stamp verified: — --all stamps
 *                                                         every active record, --only <id> stamps one;
 *                                                         blanket stamping is opt-in and requires --all
 *
 * Frontmatter grammar (deliberately rigid — anything else is a loud error):
 *   - scalars: plain, 'single-quoted' ('' escapes '), "double-quoted" (JSON escapes)
 *   - flow lists of scalars: key: [a, b]
 *   - block lists of scalars or flat maps:
 *       anchors:
 *         - path: packages/foo.ts
 *           symbol: 'export type Foo'
 *   - one nested flat map: verified: { date, sha } in block form
 *   - full-line comments; trailing comments only after a space-# on plain scalars
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Scalar = string | number;

interface Anchor {
  path: string;
  symbol?: string;
}

interface Assertion {
  type: "file-exists" | "symbol-exists" | "count" | "forbidden" | "command" | "none";
  path?: string;
  pattern?: string;
  equals?: number;
  glob?: string;
  allow?: string[];
  run?: string;
  timeout?: number;
  reason?: string;
}

interface MemoryRecord {
  id: string;
  title: string;
  kind: "decision" | "convention" | "fact" | "feature" | "deferred";
  status: "active" | "superseded" | "retired";
  rule: string;
  anchors: Anchor[];
  assertions: Assertion[];
  links: string[];
  owners: string[];
  created: string;
  verified?: { date: string; sha: string };
  supersedes?: string;
  supersededBy?: string;
  file: string; // repo-relative path to the record file
}

interface Failure {
  id: string;
  file: string;
  message: string;
}

const KIND_PREFIX: Record<MemoryRecord["kind"], string> = {
  decision: "DEC",
  convention: "CONV",
  fact: "FACT",
  feature: "FEAT",
  deferred: "DEF",
};

const KIND_DIR: Record<MemoryRecord["kind"], string> = {
  decision: "decisions",
  convention: "conventions",
  fact: "facts",
  feature: "features",
  deferred: "deferred",
};

const KINDS = Object.keys(KIND_PREFIX) as MemoryRecord["kind"][];
const STATUSES = ["active", "superseded", "retired"];
const TOP_KEYS = new Set([
  "id", "title", "kind", "status", "rule", "anchors", "assertions",
  "links", "owners", "created", "verified", "supersedes", "superseded-by",
]);
const ASSERTION_FIELDS: Record<string, { required: string[]; optional: string[] }> = {
  "file-exists":   { required: ["path"], optional: [] },
  "symbol-exists": { required: ["path", "pattern"], optional: [] },
  "count":         { required: ["path", "pattern", "equals"], optional: [] },
  "forbidden":     { required: ["glob", "pattern"], optional: ["allow"] },
  "command":       { required: ["run"], optional: ["timeout"] },
  "none":          { required: ["reason"], optional: [] },
};

// ---------------------------------------------------------------------------
// Frontmatter parser (rigid YAML subset)
// ---------------------------------------------------------------------------

class ParseError extends Error {}

function parseScalar(raw: string, ctx: string): Scalar {
  const s = raw.trim();
  if (s.startsWith("'")) {
    // single-quoted: '' escapes a quote
    let out = "";
    let i = 1;
    while (i < s.length) {
      if (s[i] === "'") {
        if (s[i + 1] === "'") { out += "'"; i += 2; continue; }
        // closing quote — anything after must be a comment or whitespace
        const rest = s.slice(i + 1).trim();
        if (rest !== "" && !rest.startsWith("#")) {
          throw new ParseError(`${ctx}: trailing content after closing quote: ${rest}`);
        }
        return out;
      }
      out += s[i]; i += 1;
    }
    throw new ParseError(`${ctx}: unterminated single-quoted string`);
  }
  if (s.startsWith('"')) {
    // double-quoted: JSON escape semantics
    let end = -1;
    for (let i = 1; i < s.length; i += 1) {
      if (s[i] === "\\") { i += 1; continue; }
      if (s[i] === '"') { end = i; break; }
    }
    if (end === -1) throw new ParseError(`${ctx}: unterminated double-quoted string`);
    const rest = s.slice(end + 1).trim();
    if (rest !== "" && !rest.startsWith("#")) {
      throw new ParseError(`${ctx}: trailing content after closing quote: ${rest}`);
    }
    try {
      return JSON.parse(s.slice(0, end + 1)) as string;
    } catch {
      throw new ParseError(`${ctx}: invalid escapes in double-quoted string`);
    }
  }
  // plain scalar — strip trailing comment (YAML: '#' preceded by whitespace)
  const hash = s.search(/\s#/);
  const plain = (hash === -1 ? s : s.slice(0, hash)).trim();
  if (plain === "") throw new ParseError(`${ctx}: empty value`);
  if (/^-?\d+$/.test(plain)) return Number(plain);
  return plain;
}

function parseFlowList(raw: string, ctx: string): Scalar[] {
  const s = raw.trim();
  if (!s.endsWith("]")) throw new ParseError(`${ctx}: flow list must end with ]`);
  const inner = s.slice(1, -1).trim();
  if (inner === "") return [];
  if (/[\[\]{}]/.test(inner)) {
    throw new ParseError(`${ctx}: nested structures are not allowed in flow lists`);
  }
  return inner.split(",").map((part) => parseScalar(part, ctx));
}

/** Parses the rigid frontmatter subset. Returns the raw key→value map. */
function parseFrontmatter(text: string, file: string): Record<string, unknown> {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    throw new ParseError(`${file}: record must start with '---' frontmatter`);
  }
  let close = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") { close = i; break; }
  }
  if (close === -1) throw new ParseError(`${file}: unterminated frontmatter (missing closing ---)`);

  const out: Record<string, unknown> = {};
  let i = 1;
  while (i < close) {
    const line = lines[i];
    const ctx = `${file}:${i + 1}`;
    if (line.trim() === "" || line.trim().startsWith("#")) { i += 1; continue; }

    const top = line.match(/^([A-Za-z][\w-]*):(.*)$/);
    if (!top) throw new ParseError(`${ctx}: expected 'key:' at column 0, got: ${line}`);
    const key = top[1];
    const rest = top[2].trim();
    if (key in out) throw new ParseError(`${ctx}: duplicate key '${key}'`);

    if (rest !== "" && !rest.startsWith("#")) {
      out[key] = rest.startsWith("[") ? parseFlowList(rest, ctx) : parseScalar(rest, ctx);
      i += 1;
      continue;
    }

    // Block value: list items or a flat nested map.
    i += 1;
    const listItems: unknown[] = [];
    const mapEntries: Record<string, Scalar> = {};
    let sawList = false;
    let sawMap = false;
    while (i < close) {
      const bl = lines[i];
      const bctx = `${file}:${i + 1}`;
      if (bl.trim() === "" || bl.trim().startsWith("#")) { i += 1; continue; }
      if (!/^\s/.test(bl)) break; // next top-level key

      const item = bl.match(/^  - (.*)$/);
      const entry = bl.match(/^  ([A-Za-z][\w-]*): (.*)$/);
      if (item) {
        sawList = true;
        const content = item[1].trim();
        const kv = content.match(/^([A-Za-z][\w-]*): (.*)$/);
        if (kv) {
          // map item; continuation lines at indent 4
          const m: Record<string, Scalar | Scalar[]> = {};
          m[kv[1]] = kv[2].trim().startsWith("[")
            ? parseFlowList(kv[2], bctx)
            : parseScalar(kv[2], bctx);
          i += 1;
          while (i < close) {
            const cl = lines[i];
            const cctx = `${file}:${i + 1}`;
            if (cl.trim() === "" || cl.trim().startsWith("#")) { i += 1; continue; }
            const cont = cl.match(/^    ([A-Za-z][\w-]*): (.*)$/);
            if (!cont) break;
            if (cont[1] in m) throw new ParseError(`${cctx}: duplicate key '${cont[1]}' in list item`);
            m[cont[1]] = cont[2].trim().startsWith("[")
              ? parseFlowList(cont[2], cctx)
              : parseScalar(cont[2], cctx);
            i += 1;
          }
          listItems.push(m);
        } else {
          listItems.push(parseScalar(content, bctx));
          i += 1;
        }
      } else if (entry) {
        sawMap = true;
        if (entry[1] in mapEntries) throw new ParseError(`${bctx}: duplicate key '${entry[1]}'`);
        mapEntries[entry[1]] = parseScalar(entry[2], bctx);
        i += 1;
      } else {
        throw new ParseError(`${bctx}: expected '  - item' or '  key: value' under '${key}:', got: ${bl}`);
      }
    }
    if (sawList && sawMap) throw new ParseError(`${file}: '${key}:' mixes list items and map entries`);
    if (!sawList && !sawMap) throw new ParseError(`${file}: '${key}:' has an empty block`);
    out[key] = sawList ? listItems : mapEntries;
  }
  return out;
}

/** End line index (0-based, exclusive) of the frontmatter block, for rewrites. */
function frontmatterBounds(lines: string[], file: string): { open: number; close: number } {
  if (lines[0]?.trim() !== "---") throw new ParseError(`${file}: missing frontmatter`);
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") return { open: 0, close: i };
  }
  throw new ParseError(`${file}: unterminated frontmatter`);
}

// ---------------------------------------------------------------------------
// Record loading + validation
// ---------------------------------------------------------------------------

function asStringList(v: unknown, ctx: string): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new ParseError(`${ctx}: expected a list`);
  return v.map((x) => {
    if (typeof x !== "string" && typeof x !== "number") {
      throw new ParseError(`${ctx}: expected scalar list entries`);
    }
    return String(x);
  });
}

function validateRecord(raw: Record<string, unknown>, file: string): MemoryRecord {
  for (const key of Object.keys(raw)) {
    if (!TOP_KEYS.has(key)) throw new ParseError(`${file}: unknown frontmatter key '${key}'`);
  }
  for (const req of ["id", "title", "kind", "status", "rule", "created", "assertions"]) {
    if (!(req in raw)) throw new ParseError(`${file}: missing required key '${req}'`);
  }

  const id = String(raw.id);
  const kind = String(raw.kind) as MemoryRecord["kind"];
  const status = String(raw.status) as MemoryRecord["status"];
  if (!KINDS.includes(kind)) throw new ParseError(`${file}: unknown kind '${kind}'`);
  if (!STATUSES.includes(status)) throw new ParseError(`${file}: unknown status '${status}'`);
  if (!new RegExp(`^${KIND_PREFIX[kind]}-\\d{3,}$`).test(id)) {
    throw new ParseError(`${file}: id '${id}' must match ${KIND_PREFIX[kind]}-NNN for kind '${kind}'`);
  }
  if (!path.basename(file).startsWith(`${id}-`)) {
    throw new ParseError(`${file}: filename must start with '${id}-'`);
  }

  const anchors: Anchor[] = [];
  if (raw.anchors !== undefined) {
    if (!Array.isArray(raw.anchors)) throw new ParseError(`${file}: 'anchors' must be a list`);
    for (const a of raw.anchors as Record<string, Scalar>[]) {
      if (typeof a !== "object" || a === null || typeof a.path !== "string") {
        throw new ParseError(`${file}: each anchor needs a 'path'`);
      }
      const extra = Object.keys(a).filter((k) => k !== "path" && k !== "symbol");
      if (extra.length) throw new ParseError(`${file}: unknown anchor key(s): ${extra.join(", ")}`);
      anchors.push({ path: String(a.path), symbol: a.symbol === undefined ? undefined : String(a.symbol) });
    }
  }

  if (!Array.isArray(raw.assertions) || raw.assertions.length === 0) {
    throw new ParseError(`${file}: 'assertions' must be a non-empty list (use type: none if unverifiable)`);
  }
  const assertions: Assertion[] = [];
  for (const [idx, a] of (raw.assertions as Record<string, unknown>[]).entries()) {
    const ctx = `${file}: assertion ${idx + 1}`;
    if (typeof a !== "object" || a === null || typeof a.type !== "string") {
      throw new ParseError(`${ctx}: each assertion needs a 'type'`);
    }
    const spec = ASSERTION_FIELDS[a.type as string];
    if (!spec) throw new ParseError(`${ctx}: unknown assertion type '${a.type}'`);
    for (const req of spec.required) {
      if (!(req in a)) throw new ParseError(`${ctx} (${a.type}): missing '${req}'`);
    }
    for (const key of Object.keys(a)) {
      if (key !== "type" && !spec.required.includes(key) && !spec.optional.includes(key)) {
        throw new ParseError(`${ctx} (${a.type}): unknown field '${key}'`);
      }
    }
    if (a.type === "count" && typeof a.equals !== "number") {
      throw new ParseError(`${ctx} (count): 'equals' must be a number`);
    }
    for (const patternField of ["pattern"]) {
      if (patternField in a) {
        try {
          // compile early so schema validation catches bad regexes
          new RegExp(String(a[patternField]), "m");
        } catch (e) {
          throw new ParseError(`${ctx} (${a.type}): invalid regex: ${(e as Error).message}`);
        }
      }
    }
    assertions.push({
      type: a.type as Assertion["type"],
      path: a.path === undefined ? undefined : String(a.path),
      pattern: a.pattern === undefined ? undefined : String(a.pattern),
      equals: a.equals as number | undefined,
      glob: a.glob === undefined ? undefined : String(a.glob),
      allow: a.allow === undefined ? undefined : asStringList(a.allow, ctx),
      run: a.run === undefined ? undefined : String(a.run),
      timeout: a.timeout as number | undefined,
      reason: a.reason === undefined ? undefined : String(a.reason),
    });
  }

  let verified: MemoryRecord["verified"];
  if (raw.verified !== undefined) {
    const v = raw.verified as Record<string, Scalar>;
    if (typeof v !== "object" || v === null || Array.isArray(v) || v.date === undefined || v.sha === undefined) {
      throw new ParseError(`${file}: 'verified' must be a map with 'date' and 'sha'`);
    }
    verified = { date: String(v.date), sha: String(v.sha) };
  }

  return {
    id,
    title: String(raw.title),
    kind,
    status,
    rule: String(raw.rule),
    anchors,
    assertions,
    links: asStringList(raw.links, `${file}: links`),
    owners: asStringList(raw.owners, `${file}: owners`),
    created: String(raw.created),
    verified,
    supersedes: raw.supersedes === undefined ? undefined : String(raw.supersedes),
    supersededBy: raw["superseded-by"] === undefined ? undefined : String(raw["superseded-by"]),
    file,
  };
}

function recordsDir(root: string): string {
  return path.join(root, "memory", "records");
}

function loadRecords(root: string): { records: MemoryRecord[]; errors: Failure[] } {
  const dir = recordsDir(root);
  const records: MemoryRecord[] = [];
  const errors: Failure[] = [];
  if (!fs.existsSync(dir)) return { records, errors };

  const files: string[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(full);
    }
  };
  walk(dir);

  const seen = new Map<string, string>();
  for (const full of files) {
    const rel = path.relative(root, full);
    try {
      const raw = parseFrontmatter(fs.readFileSync(full, "utf8"), rel);
      const rec = validateRecord(raw, rel);
      const expectedDir = path.join("memory", "records", KIND_DIR[rec.kind]);
      if (path.dirname(rel) !== expectedDir) {
        throw new ParseError(`${rel}: kind '${rec.kind}' records belong in ${expectedDir}/`);
      }
      if (seen.has(rec.id)) {
        throw new ParseError(`${rel}: duplicate id '${rec.id}' (also in ${seen.get(rec.id)})`);
      }
      seen.set(rec.id, rel);
      records.push(rec);
    } catch (e) {
      if (e instanceof ParseError) errors.push({ id: rel, file: rel, message: e.message });
      else throw e;
    }
  }
  records.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return { records, errors };
}

// ---------------------------------------------------------------------------
// Assertion engine
// ---------------------------------------------------------------------------

function gitFiles(root: string, glob: string): string[] {
  const out = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", glob],
    { cwd: root, maxBuffer: 64 * 1024 * 1024 },
  );
  return out.toString("utf8").split("\0").filter(Boolean);
}

function runAssertion(rec: MemoryRecord, idx: number, a: Assertion, root: string, opts: { skipCommands: boolean }): Failure | "skipped" | null {
  const label = `${rec.id} assertion ${idx + 1} (${a.type})`;
  const fix = `→ update ${rec.file} or revert the code change`;

  switch (a.type) {
    case "none":
      return null;

    case "file-exists": {
      if (fs.existsSync(path.join(root, a.path!))) return null;
      return { id: rec.id, file: rec.file, message: `${label}: ${a.path} does not exist\n      ${fix}` };
    }

    case "symbol-exists": {
      const target = path.join(root, a.path!);
      if (!fs.existsSync(target)) {
        return { id: rec.id, file: rec.file, message: `${label}: ${a.path} does not exist\n      ${fix}` };
      }
      if (new RegExp(a.pattern!, "m").test(fs.readFileSync(target, "utf8"))) return null;
      return { id: rec.id, file: rec.file, message: `${label}: pattern not found in ${a.path}: ${a.pattern}\n      ${fix}` };
    }

    case "count": {
      const target = path.join(root, a.path!);
      if (!fs.existsSync(target)) {
        return { id: rec.id, file: rec.file, message: `${label}: ${a.path} does not exist\n      ${fix}` };
      }
      const found = [...fs.readFileSync(target, "utf8").matchAll(new RegExp(a.pattern!, "gm"))].length;
      if (found === a.equals) return null;
      return {
        id: rec.id,
        file: rec.file,
        message: `${label}: ${a.path} pattern ${a.pattern} — expected ${a.equals}, found ${found}\n      → if the code change is legitimate, bump 'equals' in ${rec.file}; otherwise revert`,
      };
    }

    case "forbidden": {
      // allow entries match exact files or directory prefixes
      const allow = a.allow ?? [];
      const isAllowed = (f: string) => allow.some((p) => f === p || f.startsWith(`${p}/`));
      const re = new RegExp(a.pattern!, "m");
      const hits: string[] = [];
      for (const f of gitFiles(root, a.glob!)) {
        if (isAllowed(f)) continue;
        const full = path.join(root, f);
        if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
        const text = fs.readFileSync(full, "utf8");
        const m = re.exec(text);
        if (m) {
          const line = text.slice(0, m.index).split("\n").length;
          hits.push(`${f}:${line}`);
          if (hits.length >= 5) break;
        }
      }
      if (hits.length === 0) return null;
      return {
        id: rec.id,
        file: rec.file,
        message: `${label}: forbidden pattern ${a.pattern} found in ${a.glob}:\n        ${hits.join("\n        ")}\n      → remove the violation (rule: ${rec.rule})`,
      };
    }

    case "command": {
      if (opts.skipCommands) return "skipped";
      try {
        execSync(a.run!, { cwd: root, timeout: (a.timeout ?? 120) * 1000, stdio: "pipe" });
        return null;
      } catch (e) {
        const err = e as { stdout?: Buffer; stderr?: Buffer; message: string };
        const tail = [err.stdout?.toString("utf8") ?? "", err.stderr?.toString("utf8") ?? ""]
          .join("\n").trim().split("\n").slice(-8).join("\n        ");
        return {
          id: rec.id,
          file: rec.file,
          message: `${label}: command failed: ${a.run}\n        ${tail || err.message}\n      ${fix}`,
        };
      }
    }
  }
}

interface CheckResult {
  records: MemoryRecord[];
  active: MemoryRecord[];
  failures: Failure[];
  assertionsRun: number;
  skippedCommands: number;
  unverifiable: number;
  indexFresh: boolean;
}

function runChecks(root: string, opts: { skipCommands: boolean; only?: string }): CheckResult {
  const { records, errors } = loadRecords(root);
  const failures: Failure[] = [...errors];
  const active = records.filter((r) => r.status === "active");

  // `verify <id>`: a typo or a retired/missing id must NOT silently PASS with
  // zero assertions — report it so agents/CI don't get false confidence.
  if (opts.only) {
    const target = records.find((r) => r.id === opts.only);
    if (!target) {
      failures.push({ id: opts.only, file: "(none)", message: `${opts.only}: unknown record — no record with that id exists` });
    } else if (target.status !== "active") {
      failures.push({ id: opts.only, file: target.file, message: `${opts.only} (${target.file}): record status is '${target.status}', not active — nothing to verify` });
    }
  }

  const toCheck = opts.only ? active.filter((r) => r.id === opts.only) : active;

  let assertionsRun = 0;
  let skippedCommands = 0;
  let unverifiable = 0;
  for (const rec of toCheck) {
    for (const [idx, a] of rec.assertions.entries()) {
      if (a.type === "none") { unverifiable += 1; continue; }
      const result = runAssertion(rec, idx, a, root, opts);
      if (result === "skipped") { skippedCommands += 1; continue; }
      assertionsRun += 1;
      if (result) failures.push(result);
    }
  }

  // INDEX freshness gate (skipped when verifying a single record).
  let indexFresh = true;
  if (!opts.only && fs.existsSync(path.join(root, "memory"))) {
    const indexPath = path.join(root, "memory", "INDEX.md");
    const expected = generateIndex(records);
    const actual = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf8") : "";
    if (actual !== expected) {
      indexFresh = false;
      failures.push({
        id: "INDEX",
        file: "memory/INDEX.md",
        message: "INDEX.md is stale or missing — run `memory index` (npm run memory:index) and commit the result",
      });
    }
  }

  return { records, active, failures, assertionsRun, skippedCommands, unverifiable, indexFresh };
}

// ---------------------------------------------------------------------------
// INDEX.md generation (deterministic — no timestamps)
// ---------------------------------------------------------------------------

function mdCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function generateIndex(records: MemoryRecord[]): string {
  const active = records.filter((r) => r.status === "active");
  const counts = KINDS
    .map((k) => [k, active.filter((r) => r.kind === k).length] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${k}${n === 1 ? "" : "s"}`.replace("deferreds", "deferred"))
    .join(" · ");

  const lines: string[] = [
    "# Memory Index",
    "",
    "<!-- GENERATED by memory-bank (`memory index`). Do not edit by hand. -->",
    "<!-- Regenerate: npm run memory:index · Verify: npm run memory:check -->",
    "",
    `${active.length} active records${counts ? `: ${counts}` : ""}. Each row is the one-line rule; open the record for the rationale (Why) and how to apply it.`,
    "",
    "| ID | Kind | Rule | Anchors |",
    "|----|------|------|---------|",
  ];
  for (const r of active) {
    const link = `[${r.id}](${path.posix.join("records", KIND_DIR[r.kind], path.posix.basename(r.file))})`;
    const anchors = r.anchors.map((a) => a.path).join(", ");
    lines.push(`| ${link} | ${r.kind} | ${mdCell(r.rule)} | ${mdCell(anchors)} |`);
  }

  const inactive = records.filter((r) => r.status !== "active");
  if (inactive.length > 0) {
    lines.push("", "## Superseded / retired", "");
    for (const r of inactive) {
      const link = `[${r.id}](${path.posix.join("records", KIND_DIR[r.kind], path.posix.basename(r.file))})`;
      lines.push(`- ${link} (${r.status}${r.supersededBy ? ` by ${r.supersededBy}` : ""}): ${mdCell(r.title)}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

function cmdCheck(root: string, opts: { json: boolean; skipCommands: boolean; only?: string }): number {
  if (!fs.existsSync(path.join(root, "memory"))) {
    if (opts.json) console.log(JSON.stringify({ ok: true, records: 0, failures: [] }));
    else console.log("memory check: no memory/ directory — nothing to check (run /memory-bank:init to adopt)");
    return 0;
  }
  const result = runChecks(root, opts);
  const ok = result.failures.length === 0;

  if (opts.json) {
    console.log(JSON.stringify({
      ok,
      records: result.records.length,
      active: result.active.length,
      assertionsRun: result.assertionsRun,
      skippedCommands: result.skippedCommands,
      unverifiable: result.unverifiable,
      indexFresh: result.indexFresh,
      failures: result.failures,
    }, null, 2));
    return ok ? 0 : 1;
  }

  const scope = opts.only ? ` (only ${opts.only})` : "";
  console.log(
    `memory check${scope}: ${result.records.length} records (${result.active.length} active) · ` +
    `${result.assertionsRun} assertions run` +
    (result.skippedCommands ? ` · ${result.skippedCommands} command assertions skipped` : "") +
    (result.unverifiable ? ` · ${result.unverifiable} unverifiable (type: none)` : ""),
  );
  if (ok) {
    console.log("PASS — all assertions hold" + (opts.only ? "" : ", INDEX.md fresh"));
    return 0;
  }
  console.log("");
  for (const f of result.failures) console.log(`FAIL ${f.message}`);
  console.log(`\n${result.failures.length} failure(s).`);
  return 1;
}

function cmdStale(root: string, opts: { json: boolean }): number {
  const { records, errors } = loadRecords(root);
  if (errors.length) {
    for (const e of errors) console.error(`SCHEMA ${e.message}`);
    return 1;
  }
  const active = records.filter((r) => r.status === "active");
  const lastSync = active.map((r) => r.verified?.date ?? "").filter(Boolean).sort().pop() ?? "never";

  // On a shallow clone (CI default: fetch-depth 1) almost no verified sha
  // resolves, so an unresolvable sha means "cannot tell", not "stale". Detect
  // shallowness once up front and keep the two answers separate.
  let shallow = false;
  try {
    shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: root, stdio: "pipe" })
      .toString("utf8").trim() === "true";
  } catch {
    shallow = false;
  }

  const stale: { id: string; reason: string }[] = [];
  const unknown: { id: string; sha: string }[] = [];
  for (const rec of active) {
    const anchorPaths = rec.anchors.map((a) => a.path);
    if (!rec.verified) {
      stale.push({ id: rec.id, reason: "never verified (no verified: stamp)" });
      continue;
    }
    if (anchorPaths.length === 0) continue;
    let sha = rec.verified.sha;
    try {
      execFileSync("git", ["rev-parse", "--verify", "--quiet", `${sha}^{commit}`], { cwd: root, stdio: "pipe" });
    } catch {
      // Unresolvable on a full clone is a real problem (rebased away or a
      // fabricated stamp); on a shallow clone it is simply unknowable.
      if (shallow) unknown.push({ id: rec.id, sha });
      else stale.push({ id: rec.id, reason: `verified sha ${sha} not found in history (clone is complete — rebased away or fabricated stamp?)` });
      continue;
    }
    const changed = execFileSync("git", ["diff", "--name-only", sha, "--", ...anchorPaths], {
      cwd: root, maxBuffer: 16 * 1024 * 1024,
    }).toString("utf8").split("\n").filter(Boolean);
    if (changed.length > 0) {
      stale.push({
        id: rec.id,
        reason: `${changed.length} anchor file(s) changed since ${sha.slice(0, 8)} (${rec.verified.date}): ${changed.slice(0, 3).join(", ")}${changed.length > 3 ? ", …" : ""}`,
      });
    }
  }

  if (opts.json) {
    console.log(JSON.stringify({
      active: active.length,
      staleCount: stale.length,
      unknownCount: unknown.length,
      shallow,
      lastSync,
      stale,
      unknown,
    }, null, 2));
    return 0;
  }

  console.log(
    `${active.length} active records · ${stale.length} stale` +
    (unknown.length ? ` · ${unknown.length} unknown (shallow clone)` : "") +
    ` · last sync ${lastSync}`,
  );
  for (const s of stale) console.log(`STALE ${s.id} — ${s.reason}`);
  if (unknown.length > 0) {
    console.log(`note: shallow clone — ${unknown.length} record(s) could not be checked. Deepen with \`git fetch --unshallow\` for a full staleness report.`);
  }
  return 0;
}

function cmdIndex(root: string): number {
  const { records, errors } = loadRecords(root);
  if (errors.length) {
    for (const e of errors) console.error(`SCHEMA ${e.message}`);
    return 1;
  }
  const indexPath = path.join(root, "memory", "INDEX.md");
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, generateIndex(records));
  console.log(`wrote ${path.relative(root, indexPath)} (${records.length} records)`);
  return 0;
}

function cmdAnchors(root: string, match: string): number {
  const { records } = loadRecords(root);
  let rel = match;
  if (path.isAbsolute(match)) rel = path.relative(root, match);
  rel = rel.split(path.sep).join("/");

  const seen = new Set<string>();
  for (const rec of records.filter((r) => r.status === "active")) {
    for (const a of rec.anchors) {
      if (rel === a.path || rel.startsWith(`${a.path}/`)) {
        if (!seen.has(rec.id)) {
          console.log(`${rec.id}\t${rec.rule}`);
          seen.add(rec.id);
        }
      }
    }
  }
  return 0;
}

function cmdNew(root: string, kind: string, title: string, templatesDir: string): number {
  if (!KINDS.includes(kind as MemoryRecord["kind"])) {
    console.error(`unknown kind '${kind}' — expected one of: ${KINDS.join(", ")}`);
    return 1;
  }
  const k = kind as MemoryRecord["kind"];
  const { records, errors } = loadRecords(root);
  // Don't assign the next ID off a partially-loaded bank — a record failing
  // schema validation could collide or hide that the repo is already broken.
  if (errors.length) {
    for (const e of errors) console.error(`SCHEMA ${e.message}`);
    console.error("refusing to scaffold a new record while the bank has schema errors — fix them first");
    return 1;
  }
  const prefix = KIND_PREFIX[k];
  const max = records
    .filter((r) => r.id.startsWith(`${prefix}-`))
    .map((r) => Number(r.id.slice(prefix.length + 1)))
    .reduce((a, b) => Math.max(a, b), 0);
  const id = `${prefix}-${String(max + 1).padStart(3, "0")}`;
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "untitled";

  const templatePath = path.join(templatesDir, `record-${k}.md`);
  if (!fs.existsSync(templatePath)) {
    console.error(`template not found: ${templatePath}`);
    return 1;
  }
  const today = new Date().toISOString().slice(0, 10);
  const body = fs.readFileSync(templatePath, "utf8")
    .replaceAll("{{ID}}", id)
    .replaceAll("{{TITLE}}", title)
    .replaceAll("{{DATE}}", today);

  const dest = path.join(recordsDir(root), KIND_DIR[k], `${id}-${slug}.md`);
  if (fs.existsSync(dest)) {
    console.error(`refusing to overwrite ${dest}`);
    return 1;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, body);
  console.log(`created ${path.relative(root, dest)}`);
  console.log("next: fill in rule / anchors / assertions, then run `memory index` and `memory check`");
  return 0;
}

function setVerified(root: string, rec: MemoryRecord, date: string, sha: string): void {
  const full = path.join(root, rec.file);
  const lines = fs.readFileSync(full, "utf8").split("\n");
  const { close } = frontmatterBounds(lines, rec.file);

  // Remove any existing verified: block (the key line plus indented children).
  let start = -1;
  let end = -1;
  for (let i = 1; i < close; i += 1) {
    if (/^verified:/.test(lines[i])) {
      start = i;
      end = i + 1;
      while (end < close && /^\s+\S/.test(lines[end])) end += 1;
      break;
    }
  }
  const block = ["verified:", `  date: ${date}`, `  sha: ${sha}`];
  if (start !== -1) lines.splice(start, end - start, ...block);
  else lines.splice(close, 0, ...block);
  fs.writeFileSync(full, lines.join("\n"));
}

function cmdSync(root: string, opts: { skipCommands: boolean; only?: string; all?: boolean }): number {
  // 1. Validate the scope BEFORE touching the disk — an error path must leave
  //    the bank (including INDEX.md) byte-for-byte untouched.
  if (opts.only && opts.all) {
    console.error("--only and --all are mutually exclusive — pass --all to stamp every active record, or --only <id> to stamp one");
    return 2;
  }
  if (opts.only || !opts.all) {
    const { records, errors } = loadRecords(root);
    if (errors.length) {
      for (const e of errors) console.error(`SCHEMA ${e.message}`);
      return 1;
    }
    if (!opts.only) {
      // Blanket stamping is opt-in: re-stamping everything silently destroys
      // the review state of records nobody actually looked at.
      const n = records.filter((r) => r.status === "active").length;
      console.error(`sync would stamp verified: on ${n} active record(s) — pass --all to stamp everything, or --only <id> to stamp one`);
      return 2;
    }
    // Same semantics as runChecks' only-block: a typo or a retired id must be
    // a loud error, not a no-op stamp.
    const target = records.find((r) => r.id === opts.only);
    if (!target) {
      console.error(`${opts.only}: unknown record — no record with that id exists`);
      return 1;
    }
    if (target.status !== "active") {
      console.error(`${opts.only} (${target.file}): record status is '${target.status}', not active — nothing to verify`);
      return 1;
    }
  }

  // 2. Regenerate the index so the freshness gate can't fail the sync.
  const indexCode = cmdIndex(root);
  if (indexCode !== 0) return indexCode;

  // 3. Full check — never stamp records that are failing. Deliberately NOT
  //    scoped to --only: a single record must never go green while the bank
  //    as a whole is failing.
  const result = runChecks(root, { skipCommands: opts.skipCommands });
  if (result.failures.length > 0) {
    for (const f of result.failures) console.log(`FAIL ${f.message}`);
    console.log(`\nsync aborted: ${result.failures.length} failure(s) — fix them first`);
    return 1;
  }

  // 4. Stamp.
  const date = new Date().toISOString().slice(0, 10);
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root }).toString("utf8").trim();
  const targets = opts.only ? result.active.filter((r) => r.id === opts.only) : result.active;
  for (const rec of targets) setVerified(root, rec, date, sha);
  console.log(
    `stamped verified: { date: ${date}, sha: ${sha.slice(0, 12)} } on ${targets.length} of ${result.active.length} active record(s)` +
    (opts.only ? ` (--only ${opts.only})` : ""),
  );
  if (opts.skipCommands && result.skippedCommands > 0) {
    console.log(`note: ${result.skippedCommands} command assertion(s) were skipped (--skip-commands)`);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function resolveRoot(explicit?: string): string {
  if (explicit) return path.resolve(explicit);
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { stdio: "pipe" }).toString("utf8").trim();
  } catch {
    return process.cwd();
  }
}

function main(): number {
  const argv = process.argv.slice(2);
  const flags = new Map<string, string | boolean>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--json" || a === "--skip-commands" || a === "--all") flags.set(a, true);
    else if (a === "--root" || a === "--match" || a === "--title" || a === "--only") {
      flags.set(a, argv[i + 1] ?? "");
      i += 1;
    } else positional.push(a);
  }

  const cmd = positional[0];
  const root = resolveRoot(flags.get("--root") as string | undefined);
  const templatesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "templates");

  switch (cmd) {
    case "check":
      return cmdCheck(root, {
        json: flags.get("--json") === true,
        skipCommands: flags.get("--skip-commands") === true,
      });
    case "verify": {
      const id = positional[1] ?? (flags.get("--only") as string | undefined);
      if (!id) { console.error("usage: memory verify <id>"); return 2; }
      return cmdCheck(root, { json: flags.get("--json") === true, skipCommands: false, only: id });
    }
    case "stale":
      return cmdStale(root, { json: flags.get("--json") === true });
    case "index":
      return cmdIndex(root);
    case "anchors": {
      const match = flags.get("--match") as string | undefined;
      if (!match) { console.error("usage: memory anchors --match <file>"); return 2; }
      return cmdAnchors(root, match);
    }
    case "new": {
      const kind = positional[1];
      const title = flags.get("--title") as string | undefined;
      if (!kind || !title) { console.error('usage: memory new <kind> --title "..."'); return 2; }
      return cmdNew(root, kind, title, templatesDir);
    }
    case "sync":
      return cmdSync(root, {
        skipCommands: flags.get("--skip-commands") === true,
        only: flags.get("--only") as string | undefined,
        all: flags.get("--all") === true,
      });
    default:
      console.error(
        "usage: memory <check|verify|stale|index|anchors|new|sync> [options]\n" +
        "  check    [--json] [--skip-commands]   verify all records + INDEX freshness (exit 1 on drift)\n" +
        "  verify   <id>                         verify a single record\n" +
        "  stale    —                            records whose anchors changed since last verified sha\n" +
        "  index    —                            regenerate memory/INDEX.md\n" +
        "  anchors  --match <file>               record IDs anchored to a file (TSV: id, rule)\n" +
        '  new      <kind> --title "..."         scaffold a record (decision|convention|fact|feature|deferred)\n' +
        "  sync     --all | --only <id> [--skip-commands]  green check, then stamp verified: (--all: every active record; --only: one)\n" +
        "  common: --root <dir> (default: git toplevel)",
      );
      return 2;
  }
}

process.exit(main());
