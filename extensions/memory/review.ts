/**
 * Applying a review: run FSRS, update the counters, swap the line in the queue,
 * and log the event. This is the only path by which a card changes state — both
 * the quiz tool and manual grading go through here.
 */

import type { Card, Review, Store } from "./store.ts";
import { type Grade, schedule } from "./fsrs.ts";

export interface ReviewResult {
	card: Card;
	review: Review;
	/** Missed a card that had already been learned and come due. */
	lapse: boolean;
}

export function applyReview(
	store: Store,
	id: string,
	grade: Grade,
	options: { unknown?: boolean; note?: string; now?: Date } = {},
): ReviewResult | null {
	const previous = store.readCards().find((c) => c.id === id);
	if (!previous) return null;

	const now = options.now ?? new Date();
	const unknown = options.unknown ?? false;
	const correct = grade >= 3;

	const plan = schedule(
		{
			stability: previous.stability,
			difficulty: previous.difficulty,
			lastReview: previous.lastReview,
		},
		grade,
		now,
	);

	const updated: Card = {
		...previous,
		stability: plan.stability,
		difficulty: plan.difficulty,
		lastReview: now.toISOString(),
		due: plan.due,
		interval: plan.interval,
		reps: previous.reps + 1,
		lapses: previous.lapses + (plan.lapse ? 1 : 0),
		correct: previous.correct + (correct ? 1 : 0),
		wrong: previous.wrong + (!correct && !unknown ? 1 : 0),
		unknown: previous.unknown + (unknown ? 1 : 0),
		recentGrades: [...previous.recentGrades, grade].slice(-8),
	};

	const review: Review = {
		card: previous.id,
		ts: now.toISOString(),
		grade,
		correct,
		unknown,
		topic: previous.topic,
		node: previous.node,
		r: plan.retrievability,
		intervalBefore: previous.interval,
		intervalAfter: plan.interval,
		stability: plan.stability,
		difficulty: plan.difficulty,
		note: options.note,
	};

	store.replaceCard(updated, review);
	return { card: updated, review, lapse: plan.lapse };
}

/** "8 days (Sep 18)" — how an interval is shown to the learner. */
export function describeSchedule(card: Card): string {
	const d = new Date(card.due);
	const month = d.toLocaleString("en-US", { month: "short" });
	const unit = card.interval === 1 ? "day" : "days";
	return `${card.interval} ${unit} (${month} ${d.getDate()})`;
}
