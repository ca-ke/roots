/**
 * Renders agent definitions from YAML to the markdown subagents actually load.
 *
 * An agent is authored as one YAML document — metadata at the top, the whole
 * system prompt in a `prompt: |` block — so that everything about the agent
 * lives in a single file with a single syntax. Subagent implementations do not
 * read that: pi-interactive-subagents looks for `.md` with YAML frontmatter and
 * treats the body as the prompt. This script bridges the two, and `--check`
 * fails when the rendered `.md` no longer matches its source, so the generated
 * file cannot quietly become the thing someone edits.
 *
 * The YAML accepted here is deliberately the narrow subset the format needs:
 * `# comments`, blank lines, flat `key: value` scalars, and one `prompt: |`
 * literal block, which must come last. Anything else is an error rather than a
 * silent misread — a real parser would be a dependency this package does not
 * otherwise have, and guessing at YAML is how prompts get corrupted.
 *
 * Usage:
 *   npx tsx scripts/agents.ts [--check] [paths...]
 */

import * as fs from "node:fs";
import * as path from "node:path";

const DEFAULT_DIR = "agents";
const BLOCK_KEY = "prompt";
const GENERATED_NOTE = (source: string) =>
	`# Generated from ${source} by \`npm run agents\`. Edit the YAML, not this file.`;

interface Agent {
	/** Frontmatter keys, in the order they were written. */
	fields: [string, string][];
	prompt: string;
}

// ─── reading the YAML subset ─────────────────────────────────────────────────

const isSkippable = (line: string) => line.trim() === "" || line.trimStart().startsWith("#");

/** Splits `key: value`, rejecting anything nested or otherwise unsupported. */
function parseField(line: string, where: string): [string, string] {
	if (line.startsWith(" ") || line.startsWith("\t")) {
		throw new Error(`${where}: nested keys are not supported — ${line.trim()}`);
	}
	const colon = line.indexOf(":");
	if (colon === -1) throw new Error(`${where}: expected \`key: value\` — ${line}`);
	return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
}

/**
 * Undoes the two-space indent of a literal block. Blank lines carry no indent
 * of their own, so they pass through; anything else that is short of the indent
 * would change meaning if it were dedented anyway, so it is refused.
 */
function dedent(lines: string[], where: string): string {
	const out = lines.map((line) => {
		if (line.trim() === "") return "";
		if (!line.startsWith("  ")) throw new Error(`${where}: under-indented block line — ${line}`);
		return line.slice(2);
	});
	while (out.length > 0 && out[out.length - 1] === "") out.pop();
	return out.join("\n");
}

function parseAgent(text: string, where: string): Agent {
	const lines = text.split("\n");
	const fields: [string, string][] = [];

	for (let i = 0; i < lines.length; i++) {
		if (isSkippable(lines[i])) continue;

		const [key, value] = parseField(lines[i], `${where}:${i + 1}`);
		if (key !== BLOCK_KEY) {
			fields.push([key, value]);
			continue;
		}
		if (value !== "|") throw new Error(`${where}:${i + 1}: \`${BLOCK_KEY}\` must be a \`|\` block`);
		return { fields, prompt: dedent(lines.slice(i + 1), where) };
	}
	throw new Error(`${where}: no \`${BLOCK_KEY}: |\` block`);
}

// ─── rendering ───────────────────────────────────────────────────────────────

function render(agent: Agent, source: string): string {
	const frontmatter = agent.fields.map(([key, value]) => `${key}: ${value}`);
	return ["---", GENERATED_NOTE(source), ...frontmatter, "---", "", agent.prompt, ""].join("\n");
}

function sources(target: string): string[] {
	if (fs.statSync(target).isFile()) return [target];
	return fs
		.readdirSync(target)
		.filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"))
		.sort()
		.map((name) => path.join(target, name));
}

// ─── driving ─────────────────────────────────────────────────────────────────

interface Result {
	file: string;
	stale: boolean;
}

function renderFile(source: string, check: boolean): Result {
	const out = source.replace(/\.ya?ml$/, ".md");
	const wanted = render(parseAgent(fs.readFileSync(source, "utf8"), source), path.basename(source));
	const current = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : null;

	if (current === wanted) return { file: out, stale: false };
	if (!check) fs.writeFileSync(out, wanted);
	return { file: out, stale: true };
}

/** `--check` reports drift instead of fixing it, for CI and `npm run check`. */
function reportDrift(results: Result[]): number {
	const stale = results.filter((r) => r.stale);
	if (stale.length === 0) {
		console.log(`${results.length} agent${results.length === 1 ? "" : "s"} up to date.`);
		return 0;
	}
	for (const r of stale) console.error(`stale: ${r.file}`);
	console.error("\nRun `npm run agents` and commit the result.");
	return 1;
}

function main(): number {
	const argv = process.argv.slice(2);
	const check = argv.includes("--check");
	const paths = argv.filter((arg) => arg !== "--check");
	const files = (paths.length > 0 ? paths : [DEFAULT_DIR]).flatMap(sources);

	if (files.length === 0) {
		console.error("No agent definitions found.");
		return 1;
	}

	const results = files.map((file) => renderFile(file, check));
	if (check) return reportDrift(results);

	for (const r of results) console.log(`${r.stale ? "wrote" : "unchanged"}  ${r.file}`);
	return 0;
}

try {
	process.exit(main());
} catch (error) {
	// A malformed definition is a content mistake, not a crash: print what is
	// wrong with which line, and skip the stack trace nobody needs.
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
