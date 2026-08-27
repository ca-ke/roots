<!-- roots:template — this marker means the file has not been filled in yet.
     The onboard skill removes it when it writes the real profile. -->

# User

Who the agent is teaching. This file is copied to `USER.md` on first run and is
loaded into the persistent-memory slot on every turn, so keep it short — this is
a profile, not a journal. Delete the guidance in each section and write yours.

The fastest way to fill it is to let the agent interview you: run
`/skill:onboard`. It takes a few minutes, and it measures where your knowledge
actually sits instead of trusting what you say about it.

The agent edits this file too, when it learns something durable about you. If it
writes something wrong, correct it here directly.

## Who I am

Background, field, what you do. Enough that the agent knows what it can lean on
without explaining: a working programmer does not need pointers re-derived; a
mathematician does not need limits motivated. Name the specific things you have
real depth in, and be honest about the edges.

> Example: Backend engineer, eight years, mostly Ruby and Postgres. Comfortable
> with distributed systems in practice, shaky on the theory underneath them.
> Calculus is twenty years cold.

## What I am working toward

The reason you are learning this, not just the topic. A goal shapes the whole
lesson: "understand transformers well enough to read the papers" and "understand
transformers well enough to explain them to my team" are different lessons.

> Example: I want to read ML papers without skipping the equations. Not building
> models — reading them.

## How I learn

What has actually worked on you, and what has not. Be specific; "I'm a visual
learner" is not usable, "I need to see a worked example before the general rule"
is.

Things worth stating if they are true of you:

- Do you want to attempt things first, or be shown the path?
- Do you want the derivation, or the result and its consequences?
- Does analogy help you, or does it get in the way?
- How much do you want checked? Frequent quizzing, or long stretches then a test?
- What tone works — blunt, patient, formal?

> Example: Show me a concrete case before the general rule; I cannot hold an
> abstraction with nothing under it. Let me try first — I would rather be wrong
> than watch. Analogies mostly help, but say when one breaks down. Quiz me
> often; I overestimate how much I have understood.

## What does not work on me

Failure modes to avoid. This is the highest-value section, and the one people
leave blank.

> Example: Do not tell me something is simple. Do not give me three options and
> ask which I want — pick one. Do not praise an answer before checking it.

## Constraints

Time, language, notation, anything else that shapes delivery.

> Example: 20–30 minutes on weeknights. Explain in English, but Portuguese
> examples are fine. Standard math notation is fine; I will ask if a symbol is
> unfamiliar.
