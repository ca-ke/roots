/**
 * Cyclomatic complexity lint.
 *
 * McCabe's measure: the number of linearly independent paths through a
 * function, which is one plus the number of decision points in it. It is a
 * proxy for two things that matter here — how many cases a reader has to hold
 * at once, and the minimum number of tests needed to cover the function.
 *
 * Counted as decision points:
 *
 *   if                      each `if`; an `else if` is a nested if, so it counts
 *   ?:                      the conditional expression
 *   for / for-in / for-of   each loop head
 *   while / do-while        each loop head
 *   case                    each case clause; `default` is not a decision
 *   catch                   each catch clause
 *   && || ??                each short-circuit, since each one is a branch
 *
 * Deliberately NOT counted:
 *
 *   else / finally          no branch of their own, they are the fall-through
 *   ?.                      a branch in the runtime sense, but counting it
 *                           punishes the safe form of a property access and
 *                           pushes code toward the unsafe one
 *
 * Nested functions are measured on their own and do not roll up into the
 * function that encloses them — a parent holding three small callbacks is not
 * as hard to read as one body with the same total branching, and rolling up
 * would say otherwise.
 *
 * Usage:
 *   npx tsx scripts/complexity.ts [paths...] [--max N] [--top N] [--json]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";

const DEFAULT_PATHS = ["extensions", "lib", "scripts", "test"];
const DEFAULT_MAX = 10;

interface Entry {
	file: string;
	line: number;
	name: string;
	complexity: number;
}

// ─── walking the tree ────────────────────────────────────────────────────────

const FUNCTION_KINDS = new Set<ts.SyntaxKind>([
	ts.SyntaxKind.FunctionDeclaration,
	ts.SyntaxKind.FunctionExpression,
	ts.SyntaxKind.ArrowFunction,
	ts.SyntaxKind.MethodDeclaration,
	ts.SyntaxKind.Constructor,
	ts.SyntaxKind.GetAccessor,
	ts.SyntaxKind.SetAccessor,
]);

/** `default:` is where control lands when nothing matched, so it is not here. */
const BRANCHING_KINDS = new Set<ts.SyntaxKind>([
	ts.SyntaxKind.IfStatement,
	ts.SyntaxKind.ConditionalExpression,
	ts.SyntaxKind.ForStatement,
	ts.SyntaxKind.ForInStatement,
	ts.SyntaxKind.ForOfStatement,
	ts.SyntaxKind.WhileStatement,
	ts.SyntaxKind.DoStatement,
	ts.SyntaxKind.CatchClause,
	ts.SyntaxKind.CaseClause,
]);

const SHORT_CIRCUIT_OPERATORS = new Set<ts.SyntaxKind>([
	ts.SyntaxKind.AmpersandAmpersandToken,
	ts.SyntaxKind.BarBarToken,
	ts.SyntaxKind.QuestionQuestionToken,
]);

const isFunctionLike = (node: ts.Node) => FUNCTION_KINDS.has(node.kind);

/** Decision points contributed by this node itself, ignoring its children. */
function decisionPoints(node: ts.Node): number {
	if (BRANCHING_KINDS.has(node.kind)) return 1;
	if (
		ts.isBinaryExpression(node) &&
		SHORT_CIRCUIT_OPERATORS.has(node.operatorToken.kind)
	) {
		return 1;
	}
	return 0;
}

/**
 * Complexity of one function body. Stops at nested function boundaries so each
 * function is scored on the branching it actually contains.
 */
function complexityOf(fn: ts.Node): number {
	let total = 1;
	const visit = (node: ts.Node) => {
		if (node !== fn && isFunctionLike(node)) return;
		total += decisionPoints(node);
		ts.forEachChild(node, visit);
	};
	ts.forEachChild(fn, visit);
	return total;
}

const MEMBER_KINDS = new Set<ts.SyntaxKind>([
	ts.SyntaxKind.MethodDeclaration,
	ts.SyntaxKind.GetAccessor,
	ts.SyntaxKind.SetAccessor,
]);

/** The enclosing class name with a trailing dot, or "" for a bare function. */
function ownerPrefix(node: ts.Node): string {
	const cls = node.parent;
	return ts.isClassLike(cls) && cls.name ? `${cls.name.text}.` : "";
}

function memberName(node: ts.Node): string {
	const own = (node as ts.NamedDeclaration).name;
	const label = own && ts.isIdentifier(own) ? own.text : "?";
	const accessor = ts.isGetAccessor(node) ? "get " : ts.isSetAccessor(node) ? "set " : "";
	return `${accessor}${ownerPrefix(node)}${label}`;
}

/** The identifier an anonymous function is bound to, if there is one. */
function boundName(parent: ts.Node): string | null {
	const binds =
		ts.isVariableDeclaration(parent) ||
		ts.isPropertyAssignment(parent) ||
		ts.isPropertyDeclaration(parent);
	if (binds && ts.isIdentifier(parent.name)) return parent.name.text;
	return null;
}

/** A callback passed straight to a call takes the name of that call. */
function callbackName(parent: ts.Node): string | null {
	if (!ts.isCallExpression(parent)) return null;
	const callee = parent.expression;
	if (ts.isPropertyAccessExpression(callee)) return `${callee.name.text}() callback`;
	if (ts.isIdentifier(callee)) return `${callee.text}() callback`;
	return "call() callback";
}

/** A readable name: `Class.method`, `owner.prop`, or the declaration's own. */
function nameOf(node: ts.Node): string {
	if (ts.isConstructorDeclaration(node)) return `${ownerPrefix(node)}constructor`;
	if (MEMBER_KINDS.has(node.kind)) return memberName(node);
	if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;

	const parent = node.parent;
	if (!parent) return "<anonymous>";
	return boundName(parent) ?? callbackName(parent) ?? "<anonymous>";
}

function analyze(file: string): Entry[] {
	const source = ts.createSourceFile(
		file,
		fs.readFileSync(file, "utf8"),
		ts.ScriptTarget.Latest,
		true,
	);

	const entries: Entry[] = [];
	const visit = (node: ts.Node) => {
		if (isFunctionLike(node)) {
			const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
			entries.push({
				file,
				line: line + 1,
				name: nameOf(node),
				complexity: complexityOf(node),
			});
		}
		ts.forEachChild(node, visit);
	};
	ts.forEachChild(source, visit);
	return entries;
}

// ─── collecting files ────────────────────────────────────────────────────────

function collect(target: string, found: string[] = []): string[] {
	let stat: fs.Stats;
	try {
		stat = fs.statSync(target);
	} catch {
		console.error(`skipped (not found): ${target}`);
		return found;
	}

	if (stat.isFile()) {
		if (target.endsWith(".ts") && !target.endsWith(".d.ts")) found.push(target);
		return found;
	}

	for (const name of fs.readdirSync(target).sort()) {
		if (name === "node_modules" || name.startsWith(".")) continue;
		collect(path.join(target, name), found);
	}
	return found;
}

// ─── reporting ───────────────────────────────────────────────────────────────

interface Options {
	paths: string[];
	max: number;
	top: number;
	json: boolean;
}

function parseArgs(argv: string[]): Options {
	const options: Options = { paths: [], max: DEFAULT_MAX, top: 10, json: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--json") options.json = true;
		else if (arg === "--max") options.max = Number(argv[++i]);
		else if (arg === "--top") options.top = Number(argv[++i]);
		else options.paths.push(arg);
	}
	if (options.paths.length === 0) options.paths = DEFAULT_PATHS;
	if (!Number.isFinite(options.max) || options.max < 1) {
		throw new Error("--max must be a positive number");
	}
	return options;
}

/** Complexity 1-5 reads as plain, 6-10 as branchy, above that as a problem. */
function band(complexity: number, max: number): string {
	if (complexity > max) return "over";
	if (complexity > max * 0.6) return "watch";
	return "ok";
}

function main() {
	const options = parseArgs(process.argv.slice(2));

	const files = options.paths.flatMap((p) => collect(p));
	const entries = files.flatMap(analyze);

	if (entries.length === 0) {
		console.log("No functions found.");
		return 0;
	}

	entries.sort((a, b) => b.complexity - a.complexity || a.file.localeCompare(b.file));
	const over = entries.filter((e) => e.complexity > options.max);

	if (options.json) {
		console.log(JSON.stringify({ max: options.max, entries, over }, null, 2));
		return over.length > 0 ? 1 : 0;
	}

	const total = entries.reduce((sum, e) => sum + e.complexity, 0);
	const mean = total / entries.length;

	console.log(
		`${entries.length} functions in ${files.length} files · mean ${mean.toFixed(1)} · max ${entries[0].complexity} · threshold ${options.max}\n`,
	);

	const shown = entries.slice(0, Math.max(options.top, over.length));
	const width = Math.max(...shown.map((e) => `${e.file}:${e.line}`.length));
	for (const e of shown) {
		const where = `${e.file}:${e.line}`.padEnd(width);
		const mark = band(e.complexity, options.max);
		const flag = mark === "over" ? " ✗" : mark === "watch" ? " ~" : "";
		console.log(`  ${String(e.complexity).padStart(3)}  ${where}  ${e.name}${flag}`);
	}

	if (over.length === 0) {
		console.log(`\nAll functions at or under ${options.max}.`);
		return 0;
	}

	console.log(
		`\n${over.length} function${over.length === 1 ? "" : "s"} over ${options.max}:`,
	);
	for (const e of over) {
		console.log(`  ${e.file}:${e.line} ${e.name} (${e.complexity})`);
	}
	return 1;
}

process.exit(main());
