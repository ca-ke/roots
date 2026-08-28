/**
 * Tests for the terminal typesetter.
 *
 * The bar is not "renders LaTeX" — it cannot. The bar is that a quiz option
 * carrying notation is readable in a dialog, and that anything the converter
 * does not understand comes out unharmed rather than mangled. That second half
 * matters more: a wrong approximation in a quiz option is a wrong question.
 */

import { typeset } from "../lib/typeset.ts";

let failures = 0;
function is(input: string, expected: string) {
	const actual = typeset(input);
	if (actual === expected) {
		console.log(`  ok   ${JSON.stringify(input)} → ${JSON.stringify(actual)}`);
	} else {
		failures++;
		console.log(
			`  FAIL ${JSON.stringify(input)}\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`,
		);
	}
}

console.log("Math delimiters");
is("$f(x) = x^2$", "f(x) = x²");
is("The rate is $\\alpha$ per step.", "The rate is α per step.");
is("$$\\sum_{i=1}^{n} x_i$$", "∑ᵢ₌₁ⁿ xᵢ");
is("no math here", "no math here");

console.log("\nScripts");
is("x^2", "x²");
is("x^{10}", "x¹⁰");
is("a_1 + a_2", "a₁ + a₂");
is("e^{-x}", "e⁻ˣ");
is("v_{max}", "vₘₐₓ");
// 'q' has no superscript codepoint, so the whole group is left as written
// rather than half-converted into something that reads wrong.
is("x^{q}", "x^q");
// Same rule downstairs: no subscript 'w' exists.
is("\\nabla_w L", "∇_w L");

console.log("\nFractions and roots");
is("\\frac{a}{b}", "a/b");
is("\\frac{x + 1}{2}", "(x + 1)/2");
is("\\sqrt{2}", "√2");
is("\\sqrt{x + y}", "√(x + y)");

console.log("\nSymbols");
is("\\alpha \\beta \\gamma", "α β γ");
is("a \\leq b \\neq c", "a ≤ b ≠ c");
is("x \\in \\mathbb{R}", "x ∈ ℝ");
is("p \\Rightarrow q", "p ⇒ q");
is("\\rightarrow and \\right", "→ and");
is("\\text{if } x > 0", "if x > 0");

console.log("\nMarkdown");
is("**bold** text", "bold text");
is("some `code` here", "some code here");
is("a *stressed* word", "a stressed word");

console.log("\nLeft alone when not understood");
is("\\barfoo{x}", "\\barfoox");
is("100% of $5", "100% of $5");
is("if (a && b) return", "if (a && b) return");

console.log("\nRealistic quiz options");
is(
	"The gradient $\\nabla_w L$ points toward steepest **ascent**",
	"The gradient ∇_w L points toward steepest ascent",
);
is("Complexity is $O(n \\log n)$", "Complexity is O(n log n)");
is(
	"$P(A \\mid B) = \\frac{P(B \\mid A) P(A)}{P(B)}$",
	"P(A | B) = (P(B | A) P(A))/P(B)",
);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
