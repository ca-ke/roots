/**
 * quiz — a graded question.
 *
 * The difference from an ordinary question is that this one has a right answer,
 * so the harness can grade it instead of the model guessing whether the learner
 * understood. That matters twice over:
 *
 *   1. During probing, a graded miss tells you exactly WHERE understanding runs
 *      out, not merely that it does.
 *   2. During review, the grade is the FSRS signal. A quiz tied to a card
 *      reschedules it automatically — the teaching loop and the memory layer
 *      are the same act, not two chores.
 *
 * Options are shuffled before display, and "I don't know" is always present and
 * never shuffled. An honest "I don't know" is a different signal from a wrong
 * guess: it means the knowledge was absent, not corrupted, and the two call for
 * different teaching. It is recorded separately.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { applyReview, describeSchedule } from "./memory/review.ts";
import { Store } from "./memory/store.ts";
import type { Grade } from "./memory/fsrs.ts";

const DONT_KNOW = "I don't know";

const text = (s: string, details: Record<string, unknown> = {}) => ({
	content: [{ type: "text" as const, text: s }],
	details,
});

function shuffle<T>(items: T[]): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

export default function quiz(pi: ExtensionAPI) {
	pi.registerTool({
		name: "quiz",
		label: "Quiz",
		description:
			"Ask the learner a question that has a right answer, grade it instantly, and show them " +
			"the outcome. Use it for every understanding check: probing where their knowledge ends, " +
			"confirming a node landed, and running spaced review. " +
			"Write every option as a bare claim with no reasoning attached — all the 'why' belongs in " +
			"`explanation`, which is shown only after they answer. Build each distractor by mutating " +
			"the correct claim into what someone holding a specific misconception would say, keeping " +
			"the same shape, length, and register, so no option is identifiable as correct without " +
			"knowing the material. " +
			"Set `remember: true` when the answer should still be known weeks from now: the question " +
			"becomes a scheduled card. Pass `card` to review an existing one. " +
			"For questions with no right answer — what to learn next, which direction to take — do not " +
			"use quiz; just ask in conversation.",
		promptSnippet:
			"Ask a graded multiple-choice question; optionally schedule it for spaced review",
		promptGuidelines: [
			"Use quiz for any check that has a right answer, rather than asking the learner to self-assess.",
			"Use quiz with remember: true when the fact should survive past this session.",
		],
		parameters: Type.Object({
			question: Type.String(),
			options: Type.Array(Type.String(), {
				minItems: 2,
				maxItems: 6,
				description: "Bare claims, no justifications, parallel in shape and length",
			}),
			correct: Type.Integer({
				minimum: 1,
				description: "1-based index into `options` as written here (display is shuffled)",
			}),
			context: Type.Optional(
				Type.String({ description: "One line of setup shown above the question" }),
			),
			explanation: Type.Optional(
				Type.String({ description: "Shown only after answering" }),
			),
			card: Type.Optional(
				Type.String({ description: "Id of an existing card this question reviews" }),
			),
			remember: Type.Optional(
				Type.Boolean({ description: "Create a scheduled card from this question" }),
			),
			topic: Type.Optional(Type.String({ description: "Required when remember is true" })),
			node: Type.Optional(Type.String({ description: "Graph node id this belongs to" })),
			misconception: Type.Optional(
				Type.String({ description: "The wrong model this question exists to dislodge" }),
			),
		}),

		async execute(_id, params, _signal, _onUpdate, ctx) {
			if (params.correct < 1 || params.correct > params.options.length) {
				return text(
					`correct must be between 1 and ${params.options.length}.`,
					{ error: true },
				);
			}
			if (!ctx.hasUI) {
				return text(
					"No interactive UI available — ask the question in the conversation instead, " +
						"then record the outcome with memory_grade.",
					{ error: true },
				);
			}

			const answer = params.options[params.correct - 1];
			const shown = shuffle(params.options);
			// Numbering makes each entry unique, so identical labels stay distinguishable
			// when matching the returned string back to an option.
			const labels = shown.map((o, i) => `${i + 1}. ${o}`);

			const title = params.context
				? `${params.question}\n\n${params.context}`
				: params.question;

			const picked = await ctx.ui.select(title, [...labels, DONT_KNOW]);

			if (picked === undefined) {
				return text("The learner dismissed the question without answering.", {
					status: "cancelled",
				});
			}

			const saidUnknown = picked === DONT_KNOW;
			const chosen = saidUnknown ? null : shown[labels.indexOf(picked)];
			const correct = chosen === answer;

			// A correct answer on a card is worth grading finer than pass/fail: how
			// hard it felt is the strongest signal FSRS has for spacing the next one.
			let grade: Grade = correct ? 3 : 1;
			const cardInPlay = params.card || params.remember;
			if (correct && cardInPlay) {
				const felt = await ctx.ui.select("How was that?", [
					"Instant",
					"Fine",
					"Had to dig",
				]);
				grade = felt === "Instant" ? 4 : felt === "Had to dig" ? 2 : 3;
			}

			// Grade first, create second: a card born from a question the learner just
			// answered should carry that answer, not start from a blank slate.
			const store = new Store(ctx.cwd);
			let cardId = params.card;
			if (!cardId && params.remember) {
				if (!params.topic) {
					return text("remember: true requires a topic.", { error: true });
				}
				cardId = store.addCard({
					topic: params.topic,
					node: params.node,
					question: params.question,
					answer,
					misconception: params.misconception,
				}).id;
			}

			let scheduling = "";
			if (cardId) {
				const result = applyReview(store, cardId, grade, {
					unknown: saidUnknown,
					note: chosen && !correct ? `chose: ${chosen}` : undefined,
				});
				if (result) {
					scheduling = `\nNext review in ${describeSchedule(result.card)}.`;
					if (result.lapse) scheduling += " (lapse — it had been learned)";
				}
			}

			const verdict = correct
				? "✓ Correct."
				: saidUnknown
					? `✗ Said "I don't know". Correct answer: ${answer}`
					: `✗ Wrong — chose "${chosen}". Correct answer: ${answer}`;

			const explanation = params.explanation ? `\n${params.explanation}` : "";

			return text(`${verdict}${explanation}${scheduling}`, {
				question: params.question,
				chosen,
				answer,
				correct,
				unknown: saidUnknown,
				grade,
				card: cardId,
			});
		},
	});
}
