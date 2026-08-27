/**
 * FSRS-5 — Free Spaced Repetition Scheduler, version 5, with default weights.
 *
 * What the algorithm models, in two variables per card:
 *
 *   - stability (S): how many days until the chance of recall drops to 90%.
 *     This is the memory itself. It grows on every success and collapses on
 *     every failure.
 *   - difficulty (D): 1 to 10, how strongly THIS card resists gaining
 *     stability. A property of the card, not of the moment.
 *
 * And one derived quantity:
 *
 *   - retrievability (R): the chance of recall right now, given that `t` days
 *     have passed since the last review at stability `S`.
 *
 * The stability gain is largest when R is low — reviewing something you have
 * nearly forgotten is worth far more than reviewing something fresh. That is
 * why the scheduler targets 90% retention instead of drilling every day.
 *
 * Reference: https://github.com/open-spaced-repetition/fsrs4anki/wiki
 */

/** 1 = Again · 2 = Hard · 3 = Good · 4 = Easy */
export type Grade = 1 | 2 | 3 | 4;

/** FSRS-5 default weights (w0..w18), trained on the public Anki dataset. */
const W = [
	0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575,
	0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655,
	0.6621,
] as const;

const DECAY = -0.5;
/** Chosen so that R(t = S) is exactly 0.9. */
const FACTOR = 19 / 81;

const S_MIN = 0.01;
const S_MAX = 36500; // 100 years; never reached in practice
const D_MIN = 1;
const D_MAX = 10;

const DAY_MS = 86_400_000;

const clamp = (x: number, min: number, max: number) =>
	Math.min(max, Math.max(min, x));

/** Chance of recall after `days`, given stability `S`. */
export function retrievability(days: number, S: number): number {
	if (S <= 0) return 0;
	return (1 + (FACTOR * Math.max(0, days)) / S) ** DECAY;
}

/** Days until retrievability decays to `retention`. Minimum of 1 day. */
export function intervalFor(S: number, retention = 0.9): number {
	const days = (S / FACTOR) * (retention ** (1 / DECAY) - 1);
	return clamp(Math.round(days), 1, S_MAX);
}

const initialStability = (g: Grade) => clamp(W[g - 1], S_MIN, S_MAX);

const initialDifficulty = (g: Grade) =>
	clamp(W[4] - Math.exp(W[5] * (g - 1)) + 1, D_MIN, D_MAX);

/**
 * Difficulty after a review. Two steps:
 *   1. shift proportionally to the grade, damped near the extremes;
 *   2. revert toward D0(Easy) — without this, D only ever climbs over time.
 */
function nextDifficulty(D: number, g: Grade): number {
	const delta = -W[6] * (g - 3);
	const shifted = D + (delta * (10 - D)) / 9;
	return clamp(W[7] * initialDifficulty(4) + (1 - W[7]) * shifted, D_MIN, D_MAX);
}

/** Stability after a success. The gain grows as R falls and as D falls. */
function stabilityAfterRecall(D: number, S: number, R: number, g: Grade) {
	const hardPenalty = g === 2 ? W[15] : 1;
	const easyBonus = g === 4 ? W[16] : 1;
	const gain =
		Math.exp(W[8]) *
		(11 - D) *
		S ** -W[9] *
		(Math.exp(W[10] * (1 - R)) - 1) *
		hardPenalty *
		easyBonus;
	return clamp(S * (1 + gain), S_MIN, S_MAX);
}

/**
 * Stability after a lapse. It can never rise: forgetting strengthens nothing.
 * It does not reset to zero either — what was learned leaves a residue.
 */
function stabilityAfterLapse(D: number, S: number, R: number) {
	const next =
		W[11] * D ** -W[12] * ((S + 1) ** W[13] - 1) * Math.exp(W[14] * (1 - R));
	return clamp(Math.min(next, S), S_MIN, S_MAX);
}

/** Same-day review: a small adjustment that skips the forgetting model. */
const sameDayStability = (S: number, g: Grade) =>
	clamp(S * Math.exp(W[17] * (g - 3 + W[18])), S_MIN, S_MAX);

export interface FsrsState {
	stability?: number;
	difficulty?: number;
	/** ISO 8601. Absent = the card has never been reviewed. */
	lastReview?: string;
}

export interface Schedule {
	stability: number;
	difficulty: number;
	/** Days until the next review. */
	interval: number;
	/** ISO 8601. */
	due: string;
	/** Chance of recall at review time. `null` for a brand-new card. */
	retrievability: number | null;
	/** A miss on a card that was already due — real forgetting, not a slip. */
	lapse: boolean;
}

/**
 * Schedule a card's next review from its current state and the grade given.
 *
 * @param state     current FSRS state (empty for a new card)
 * @param grade     1..4
 * @param now       review timestamp (defaults to now)
 * @param retention target retention; 0.9 is the FSRS default
 */
export function schedule(
	state: FsrsState,
	grade: Grade,
	now: Date = new Date(),
	retention = 0.9,
): Schedule {
	const isNew = state.stability == null || state.difficulty == null;

	if (isNew) {
		const S = initialStability(grade);
		const D = initialDifficulty(grade);
		const interval = intervalFor(S, retention);
		return {
			stability: S,
			difficulty: D,
			interval,
			due: new Date(now.getTime() + interval * DAY_MS).toISOString(),
			retrievability: null,
			lapse: false,
		};
	}

	const S = state.stability as number;
	const D = state.difficulty as number;
	const days = state.lastReview
		? Math.max(0, (now.getTime() - Date.parse(state.lastReview)) / DAY_MS)
		: 0;

	const R = retrievability(days, S);
	const nextD = nextDifficulty(D, grade);

	let nextS: number;
	if (days < 1) {
		nextS = sameDayStability(S, grade);
	} else if (grade === 1) {
		nextS = stabilityAfterLapse(D, S, R);
	} else {
		nextS = stabilityAfterRecall(D, S, R, grade);
	}

	const interval = intervalFor(nextS, retention);
	return {
		stability: nextS,
		difficulty: nextD,
		interval,
		due: new Date(now.getTime() + interval * DAY_MS).toISOString(),
		retrievability: R,
		lapse: grade === 1 && days >= 1,
	};
}
