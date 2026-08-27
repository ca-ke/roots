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

interface Asked {
	/** The option they picked, or `null` for "I don't know". */
	chosen: string | null;
	unknown: boolean;
	/** True when they dismissed the dialog without answering. */
	cancelled: boolean;
}

/**
 * Put the question up and read the answer back. Options are numbered before
 * display so that two identically worded options still map back unambiguously.
 */
async function ask(
	ctx: { ui: { select(title: string, options: string[]): Promise<string | undefined> } },
	question: string,
	context: string | undefined,
	options: string[],
): Promise<Asked> {
	const shown = shuffle(options);
	const labels = shown.map((o, i) => `${i + 1}. ${o}`);
	const title = context ? `${question}\n\n${context}` : question;

	const picked = await ctx.ui.select(title, [...labels, DONT_KNOW]);

	if (picked === undefined) return { chosen: null, unknown: false, cancelled: true };
	if (picked === DONT_KNOW) return { chosen: null, unknown: true, cancelled: false };
	return { chosen: shown[labels.indexOf(picked)], unknown: false, cancelled: false };
}

/**
 * A correct answer on a scheduled card is worth grading finer than pass/fail:
 * how hard it felt is the strongest signal FSRS has for spacing the next one.
 */
async function askHowItFelt(ctx: {
	ui: { select(title: string, options: string[]): Promise<string | undefined> };
}): Promise<Grade> {
	const felt = await ctx.ui.select("How was that?", ["Instant", "Fine", "Had to dig"]);
	if (felt === "Instant") return 4;
	if (felt === "Had to dig") return 2;
	return 3;
}

function verdictOf(result: Asked, correct: boolean, answer: string): string {
	if (correct) return "✓ Correct.";
	if (result.unknown) return `✗ Said "I don't know". Correct answer: ${answer}`;
	return `✗ Wrong — chose "${result.chosen}". Correct answer: ${answer}`;
}

interface QuizParams {
	question: string;
	options: string[];
	correct: number;
	context?: string;
	explanation?: string;
	card?: string;
	remember?: boolean;
	topic?: string;
	node?: string;
	misconception?: string;
}

/** Everything that makes the call unanswerable, checked before anything is shown. */
function validate(params: QuizParams, hasUI: boolean): string | null {
	if (params.correct < 1 || params.correct > params.options.length) {
		return `correct must be between 1 and ${params.options.length}.`;
	}
	if (!hasUI) {
		return (
			"No interactive UI available — ask the question in the conversation instead, " +
			"then record the outcome with memory_grade."
		);
	}
	if (params.remember && !params.topic) {
		return "remember: true requires a topic.";
	}
	return null;
}

/** A miss is always Again. A hit is Good, unless the card is worth grading finer. */
async function gradeFor(
	ctx: Parameters<typeof askHowItFelt>[0],
	correct: boolean,
	scheduled: boolean,
): Promise<Grade> {
	if (!correct) return 1;
	if (!scheduled) return 3;
	return askHowItFelt(ctx);
}

/**
 * The card this answer belongs to: an existing one, a newly written one, or
 * none at all when the question was a one-off probe.
 *
 * Written only after the question has been answered, so a card born here
 * carries the answer the learner just gave rather than starting blank.
 */
function resolveCardId(
	store: Store,
	params: QuizParams,
	answer: string,
): string | undefined {
	if (params.card) return params.card;
	if (!params.remember) return undefined;
	return store.addCard({
		topic: params.topic as string,
		node: params.node,
		question: params.question,
		answer,
		misconception: params.misconception,
	}).id;
}

/** Record the review and describe when the card comes back. */
function describeOutcome(
	store: Store,
	cardId: string,
	grade: Grade,
	asked: Asked,
	correct: boolean,
): string {
	const result = applyReview(store, cardId, grade, {
		unknown: asked.unknown,
		note: asked.chosen && !correct ? `chose: ${asked.chosen}` : undefined,
	});
	if (!result) return "";
	const lapse = result.lapse ? " (lapse — it had been learned)" : "";
	return `\nNext review in ${describeSchedule(result.card)}.${lapse}`;
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
			const problem = validate(params, ctx.hasUI);
			if (problem) return text(problem, { error: true });

			const answer = params.options[params.correct - 1];
			const asked = await ask(ctx, params.question, params.context, params.options);

			if (asked.cancelled) {
				return text("The learner dismissed the question without answering.", {
					status: "cancelled",
				});
			}

			const correct = asked.chosen === answer;
			const scheduled = Boolean(params.card ?? params.remember);
			const grade = await gradeFor(ctx, correct, scheduled);

			const store = new Store(ctx.cwd);
			const cardId = resolveCardId(store, params, answer);
			const scheduling = cardId
				? describeOutcome(store, cardId, grade, asked, correct)
				: "";
			const explanation = params.explanation ? `\n${params.explanation}` : "";

			return text(
				`${verdictOf(asked, correct, answer)}${explanation}${scheduling}`,
				{
					question: params.question,
					chosen: asked.chosen,
					answer,
					correct,
					unknown: asked.unknown,
					grade,
					card: cardId,
				},
			);
		},
	});
}
