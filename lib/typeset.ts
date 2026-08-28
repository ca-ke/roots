/**
 * typeset — make LaTeX and markdown readable in a terminal dialog.
 *
 * The lesson is written in LaTeX because it is mirrored to a markdown reader
 * where LaTeX renders. Quiz options, though, are shown in a TUI dialog, and
 * `$\frac{\partial L}{\partial w}$` is worse than useless there — it is noise
 * the learner has to mentally parse before they can even read the option.
 *
 * So the terminal gets a Unicode approximation. Not a renderer: a legible
 * fallback. `x^2` becomes `x²`, `\alpha` becomes `α`, `\frac{a}{b}` becomes
 * `a/b`. What cannot be approximated is left alone rather than mangled.
 *
 * Unicode and not ANSI, deliberately. pi wraps each option in a theme colour,
 * and an ANSI reset inside the string would end that colour for everything
 * after it — so styling from in here would corrupt the dialog's own rendering.
 * Unicode substitution has no such interaction.
 *
 * The journal never goes through this. It keeps the raw LaTeX, because that is
 * the copy that gets rendered properly.
 */

const SUPERSCRIPT: Record<string, string> = {
	"0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
	"5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
	"+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
	a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", f: "ᶠ", g: "ᵍ", h: "ʰ",
	i: "ⁱ", j: "ʲ", k: "ᵏ", l: "ˡ", m: "ᵐ", n: "ⁿ", o: "ᵒ", p: "ᵖ",
	r: "ʳ", s: "ˢ", t: "ᵗ", u: "ᵘ", v: "ᵛ", w: "ʷ", x: "ˣ", y: "ʸ",
	z: "ᶻ", T: "ᵀ",
};

const SUBSCRIPT: Record<string, string> = {
	"0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
	"5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
	"+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
	a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ",
	m: "ₘ", n: "ₙ", o: "ₒ", p: "ₚ", r: "ᵣ", s: "ₛ", t: "ₜ",
	u: "ᵤ", v: "ᵥ", x: "ₓ",
};

/** Longest names first, so `\Rightarrow` is not eaten by `\right`. */
const COMMANDS: Array<[string, string]> = [
	["\\Rightarrow", "⇒"], ["\\Leftarrow", "⇐"], ["\\Leftrightarrow", "⇔"],
	["\\leftrightarrow", "↔"], ["\\rightarrow", "→"], ["\\leftarrow", "←"],
	["\\varepsilon", "ε"], ["\\therefore", "∴"], ["\\emptyset", "∅"],
	["\\subseteq", "⊆"], ["\\supseteq", "⊇"], ["\\parallel", "∥"],
	["\\infty", "∞"], ["\\approx", "≈"], ["\\equiv", "≡"], ["\\propto", "∝"],
	["\\forall", "∀"], ["\\exists", "∃"], ["\\nabla", "∇"], ["\\partial", "∂"],
	["\\lambda", "λ"], ["\\sigma", "σ"], ["\\Sigma", "Σ"], ["\\theta", "θ"],
	["\\Theta", "Θ"], ["\\alpha", "α"], ["\\beta", "β"], ["\\gamma", "γ"],
	["\\Gamma", "Γ"], ["\\delta", "δ"], ["\\Delta", "Δ"], ["\\omega", "ω"],
	["\\Omega", "Ω"], ["\\kappa", "κ"], ["\\times", "×"], ["\\cdot", "·"],
	["\\notin", "∉"], ["\\subset", "⊂"], ["\\supset", "⊃"], ["\\square", "□"],
	["\\wedge", "∧"], ["\\vee", "∨"], ["\\oplus", "⊕"], ["\\odot", "⊙"],
	["\\prime", "′"], ["\\ldots", "…"], ["\\cdots", "⋯"], ["\\dots", "…"],
	["\\prod", "∏"], ["\\int", "∫"], ["\\oint", "∮"], ["\\surd", "√"],
	["\\land", "∧"], ["\\lnot", "¬"], ["\\star", "⋆"], ["\\circ", "∘"],
	["\\sum", "∑"], ["\\neq", "≠"], ["\\leq", "≤"], ["\\geq", "≥"],
	["\\div", "÷"], ["\\pm", "±"], ["\\mp", "∓"], ["\\to", "→"],
	["\\in", "∈"], ["\\lor", "∨"], ["\\mid", "|"], ["\\ll", "≪"],
	["\\gg", "≫"], ["\\pi", "π"], ["\\mu", "μ"], ["\\nu", "ν"],
	["\\xi", "ξ"], ["\\rho", "ρ"], ["\\tau", "τ"], ["\\phi", "φ"],
	["\\Phi", "Φ"], ["\\psi", "ψ"], ["\\Psi", "Ψ"], ["\\chi", "χ"],
	["\\eta", "η"], ["\\zeta", "ζ"], ["\\iota", "ι"], ["\\neg", "¬"],
];

const BLACKBOARD: Record<string, string> = {
	R: "ℝ", N: "ℕ", Z: "ℤ", Q: "ℚ", C: "ℂ", P: "ℙ", E: "𝔼", H: "ℍ",
};

/** Sizing and layout commands that carry no meaning in plain text. */
const NOISE_WORDS = /\\(left|right|displaystyle|limits|qquad|quad)\b/g;
/** The spacing escapes: `\,` `\;` `\:` `\!`. No word boundary to anchor on. */
const NOISE_SPACING = /\\[,;:!]/g;

/**
 * Named operators. In LaTeX they are commands purely so they set upright rather
 * than italic; in plain text the backslash is the only thing that needs to go.
 */
const OPERATORS =
	/\\(arcsin|arccos|arctan|bmod|gcd|log|ln|sin|cos|tan|sec|csc|cot|exp|max|min|lim|det|dim|arg|deg|sup|inf|mod)\b/g;

/** Map every character through `table`, or give up if any is missing. */
function toScript(text: string, table: Record<string, string>): string | null {
	let out = "";
	for (const ch of text) {
		const mapped = table[ch];
		if (!mapped) return null;
		out += mapped;
	}
	return out;
}

/** `^{abc}` or `^a` — braced form first, so the bare form cannot steal the `{`. */
function applyScripts(text: string, marker: "^" | "_"): string {
	const table = marker === "^" ? SUPERSCRIPT : SUBSCRIPT;
	const braced = new RegExp(`\\${marker}\\{([^{}]*)\\}`, "g");
	const bare = new RegExp(`\\${marker}(\\w)`, "g");

	const convert = (whole: string, body: string) => toScript(body, table) ?? whole;
	return text.replace(braced, convert).replace(bare, convert);
}

/** `\frac{a}{b}` → `a/b`, parenthesising either side only when it needs it. */
function applyFractions(text: string): string {
	const needsParens = (s: string) => /[\s+\-]/.test(s.trim());
	const wrap = (s: string) => (needsParens(s) ? `(${s.trim()})` : s.trim());
	return text.replace(
		/\\d?frac\{([^{}]*)\}\{([^{}]*)\}/g,
		(_whole, num: string, den: string) => `${wrap(num)}/${wrap(den)}`,
	);
}

function applyRoots(text: string): string {
	return text.replace(/\\sqrt\{([^{}]*)\}/g, (_whole, body: string) =>
		body.trim().length === 1 ? `√${body.trim()}` : `√(${body.trim()})`,
	);
}

/** `\text{...}`, `\mathrm{...}` and friends contribute only their contents. */
function unwrapFonts(text: string): string {
	return text
		.replace(/\\mathbb\{(\w)\}/g, (whole, letter: string) => BLACKBOARD[letter] ?? whole)
		.replace(/\\(text|mathrm|mathit|mathbf|operatorname|bm)\{([^{}]*)\}/g, "$2");
}

function applyCommands(text: string): string {
	let out = text;
	for (const [command, symbol] of COMMANDS) {
		out = out.split(command).join(symbol);
	}
	return out;
}

/** Strip the emphasis markers; the dialog colours the whole option anyway. */
function stripMarkdown(text: string): string {
	return text
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/__([^_]+)__/g, "$1")
		.replace(/(^|\s)\*([^*\n]+)\*/g, "$1$2")
		.replace(/`([^`\n]+)`/g, "$1");
}

/** Pull the contents out of `$$…$$` and `$…$`, leaving the maths behind. */
function stripMathDelimiters(text: string): string {
	return text
		.replace(/\$\$([\s\S]+?)\$\$/g, (_whole, body: string) => body.trim())
		.replace(/\$([^$\n]+)\$/g, "$1");
}

/**
 * Convert LaTeX and light markdown into the closest readable plain text.
 * Anything without an approximation is left as written.
 */
export function typeset(text: string): string {
	const stages = [
		stripMathDelimiters,
		unwrapFonts,
		applyFractions,
		applyRoots,
		applyCommands,
		(s: string) => s.replace(OPERATORS, "$1"),
		(s: string) => applyScripts(s, "^"),
		(s: string) => applyScripts(s, "_"),
		(s: string) => s.replace(NOISE_WORDS, " ").replace(NOISE_SPACING, " "),
		stripMarkdown,
	];

	const out = stages.reduce((acc, stage) => stage(acc), text);

	// Leftover braces are LaTeX grouping with no plain-text meaning. Collapse
	// runs of whitespace last, since several stages above leave spaces behind.
	return out.replace(/[{}]/g, "").replace(/[ \t]{2,}/g, " ").trim();
}
