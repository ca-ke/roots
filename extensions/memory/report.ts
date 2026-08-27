/**
 * Report — "what do I most need to review?", answered from right/wrong history.
 *
 * Rendered as plain text so the same string works in the terminal (via the
 * `/report` command) and in the model's context (via the `memory_report` tool).
 */

import { misconceptionOpen, queue, type RankedCard } from "./priority.ts";
import type { Card, Store } from "./store.ts";

const DAY_MS = 86_400_000;

export interface TopicStats {
	topic: string;
	cards: number;
	due: number;
	correct: number;
	missed: number;
	/** Share of answers that were right, over all reviews of the topic. */
	accuracy: number;
}

export function topicStats(cards: Card[], now: Date): TopicStats[] {
	const byTopic = new Map<string, TopicStats>();
	for (const c of cards) {
		const s = byTopic.get(c.topic) ?? {
			topic: c.topic,
			cards: 0,
			due: 0,
			correct: 0,
			missed: 0,
			accuracy: 0,
		};
		s.cards += 1;
		if (Date.parse(c.due) <= now.getTime()) s.due += 1;
		s.correct += c.correct;
		s.missed += c.wrong + c.unknown;
		byTopic.set(c.topic, s);
	}
	const out = [...byTopic.values()];
	for (const s of out) {
		const total = s.correct + s.missed;
		s.accuracy = total === 0 ? 0 : s.correct / total;
	}
	// Weakest topics first: that is the whole point of the report.
	return out.sort((a, b) => a.accuracy - b.accuracy);
}

const pct = (x: number) => `${Math.round(100 * x)}%`;

function line(card: RankedCard): string {
	const where = card.node ? `${card.topic} › ${card.node}` : card.topic;
	return `  ${String(card.priority).padStart(3)}  ${where} — ${card.reason}\n       ${truncate(card.question, 76)}`;
}

const truncate = (s: string, n: number) =>
	s.length <= n ? s : `${s.slice(0, n - 1)}…`;

export function render(store: Store, now: Date = new Date(), topic?: string): string {
	const all = store.readCards();
	const cards = topic ? all.filter((c) => c.topic === topic) : all;

	if (cards.length === 0) {
		return topic
			? `No cards for topic "${topic}" yet.`
			: "No cards yet. Teach something and the quiz-checks will create them.";
	}

	const due = queue(cards, now);
	const soon = cards.filter((c) => {
		const t = Date.parse(c.due);
		return t > now.getTime() && t <= now.getTime() + 3 * DAY_MS;
	});

	const parts: string[] = [];
	parts.push(
		`${cards.length} card${cards.length === 1 ? "" : "s"} · ${due.length} due now · ${soon.length} due within 3 days`,
	);

	if (due.length > 0) {
		parts.push("\nMost in need of review:");
		parts.push(due.slice(0, 8).map(line).join("\n"));
	}

	const open = queue(cards, now, { includeFuture: true }).filter(
		(c) => c.misconception && misconceptionOpen(c),
	);
	if (open.length > 0) {
		parts.push("\nOpen misconceptions (a wrong model still in place):");
		parts.push(
			open
				.slice(0, 6)
				.map((c) => `  · ${c.topic} — ${c.misconception}`)
				.join("\n"),
		);
	}

	const stats = topicStats(cards, now);
	if (stats.length > 1) {
		parts.push("\nBy topic (weakest first):");
		parts.push(
			stats
				.map((s) => {
					const total = s.correct + s.missed;
					const rate = total === 0 ? "untested" : `${pct(s.accuracy)} correct`;
					return `  ${s.topic.padEnd(24)} ${String(s.cards).padStart(3)} cards · ${String(s.due).padStart(3)} due · ${rate}`;
				})
				.join("\n"),
		);
	}

	return parts.join("\n");
}
