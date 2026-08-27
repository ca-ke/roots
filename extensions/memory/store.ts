/**
 * Store — JSONL persistence, rooted at the study project.
 *
 *   learning/cards.jsonl    the QUEUE: one line per card, current state
 *   learning/history.jsonl  the LOG: one line per review, append-only
 *   learning/graph.jsonl    the GRAPH: one line per node, current state
 *
 * The rule that defines the first two files:
 *
 *   When a card is reviewed, its old line is REMOVED and the new one is
 *   written. The review event goes to the history, which never loses anything.
 *
 * That keeps `cards.jsonl` a single source of truth about the present — you can
 * open the file and see exactly what is pending, with no replay to reconstruct
 * it — while `history.jsonl` preserves everything that ever happened, which is
 * where the right/wrong rates come from.
 *
 * Why JSONL and not a database: it is readable, it diffs in git, and one
 * corrupt line does not take the file down with it.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export const DIR = "learning";
const CARDS_FILE = "cards.jsonl";
const HISTORY_FILE = "history.jsonl";
const GRAPH_FILE = "graph.jsonl";

export interface Card {
	id: string;
	topic: string;
	/** Node of the dependency graph this card belongs to. */
	node?: string;
	question: string;
	answer: string;
	/** The wrong mental model this card exists to dissolve, if any. */
	misconception?: string;
	created: string;

	// FSRS state
	stability?: number;
	difficulty?: number;
	lastReview?: string;
	due: string;
	interval: number;

	// Aggregate history — this is what priority is computed from
	reps: number;
	lapses: number;
	correct: number;
	wrong: number;
	unknown: number;
	/** The last 8 grades, most recent last. */
	recentGrades: number[];
}

export interface Review {
	card: string;
	ts: string;
	grade: number;
	correct: boolean;
	unknown: boolean;
	topic: string;
	node?: string;
	/** Estimated retrievability at review time. */
	r: number | null;
	intervalBefore: number;
	intervalAfter: number;
	stability: number;
	difficulty: number;
	/** What the learner got wrong, when it can be recorded. */
	note?: string;
}

export interface Node {
	id: string;
	label: string;
	topic: string;
	/** `root` = unconditional truth; `derived` = built on other nodes. */
	kind: "root" | "derived";
	/** ids of the nodes this one depends on. */
	dependsOn: string[];
	established: string;
}

// ─── JSONL read/write ────────────────────────────────────────────────────────

const filePath = (cwd: string, file: string) => path.join(cwd, DIR, file);

function ensureDir(cwd: string) {
	fs.mkdirSync(path.join(cwd, DIR), { recursive: true });
}

function readJsonl<T>(file: string): T[] {
	if (!fs.existsSync(file)) return [];
	const out: T[] = [];
	for (const line of fs.readFileSync(file, "utf8").split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			out.push(JSON.parse(trimmed) as T);
		} catch {
			// One corrupt line does not invalidate the whole file. Skip it.
		}
	}
	return out;
}

/** Rewrite the whole file through a temp file + rename, so it stays atomic. */
function writeJsonl<T>(file: string, records: T[]) {
	const tmp = `${file}.tmp`;
	const body = records.map((r) => JSON.stringify(r)).join("\n");
	fs.writeFileSync(tmp, body ? `${body}\n` : "", "utf8");
	fs.renameSync(tmp, file);
}

function appendJsonl<T>(file: string, record: T) {
	fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
}

// ─── API ─────────────────────────────────────────────────────────────────────

export class Store {
	constructor(private readonly cwd: string) {}

	get dir() {
		return path.join(this.cwd, DIR);
	}

	readCards(): Card[] {
		return readJsonl<Card>(filePath(this.cwd, CARDS_FILE));
	}

	readHistory(): Review[] {
		return readJsonl<Review>(filePath(this.cwd, HISTORY_FILE));
	}

	readGraph(): Node[] {
		return readJsonl<Node>(filePath(this.cwd, GRAPH_FILE));
	}

	addCard(
		data: Pick<Card, "topic" | "question" | "answer"> &
			Partial<Pick<Card, "node" | "misconception">>,
	): Card {
		ensureDir(this.cwd);
		const now = new Date().toISOString();
		const card: Card = {
			id: newId(),
			topic: data.topic,
			node: data.node,
			question: data.question,
			answer: data.answer,
			misconception: data.misconception,
			created: now,
			// Born due: a freshly written card should be tested immediately.
			due: now,
			interval: 0,
			reps: 0,
			lapses: 0,
			correct: 0,
			wrong: 0,
			unknown: 0,
			recentGrades: [],
		};
		appendJsonl(filePath(this.cwd, CARDS_FILE), card);
		return card;
	}

	/**
	 * Replace a card in the queue: drop the old line, write the new one, and log
	 * the event. This function is the module's rule, in code.
	 */
	replaceCard(card: Card, review: Review) {
		ensureDir(this.cwd);
		const rest = this.readCards().filter((c) => c.id !== card.id);
		rest.push(card);
		writeJsonl(filePath(this.cwd, CARDS_FILE), rest);
		appendJsonl(filePath(this.cwd, HISTORY_FILE), review);
	}

	deleteCard(id: string): boolean {
		const cards = this.readCards();
		const rest = cards.filter((c) => c.id !== id);
		if (rest.length === cards.length) return false;
		writeJsonl(filePath(this.cwd, CARDS_FILE), rest);
		return true;
	}

	/** Insert or update a graph node (last write wins). */
	putNode(node: Omit<Node, "established"> & { established?: string }): Node {
		ensureDir(this.cwd);
		const full: Node = {
			...node,
			established: node.established ?? new Date().toISOString(),
		};
		const nodes = this.readGraph().filter((n) => n.id !== full.id);
		nodes.push(full);
		writeJsonl(filePath(this.cwd, GRAPH_FILE), nodes);
		return full;
	}
}

let counter = 0;
function newId(): string {
	counter += 1;
	const t = Date.now().toString(36);
	const r = Math.random().toString(36).slice(2, 6);
	return `c${t}${r}${counter.toString(36)}`;
}
