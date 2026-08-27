/**
 * journal — mirror a lesson into a markdown file.
 *
 * A terminal cannot render LaTeX, and it cannot render Mermaid. A lesson that
 * leans on either — and a good one leans on both — is unreadable where it is
 * being delivered. So the session is mirrored to a `.md` file meant to be read
 * in something that renders it (Obsidian is the obvious choice: it does LaTeX
 * and Mermaid natively, with no plugin).
 *
 * Only what is worth re-reading is captured: what the learner asked, what was
 * taught, and how the quizzes went. File edits, shell commands, and searches
 * are noise in a lesson transcript and are dropped.
 *
 * Commands:
 *   /journal <path>   start mirroring to that file
 *   /journal          show where it is going
 *   /journal off      stop
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

interface QuizDetails {
	question?: string;
	chosen?: string | null;
	answer?: string;
	correct?: boolean;
	unknown?: boolean;
}

/** Message content arrives as a string or as a block array; flatten both. */
function extractText(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(b): b is { type: string; text: string } =>
				!!b && typeof b === "object" && (b as any).type === "text",
		)
		.map((b) => b.text)
		.join("\n")
		.trim();
}

export default function journal(pi: ExtensionAPI) {
	let file: string | null = null;

	// Events can land close together; keep appends in order.
	let lock: Promise<void> = Promise.resolve();
	function append(chunk: string) {
		if (!file) return;
		const target = file;
		lock = lock.then(() => {
			try {
				fs.appendFileSync(target, chunk, "utf8");
			} catch {
				// A broken journal must never take the lesson down with it.
			}
		});
	}

	function showStatus(ctx: any) {
		ctx.ui.setStatus(
			"journal",
			file
				? ctx.ui.theme.fg("accent", "✎ ") +
						ctx.ui.theme.fg("dim", path.basename(file))
				: undefined,
		);
	}

	pi.on("session_start", async (_event, ctx) => {
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "custom" && entry.customType === "journal") {
				file = (entry.data as { file: string | null } | undefined)?.file ?? null;
			}
		}
		showStatus(ctx);
	});

	pi.on("message_end", async (event) => {
		if (!file) return;
		const message = event.message as { role?: string; content?: unknown };
		if (message.role === "user") {
			const body = extractText(message.content);
			if (body) append(`\n---\n\n## ${body}\n\n`);
		} else if (message.role === "assistant") {
			const body = extractText(message.content);
			if (body) append(`${body}\n\n`);
		}
	});

	pi.on("tool_result", async (event) => {
		if (!file || event.toolName !== "quiz") return;
		const d = (event.details ?? {}) as QuizDetails;
		if (!d.question) return;

		const mark = d.correct ? "✓" : "✗";
		const given = d.unknown ? "*I don't know*" : (d.chosen ?? "—");
		append(
			`> **${mark} ${d.question}**\n` +
				`> Answered: ${given}\n` +
				(d.correct ? "" : `> Correct: ${d.answer}\n`) +
				"\n",
		);
	});

	pi.registerCommand("journal", {
		description: "Mirror the lesson to a markdown file (arg: path, or 'off')",
		handler: async (args, ctx) => {
			const arg = args?.trim() ?? "";

			if (arg === "off") {
				file = null;
				pi.appendEntry("journal", { file: null });
				showStatus(ctx);
				ctx.ui.notify("Journal stopped.", "info");
				return;
			}

			if (!arg) {
				ctx.ui.notify(file ? `Journaling to ${file}` : "Not journaling.", "info");
				return;
			}

			const target = path.isAbsolute(arg) ? arg : path.join(ctx.cwd, arg);
			try {
				fs.mkdirSync(path.dirname(target), { recursive: true });
				if (!fs.existsSync(target)) {
					const title = path.basename(target, path.extname(target));
					fs.writeFileSync(target, `# ${title}\n`, "utf8");
				}
			} catch (error) {
				ctx.ui.notify(`Could not open ${target}: ${error}`, "error");
				return;
			}

			file = target;
			pi.appendEntry("journal", { file: target });
			showStatus(ctx);
			ctx.ui.notify(`Journaling to ${target}`, "info");
		},
	});
}
