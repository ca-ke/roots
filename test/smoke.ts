/**
 * Smoke test for the memory layer — the parts that are pure logic and would be
 * expensive to discover broken months later, once a schedule has drifted.
 *
 * The scheduler is the reason this exists. A subtly wrong FSRS implementation
 * does not crash; it just quietly puts your reviews in the wrong places, and by
 * the time you notice, the history is worthless. So the checks here are about
 * properties rather than exact numbers: success grows stability, a lapse never
 * does, difficulty moves the right way, intervals stay finite.
 *
 * The other half checks the storage contract: after N reviews the queue still
 * has exactly one line per card, because a review replaces its line instead of
 * appending a new one.
 *
 * Run it with any TypeScript runner, e.g.:
 *   npx tsx test/smoke.ts
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { schedule, retrievability, intervalFor } from "../extensions/memory/fsrs.ts";
import { Store } from "../extensions/memory/store.ts";
import { applyReview, describeSchedule } from "../extensions/memory/review.ts";
import { queue, priority, errorRate, misconceptionOpen } from "../extensions/memory/priority.ts";
import { render } from "../extensions/memory/report.ts";
import { renderDigest } from "../extensions/memory/digest.ts";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
	if (cond) console.log(`  ok   ${name}`);
	else {
		failures++;
		console.log(`  FAIL ${name} ${extra}`);
	}
}

const DAY = 86_400_000;
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "roots-"));
console.log("workspace:", cwd);

// ── FSRS ────────────────────────────────────────────────────────────────────
console.log("\nFSRS-5");
{
	const t0 = new Date("2026-01-01T12:00:00Z");
	const good = schedule({}, 3, t0);
	const again = schedule({}, 1, t0);
	const easy = schedule({}, 4, t0);
	check("new card: Easy schedules further out than Good", easy.interval > good.interval, `${easy.interval} vs ${good.interval}`);
	check("new card: Good schedules further out than Again", good.interval > again.interval, `${good.interval} vs ${again.interval}`);
	check("new card has no retrievability", good.retrievability === null);
	check("R(t=S) is 0.9", Math.abs(retrievability(10, 10) - 0.9) < 1e-9, String(retrievability(10, 10)));
	check("intervalFor inverts retrievability", intervalFor(10) === 10, String(intervalFor(10)));

	// A success after the interval elapses must grow stability.
	const t1 = new Date(t0.getTime() + good.interval * DAY);
	const second = schedule(
		{ stability: good.stability, difficulty: good.difficulty, lastReview: t0.toISOString() },
		3,
		t1,
	);
	check("success grows stability", second.stability > good.stability, `${second.stability} > ${good.stability}`);
	check("success grows the interval", second.interval > good.interval, `${second.interval} > ${good.interval}`);
	check("retrievability at due time is near 0.9", Math.abs((second.retrievability ?? 0) - 0.9) < 0.06, String(second.retrievability));

	// A lapse must shrink stability and never grow it.
	const lapse = schedule(
		{ stability: second.stability, difficulty: second.difficulty, lastReview: t1.toISOString() },
		1,
		new Date(t1.getTime() + second.interval * DAY),
	);
	check("lapse shrinks stability", lapse.stability < second.stability, `${lapse.stability} < ${second.stability}`);
	check("lapse is flagged", lapse.lapse === true);
	check("interval never goes below 1 day", lapse.interval >= 1, String(lapse.interval));

	// Difficulty must move the right way and stay in range.
	const hard = schedule({ stability: 10, difficulty: 5, lastReview: t0.toISOString() }, 1, t1);
	const nice = schedule({ stability: 10, difficulty: 5, lastReview: t0.toISOString() }, 4, t1);
	check("missing raises difficulty", hard.difficulty > 5, String(hard.difficulty));
	check("Easy lowers difficulty", nice.difficulty < 5, String(nice.difficulty));
	check("difficulty stays within [1,10]", hard.difficulty <= 10 && nice.difficulty >= 1);

	// 20 consecutive successes should reach a multi-month interval, not diverge.
	let s = schedule({}, 3, t0);
	let at = t0;
	for (let i = 0; i < 20; i++) {
		at = new Date(at.getTime() + s.interval * DAY);
		s = schedule({ stability: s.stability, difficulty: s.difficulty, lastReview: new Date(at.getTime() - s.interval * DAY).toISOString() }, 3, at);
	}
	check("20 successes reach a long interval", s.interval > 180, `${s.interval}d`);
	check("stability stays finite", Number.isFinite(s.stability));
}

// ── Store: the remove-on-review contract ────────────────────────────────────
console.log("\nStore");
const store = new Store(cwd);
const a = store.addCard({ topic: "TCP", node: "packets", question: "What is every transfer made of?", answer: "packets" });
const b = store.addCard({ topic: "TCP", node: "ordering", question: "What restores order?", answer: "sequence numbers" });
const c = store.addCard({
	topic: "HTTP",
	question: "Is HTTP stateless?",
	answer: "yes, each request stands alone",
	misconception: "thinks cookies make HTTP stateful at the protocol level",
});

check("cards are born due", Date.parse(a.due) <= Date.now());
check("3 cards written", store.readCards().length === 3);

applyReview(store, a.id, 3);
applyReview(store, a.id, 3);
applyReview(store, b.id, 1);

const cardsFile = path.join(cwd, "learning", "cards.jsonl");
const lines = fs.readFileSync(cardsFile, "utf8").trim().split("\n");
check("queue still has exactly 3 lines after 3 reviews", lines.length === 3, `got ${lines.length}`);
check("no duplicate ids in the queue", new Set(lines.map((l) => JSON.parse(l).id)).size === 3);
check("history recorded every review", store.readHistory().length === 3, String(store.readHistory().length));

const aAfter = store.readCards().find((x) => x.id === a.id)!;
const bAfter = store.readCards().find((x) => x.id === b.id)!;
check("correct answers counted", aAfter.correct === 2 && aAfter.wrong === 0);
check("wrong answers counted", bAfter.wrong === 1 && bAfter.correct === 0);
check("reps counted", aAfter.reps === 2);
check("recentGrades kept in order", JSON.stringify(aAfter.recentGrades) === "[3,3]");
check("success pushed the due date out", Date.parse(aAfter.due) > Date.now() + DAY / 2);
check("describeSchedule reads sensibly", /^\d+ days? \([A-Z][a-z]{2} \d+\)$/.test(describeSchedule(aAfter)), describeSchedule(aAfter));

applyReview(store, c.id, 1, { unknown: true, note: "said don't know" });
const cAfter = store.readCards().find((x) => x.id === c.id)!;
check('"I don\'t know" is tracked apart from wrong', cAfter.unknown === 1 && cAfter.wrong === 0);
check("unknown counts against the error rate", errorRate(cAfter) > 0.5, String(errorRate(cAfter)));
check("grading a missing card returns null", applyReview(store, "nope", 3) === null);

// ── Priority ────────────────────────────────────────────────────────────────
console.log("\nPriority");
{
	const now = new Date(Date.now() + 30 * DAY); // let everything fall due
	const ranked = queue(store.readCards(), now);
	check("everything is due 30 days out", ranked.length === 3, String(ranked.length));
	check("ranked descending", ranked[0].priority >= ranked[1].priority && ranked[1].priority >= ranked[2].priority);
	check("open misconception outranks a clean card", ranked[0].id === c.id || ranked[0].id === b.id, ranked[0].topic);
	check("every card carries a reason", ranked.every((r) => r.reason.length > 0));
	check("the misconception card says so", ranked.find((r) => r.id === c.id)!.reason.includes("misconception"));

	const clean = store.readCards().find((x) => x.id === a.id)!;
	const missed = store.readCards().find((x) => x.id === b.id)!;
	check("more errors means higher priority", priority(missed, now).value > priority(clean, now).value);

	check("misconception is open before 3 successes", misconceptionOpen(cAfter));
	applyReview(store, c.id, 3);
	applyReview(store, c.id, 3);
	applyReview(store, c.id, 3);
	check("misconception dissolves after 3 successes", !misconceptionOpen(store.readCards().find((x) => x.id === c.id)!));

	check("topic filter works", queue(store.readCards(), now, { topic: "HTTP" }).length === 1);
	check("limit works", queue(store.readCards(), now, { limit: 2 }).length === 2);
	check("nothing is due right now", queue(store.readCards(), new Date()).length === 0);
	check("include_future ignores the due date", queue(store.readCards(), new Date(), { includeFuture: true }).length === 3);
}

// ── Graph + digest ──────────────────────────────────────────────────────────
console.log("\nGraph and digest");
store.putNode({ id: "packets", label: "Every transfer is made of packets", topic: "TCP", kind: "root", dependsOn: [] });
store.putNode({ id: "ordering", label: "Sequence numbers restore order", topic: "TCP", kind: "derived", dependsOn: ["packets"] });
store.putNode({ id: "ordering", label: "Sequence numbers restore order at the receiver", topic: "TCP", kind: "derived", dependsOn: ["packets"] });
check("putNode upserts rather than appending", store.readGraph().length === 2, String(store.readGraph().length));
check("last write wins", store.readGraph().find((n) => n.id === "ordering")!.label.endsWith("at the receiver"));

const digest = renderDigest(store, new Date(Date.now() + 30 * DAY));
check("digest lists established nodes", digest.includes("packets") && digest.includes("Established"));
check("digest shows the dependency edge", digest.includes("← packets"));
check("digest reports due cards", /\d+ of 3 card/.test(digest), digest.slice(0, 200));
check("digest reports accuracy by topic", digest.includes("Accuracy by topic"));

const report = render(store, new Date(Date.now() + 30 * DAY));
check("report ranks cards", report.includes("Most in need of review"));
check("report breaks down by topic", report.includes("By topic"));
check("empty store reports emptiness", render(new Store(fs.mkdtempSync(path.join(os.tmpdir(), "empty-")))).includes("No cards yet"));

// ── Robustness ──────────────────────────────────────────────────────────────
console.log("\nRobustness");
fs.appendFileSync(cardsFile, "{ this is not json\n");
check("a corrupt line is skipped, not fatal", store.readCards().length === 3, String(store.readCards().length));
check("deleteCard removes one", store.deleteCard(a.id) === true && store.readCards().length === 2);
check("deleting a missing card is false", store.deleteCard("nope") === false);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
