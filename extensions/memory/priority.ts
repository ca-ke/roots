/**
 * Priority — the order in which due cards should be reviewed.
 *
 * FSRS answers "WHEN to review". It does not answer "what to review FIRST when
 * thirty cards came due and there is time for ten". That is the question this
 * file answers, and it is decided by the record of right and wrong answers.
 *
 * Three terms, each normalized to [0, 1]:
 *
 *   error       — how often the learner gets this card wrong
 *   urgency     — how overdue it is, measured in multiples of its own interval
 *   fragility   — how many times it was forgotten after being learned
 *
 * Plus a flat bonus for misconceptions that are not yet dissolved: a confident
 * wrong model is worse than a gap, because it produces wrong answers everywhere
 * downstream of it. Those cut the line.
 */

import type { Card } from "./store.ts";

const DAY_MS = 86_400_000;

const W_ERROR = 0.5;
const W_URGENCY = 0.35;
const W_FRAGILITY = 0.15;
/** Added after the weighted terms, so it can push priority past 100. */
const MISCONCEPTION_BONUS = 0.25;

const clamp = (x: number, min: number, max: number) =>
	Math.min(max, Math.max(min, x));

/**
 * Smoothed error rate (Laplace's rule). A card with no history lands at 0.5
 * rather than 0 or 1 — without smoothing, a single lucky answer would banish it
 * to the end of the queue forever, and a single slip would pin it to the top.
 *
 * "I don't know" counts as an error: the information was not available.
 */
export function errorRate(card: Card): number {
	const missed = card.wrong + card.unknown;
	const total = card.correct + missed;
	return (missed + 0.5) / (total + 1);
}

/**
 * How overdue the card is, on its own clock. A card with a 2-day interval that
 * is 4 days late is in far more danger than a 90-day card that is 4 days late.
 * Saturates at 2× the interval.
 */
export function urgency(card: Card, now: Date): number {
	const lateDays = (now.getTime() - Date.parse(card.due)) / DAY_MS;
	return clamp(lateDays / Math.max(1, card.interval), 0, 2) / 2;
}

/** Lapses: forgetting something already learned. Saturates gently — 2 = 0.5. */
export const fragility = (card: Card) => card.lapses / (card.lapses + 2);

/** A misconception is dissolved once the last 3 reviews were all successes. */
export function misconceptionOpen(card: Card): boolean {
	if (!card.misconception) return false;
	const last = card.recentGrades.slice(-3);
	return last.length < 3 || last.some((g) => g < 3);
}

export interface Priority {
	value: number;
	/** A short phrase saying why this card sits where it sits. */
	reason: string;
}

export function priority(card: Card, now: Date = new Date()): Priority {
	const e = errorRate(card);
	const u = urgency(card, now);
	const f = fragility(card);
	const open = misconceptionOpen(card);

	const raw =
		W_ERROR * e +
		W_URGENCY * u +
		W_FRAGILITY * f +
		(open ? MISCONCEPTION_BONUS : 0);

	// An open misconception always owns the reason, even when it is not the
	// largest term. The others say how urgent the card is; this one says what
	// kind of problem it is, and that changes how it has to be taught — a wrong
	// model has to be dislodged, not topped up.
	if (open) {
		return {
			value: Math.round(100 * raw),
			reason: `open misconception: ${card.misconception}`,
		};
	}

	// Otherwise the reason names the dominant term, which is what makes the
	// queue readable at a glance.
	const terms: Array<[number, string]> = [
		[W_ERROR * e, errorReason(card)],
		[W_URGENCY * u, urgencyReason(card, now)],
		[W_FRAGILITY * f, `forgotten ${card.lapses}×`],
	];
	terms.sort((a, b) => b[0] - a[0]);

	return { value: Math.round(100 * raw), reason: terms[0][1] };
}

function errorReason(card: Card): string {
	const missed = card.wrong + card.unknown;
	const total = card.correct + missed;
	if (total === 0) return "never answered";
	return `missed ${missed} of ${total}`;
}

function urgencyReason(card: Card, now: Date): string {
	const days = Math.floor((now.getTime() - Date.parse(card.due)) / DAY_MS);
	if (days < 0) return `due in ${-days}d`;
	if (days === 0) return "due today";
	return `${days}d overdue (${card.interval}d interval)`;
}

export type RankedCard = Card & { priority: number; reason: string };

/** Due cards, most to least urgent. */
export function queue(
	cards: Card[],
	now: Date = new Date(),
	options: { limit?: number; topic?: string; includeFuture?: boolean } = {},
): RankedCard[] {
	const t = now.getTime();
	return cards
		.filter((c) => options.includeFuture || Date.parse(c.due) <= t)
		.filter((c) => !options.topic || c.topic === options.topic)
		.map((c) => {
			const p = priority(c, now);
			return { ...c, priority: p.value, reason: p.reason };
		})
		.sort((a, b) => b.priority - a.priority)
		.slice(0, options.limit ?? Number.MAX_SAFE_INTEGER);
}
