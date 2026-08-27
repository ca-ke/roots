/**
 * memory — the layer that makes the teaching system stateful.
 *
 * Everything the learner has been taught, everything they got wrong, and the
 * dependency graph the lessons built lives in `learning/*.jsonl` next to the
 * project. Sessions come and go; this does not.
 *
 * Tools registered:
 *   memory_add     write a card (question + the answer it must reproduce)
 *   memory_queue   what is due, ordered by how badly it needs review
 *   memory_grade   record a review; reschedules the card via FSRS
 *   memory_report  right/wrong rates, weakest topics, open misconceptions
 *   memory_graph   read or extend the dependency graph across topics
 *
 * Commands: /queue, /report
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

import { queue } from "./priority.ts";
import { render } from "./report.ts";
import { applyReview, describeSchedule } from "./review.ts";
import { type Grade } from "./fsrs.ts";
import { type Card, Store } from "./store.ts";

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }], details: {} });

/** Compact one-line rendering of a due card, for the model and the terminal. */
function summarize(card: Card & { priority: number; reason: string }): string {
	const where = card.node ? `${card.topic} › ${card.node}` : card.topic;
	return `[${card.id}] p${card.priority} · ${where} · ${card.reason}\n    Q: ${card.question}\n    A: ${card.answer}`;
}

export default function memory(pi: ExtensionAPI) {
	let store: Store | null = null;
	const getStore = (cwd: string) => {
		if (!store) store = new Store(cwd);
		return store;
	};

	// ─── status line: how much is waiting ────────────────────────────────────

	function refreshStatus(ctx: { cwd: string; ui: any }) {
		try {
			const due = queue(getStore(ctx.cwd).readCards()).length;
			ctx.ui.setStatus(
				"memory",
				due === 0
					? undefined
					: ctx.ui.theme.fg("accent", "◆ ") +
							ctx.ui.theme.fg("dim", `${due} due`),
			);
		} catch {
			// The status line is a nicety; never let it break a session.
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		refreshStatus(ctx as any);
	});

	// ─── tools ───────────────────────────────────────────────────────────────

	pi.registerTool({
		name: "memory_add",
		label: "Remember",
		description:
			"Store a question the learner should still be able to answer weeks from now. " +
			"The card is created due immediately, so it should be quiz-checked in the same session. " +
			"Set `misconception` when the card exists to dissolve a specific wrong model the learner holds.",
		promptSnippet:
			"Store a durable question/answer card tied to a topic and graph node",
		parameters: Type.Object({
			topic: Type.String({ description: "Subject, e.g. 'TCP' or 'eigenvalues'" }),
			question: Type.String({ description: "Asked exactly as written, later" }),
			answer: Type.String({ description: "What counts as knowing it" }),
			node: Type.Optional(
				Type.String({ description: "Graph node id this card belongs to" }),
			),
			misconception: Type.Optional(
				Type.String({ description: "The wrong model this card must dislodge" }),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const card = getStore(ctx.cwd).addCard(params);
			refreshStatus(ctx as any);
			return text(`Card ${card.id} stored (due now).`);
		},
	});

	pi.registerTool({
		name: "memory_queue",
		label: "Review queue",
		description:
			"Cards that are due, ordered by how badly they need review — a blend of the learner's " +
			"error rate on the card, how overdue it is relative to its own interval, how often it has " +
			"been forgotten, and whether it carries an unresolved misconception.",
		promptSnippet: "List due cards ordered by review priority",
		parameters: Type.Object({
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
			topic: Type.Optional(Type.String()),
			include_future: Type.Optional(
				Type.Boolean({ description: "Also list cards that are not due yet" }),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const cards = queue(getStore(ctx.cwd).readCards(), new Date(), {
				limit: params.limit ?? 10,
				topic: params.topic,
				includeFuture: params.include_future,
			});
			if (cards.length === 0) return text("Nothing due.");
			return text(cards.map(summarize).join("\n\n"));
		},
	});

	pi.registerTool({
		name: "memory_grade",
		label: "Grade",
		description:
			"Record a review of a card and reschedule it. Grades: 1 missed it, 2 got it but " +
			"struggled, 3 got it, 4 got it instantly and could extend it. Prefer letting `quiz` grade " +
			"cards automatically; use this when the check happened in conversation instead.",
		promptSnippet: "Record a card review (grade 1-4) and reschedule it",
		parameters: Type.Object({
			card: Type.String({ description: "Card id" }),
			grade: Type.Integer({ minimum: 1, maximum: 4 }),
			unknown: Type.Optional(
				Type.Boolean({
					description: "The learner said they did not know, rather than guessing wrong",
				}),
			),
			note: Type.Optional(
				Type.String({ description: "What they answered, when it is diagnostic" }),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const result = applyReview(
				getStore(ctx.cwd),
				params.card,
				params.grade as Grade,
				{ unknown: params.unknown, note: params.note },
			);
			if (!result) return text(`No card with id ${params.card}.`);
			refreshStatus(ctx as any);
			const lapse = result.lapse ? " (lapse — it had been learned and was forgotten)" : "";
			return text(`Next review in ${describeSchedule(result.card)}${lapse}.`);
		},
	});

	pi.registerTool({
		name: "memory_report",
		label: "Report",
		description:
			"What the learner most needs to review, derived from their right/wrong record: the " +
			"highest-priority due cards, the topics with the worst accuracy, and misconceptions that " +
			"are still open. Read this before planning a lesson — it says where the gaps actually are.",
		promptSnippet: "Report on weakest topics, due cards, and open misconceptions",
		parameters: Type.Object({
			topic: Type.Optional(Type.String()),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			return text(render(getStore(ctx.cwd), new Date(), params.topic));
		},
	});

	pi.registerTool({
		name: "memory_graph",
		label: "Graph",
		description:
			"The learner's dependency graph, persisted across sessions. `list` returns what is already " +
			"established, so a new lesson can hang off it instead of restating it. `put` records a node " +
			"once it has been taught and confirmed — roots are unconditional truths, derived nodes name " +
			"what they were built from.",
		promptSnippet: "Read or extend the learner's persistent dependency graph",
		parameters: Type.Object({
			action: StringEnum(["list", "put"] as const),
			id: Type.Optional(Type.String({ description: "Node id, kebab-case" })),
			label: Type.Optional(Type.String({ description: "The claim, in one line" })),
			topic: Type.Optional(Type.String()),
			kind: Type.Optional(StringEnum(["root", "derived"] as const)),
			depends_on: Type.Optional(Type.Array(Type.String())),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const s = getStore(ctx.cwd);

			if (params.action === "list") {
				const nodes = s
					.readGraph()
					.filter((n) => !params.topic || n.topic === params.topic);
				if (nodes.length === 0) return text("The graph is empty.");
				return text(
					nodes
						.map((n) => {
							const deps = n.dependsOn.length
								? ` ← ${n.dependsOn.join(", ")}`
								: "";
							return `${n.id} [${n.kind}] (${n.topic}) ${n.label}${deps}`;
						})
						.join("\n"),
				);
			}

			if (!params.id || !params.label || !params.topic || !params.kind) {
				return text("put requires id, label, topic, and kind.");
			}
			const node = s.putNode({
				id: params.id,
				label: params.label,
				topic: params.topic,
				kind: params.kind,
				dependsOn: params.depends_on ?? [],
			});
			return text(`Node ${node.id} recorded.`);
		},
	});

	// ─── commands ────────────────────────────────────────────────────────────

	pi.registerCommand("queue", {
		description: "Show the review queue, most urgent first",
		handler: async (args, ctx) => {
			const cards = queue(getStore(ctx.cwd).readCards(), new Date(), {
				limit: 20,
				topic: args?.trim() || undefined,
			});
			ctx.ui.notify(
				cards.length === 0
					? "Nothing due."
					: cards.map(summarize).join("\n\n"),
				"info",
			);
		},
	});

	pi.registerCommand("report", {
		description: "What most needs review, by error rate and topic",
		handler: async (args, ctx) => {
			ctx.ui.notify(
				render(getStore(ctx.cwd), new Date(), args?.trim() || undefined),
				"info",
			);
		},
	});
}
