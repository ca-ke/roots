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
	context?: string;
	options?: string[];
	chosen?: string | null;
	answer?: string;
	correct?: boolean;
	unknown?: boolean;
	explanation?: string;
}

/**
 * The question, written the moment it is asked rather than after it is answered.
 *
 * This is the only place LaTeX actually renders. The dialog can show `x²` at
 * best; the reader shows $x^2$ properly. Writing on `tool_execution_start` means
 * the learner can read the real thing in their editor while the dialog is still
 * waiting for them — so a question carrying real notation is legible somewhere.
 *
 * Options are deliberately withheld until the answer comes back: they are
 * shuffled inside the tool, so anything written now would be in a different
 * order from the dialog and would just confuse the person reading both.
 */
function questionBlock(args: { question?: string; context?: string }): string {
	if (!args.question) return "";
	const context = args.context ? `${args.context}\n\n` : "";
	return `**Q.** ${args.question}\n\n${context}`;
}

function outcomeBlock(d: QuizDetails): string {
	const options = d.options ?? [];
	const lines = options.map((option) => {
		const mark = option === d.chosen ? "x" : " ";
		const arrow = option === d.chosen ? "  ← chosen" : "";
		return `- [${mark}] ${option}${arrow}`;
	});

	if (d.unknown) lines.push("- [x] *I don't know*  ← chosen");

	const verdict = d.correct
		? "✓ **Correct.**"
		: `✗ **Wrong.** Correct answer: ${d.answer ?? "—"}`;

	const explanation = d.explanation ? `\n> ${d.explanation}\n` : "";
	return `${lines.join("\n")}\n\n${verdict}\n${explanation}\n`;
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

	// The question goes down while the dialog is still open, so it can be read
	// rendered instead of as raw LaTeX in a terminal.
	pi.on("tool_execution_start", async (event) => {
		if (!file || event.toolName !== "quiz") return;
		append(questionBlock((event.args ?? {}) as { question?: string; context?: string }));
	});

	pi.on("tool_result", async (event) => {
		if (!file || event.toolName !== "quiz") return;
		const d = (event.details ?? {}) as QuizDetails;
		// A dismissed question leaves its prompt above with nothing under it.
		if (!d.question) {
			append("*(no answer)*\n\n");
			return;
		}
		append(outcomeBlock(d));
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
