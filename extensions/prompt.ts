/**
 * prompt — assembles the system prompt in fixed slots.
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  Slot 1  Identity            SOUL.md                     │
 *   ├──────────────────────────────────────────────────────────┤
 *   │  Slot 2  Tool guidance       SYSTEM_PROMPT.md            │
 *   ├──────────────────────────────────────────────────────────┤
 *   │  Slot 3  Persistent memory   USER.md + MEMORY.md         │
 *   ├──────────────────────────────────────────────────────────┤
 *   │  Slot 4  Skills register     pi, from skills/            │
 *   ├──────────────────────────────────────────────────────────┤
 *   │  Slot 5  Project context     pi, from AGENTS.md          │
 *   ├──────────────────────────────────────────────────────────┤
 *   │  Conversation turns begin here                           │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Slots 1 to 3 are prepended by this extension. Slots 4 and 5 are pi's own —
 * the skills register and the context files it already assembles — so they are
 * left exactly as pi built them, at the end.
 *
 * The split is deliberate and worth keeping straight:
 *
 *   SOUL.md          who the agent is and how it decides. Rarely changes.
 *   SYSTEM_PROMPT.md how to drive this system's tools. Changes with the tools.
 *   USER.md          who the learner is. Written by hand, edited over time.
 *   MEMORY.md        what they have been taught. Generated, never hand-edited.
 *   skills/          procedures, loaded on demand when a task matches.
 *
 * Skills stay discoverable rather than pinned into the prompt: only their
 * descriptions are always in context, and the full procedure loads when it is
 * actually needed. Putting a procedure in the identity slot would burn context
 * on every turn to say something that matters in one turn out of ten.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

import { MEMORY_FILE, writeDigest } from "./memory/digest.ts";
import { Store } from "./memory/store.ts";

const SOUL_FILE = "SOUL.md";
const GUIDANCE_FILE = "SYSTEM_PROMPT.md";
const USER_FILE = "USER.md";
const USER_TEMPLATE = "USER.example.md";
/** Project-local identity override. Survives `pi update`; the package does not. */
const SOUL_LOCAL_FILE = "SOUL.local.md";

const SEPARATOR = "\n\n";

/** Present in the shipped template, removed by the onboard skill. */
const TEMPLATE_MARKER = "<!-- roots:template -->";

const UNFILLED_NOTICE = `USER.md has not been filled in — it is still the shipped template, so nothing is known about this learner yet.

Before teaching anything, run the \`onboard\` skill: interview them and write the file. Do not skip it and do not teach around it. Without it you are guessing at their level, their goal, and what has already failed on them, and every probe starts in the wrong place.

If they decline, teach anyway, but say once that the sessions will be worse for it.`;

const LOCAL_SOUL_HEADING = `## Project overrides

The following comes from SOUL.local.md in this project. Where it conflicts with anything above, this wins.`;

/**
 * Where this configuration lives — the directory holding SOUL.md and the rest.
 * Normally `<project>/.pi`, since the repo is cloned into that name, but resolve
 * it from the module's own location so a differently named checkout still works.
 */
function configDir(cwd: string): string {
	try {
		// jiti may load this as ESM or CJS depending on the host; handle both.
		const cjsDir = (globalThis as { __dirname?: string }).__dirname;
		const here = cjsDir ?? path.dirname(new URL(import.meta.url).pathname);
		const parent = path.resolve(here, "..");
		if (fs.existsSync(path.join(parent, SOUL_FILE))) return parent;
	} catch {
		// Fall through to the conventional location.
	}
	return path.join(cwd, ".pi");
}

function readIfPresent(file: string): string | null {
	try {
		const body = fs.readFileSync(file, "utf8").trim();
		return body || null;
	} catch {
		return null;
	}
}

function slot(n: number, name: string, body: string): string {
	return `<!-- slot ${n}: ${name} -->\n${body}`;
}

export default function prompt(pi: ExtensionAPI) {
	/** Create USER.md from the shipped template the first time we run. */
	function seedUserFile(cwd: string, config: string) {
		const target = path.join(cwd, USER_FILE);
		if (fs.existsSync(target)) return false;
		const template = readIfPresent(path.join(config, USER_TEMPLATE));
		if (!template) return false;
		try {
			fs.writeFileSync(target, `${template}\n`, "utf8");
			return true;
		} catch {
			return false;
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		const config = configDir(ctx.cwd);
		seedUserFile(ctx.cwd, config);
		writeDigest(new Store(ctx.cwd), ctx.cwd);

		const unfilled = readIfPresent(path.join(ctx.cwd, USER_FILE))?.includes(
			TEMPLATE_MARKER,
		);
		if (unfilled) {
			ctx.ui.notify(
				`${USER_FILE} is still the template. Run /skill:onboard and the agent will interview you and write it.`,
				"info",
			);
		}
	});

	/** Slot 1: the shipped identity, with any project override appended. */
	function identity(config: string, cwd: string): string | null {
		const base = readIfPresent(path.join(config, SOUL_FILE));
		const local = readIfPresent(path.join(cwd, SOUL_LOCAL_FILE));
		if (!base) return local;
		if (!local) return base;
		return [base, LOCAL_SOUL_HEADING, local].join(SEPARATOR);
	}

	/**
	 * The learner's profile, or an instruction to go and get one. An untouched
	 * template is worse than an absent file: it looks like an answer.
	 */
	function profile(cwd: string): string {
		const body = readIfPresent(path.join(cwd, USER_FILE));
		if (!body || body.includes(TEMPLATE_MARKER)) return UNFILLED_NOTICE;
		return body;
	}

	pi.on("before_agent_start", async (event, ctx) => {
		const config = configDir(ctx.cwd);

		const soul = identity(config, ctx.cwd);
		const guidance = readIfPresent(path.join(config, GUIDANCE_FILE));

		// Regenerated per turn: a review two messages ago should already be
		// reflected here, not one session later.
		const memory = writeDigest(new Store(ctx.cwd), ctx.cwd).trim();

		const slots: string[] = [];
		if (soul) slots.push(slot(1, "identity", soul));
		if (guidance) slots.push(slot(2, "tool guidance", guidance));

		const persistent = [profile(ctx.cwd), memory].filter(Boolean).join(SEPARATOR);
		if (persistent) slots.push(slot(3, "persistent memory", persistent));

		if (slots.length === 0) return;

		// pi's own prompt carries slots 4 and 5 — the skills register and the
		// context files — so it goes last, untouched.
		return {
			systemPrompt: [...slots, event.systemPrompt].join(SEPARATOR),
		};
	});

	pi.registerCommand("slots", {
		description: "Show which system-prompt slots are loaded and from where",
		handler: async (_args, ctx) => {
			const config = configDir(ctx.cwd);
			const rows = [
				[1, "identity", path.join(config, SOUL_FILE)],
				[1, "identity override", path.join(ctx.cwd, SOUL_LOCAL_FILE)],
				[2, "tool guidance", path.join(config, GUIDANCE_FILE)],
				[3, "persistent memory", path.join(ctx.cwd, USER_FILE)],
				[3, "persistent memory", path.join(ctx.cwd, MEMORY_FILE)],
			] as const;

			const lines = rows.map(([n, name, file]) => {
				const body = readIfPresent(file);
				const unfilled = body?.includes(TEMPLATE_MARKER) ?? false;
				const mark = unfilled ? "!" : body ? "✓" : "·";
				const detail = unfilled
					? "still the template — run /skill:onboard"
					: body
						? `${body.length} chars`
						: "not present";
				return `${mark} slot ${n} ${name.padEnd(18)} ${path.basename(file)} (${detail})`;
			});
			lines.push("· slot 4 skills register     assembled by pi from skills/");
			lines.push("· slot 5 project context     assembled by pi from AGENTS.md");

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
