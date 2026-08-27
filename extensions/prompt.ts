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

const SEPARATOR = "\n\n";

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
		const seeded = seedUserFile(ctx.cwd, config);
		writeDigest(new Store(ctx.cwd), ctx.cwd);
		if (seeded) {
			ctx.ui.notify(
				`Created ${USER_FILE}. Fill it in — it is how the agent knows who it is teaching.`,
				"info",
			);
		}
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const config = configDir(ctx.cwd);

		const soul = readIfPresent(path.join(config, SOUL_FILE));
		const guidance = readIfPresent(path.join(config, GUIDANCE_FILE));

		// Regenerated per turn: a review two messages ago should already be
		// reflected here, not one session later.
		const memory = writeDigest(new Store(ctx.cwd), ctx.cwd).trim();
		const user = readIfPresent(path.join(ctx.cwd, USER_FILE));

		const slots: string[] = [];
		if (soul) slots.push(slot(1, "identity", soul));
		if (guidance) slots.push(slot(2, "tool guidance", guidance));

		const persistent = [user, memory].filter(Boolean).join(SEPARATOR);
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
				[2, "tool guidance", path.join(config, GUIDANCE_FILE)],
				[3, "persistent memory", path.join(ctx.cwd, USER_FILE)],
				[3, "persistent memory", path.join(ctx.cwd, MEMORY_FILE)],
			] as const;

			const lines = rows.map(([n, name, file]) => {
				const size = readIfPresent(file)?.length ?? 0;
				const mark = size > 0 ? "✓" : "·";
				const detail = size > 0 ? `${size} chars` : "missing";
				return `${mark} slot ${n} ${name.padEnd(18)} ${path.basename(file)} (${detail})`;
			});
			lines.push("· slot 4 skills register     assembled by pi from skills/");
			lines.push("· slot 5 project context     assembled by pi from AGENTS.md");

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
