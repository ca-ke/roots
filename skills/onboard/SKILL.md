---
name: onboard
description: Interview the learner and write USER.md — who they are, what they are reaching for, how they learn, and what has failed on them before. Use on a first session, when USER.md is still the shipped template, or whenever the learner asks to redo their profile.
---

# Onboard

Write `USER.md` by interviewing, not by handing over a form.

`USER.md` sits in the persistent-memory slot on every single turn, of every
future session. It is the highest-leverage file in the system and the one most
likely to be left as the template, because filling in a blank profile is tedious
and its value is invisible until much later. So do it as a conversation, and get
it done in one sitting.

**Budget: five to eight exchanges.** An onboarding that feels like paperwork gets
abandoned halfway, and half a profile is worse than none — it looks filled in, so
nothing ever prompts a fix.

## The one rule that makes this worth doing

**Do not take self-reported level at face value. Measure it.**

People are unreliable narrators of their own knowledge in both directions: "I
know the basics" covers everything from a weekend tutorial to five years of
production work, and the ones who undersell themselves are usually the ones you
would otherwise bore. This whole system exists because what someone can recite
and what they can derive are different things — applying that to the intake is
the same principle, one level up.

So: they tell you their background, and then you **check one or two claims from
it with `quiz`**. Not an exam — two questions, aimed at whatever they named as
their strongest ground. What you are calibrating is not the topic; it is how
their words map to their actual level, and that calibration is what makes every
future probe start in the right place.

Say what you are doing and why. "Let me check one thing so I know how to pitch
this" is fine. Quizzing someone without warning during an intro feels like a test
they did not agree to.

## What to get

Five things. Follow the thread when an answer opens something up, and drop a
section that genuinely does not apply.

1. **Background.** Field, what they do, where their real depth is. Push past
   labels: "backend engineer" tells you little; "eight years of Ruby and
   Postgres, shaky on the theory under distributed systems" tells you where to
   start and where to stop.
2. **What they are reaching for.** The reason, not the topic. "Understand
   transformers to read the papers" and "to explain them to my team" are
   different lessons. If they cannot articulate it — normal, for a subject they
   do not know yet — offer two or three concrete versions and let them pick.
3. **How they learn.** Ask what has actually worked, with an example. "I'm a
   visual learner" is unusable; "I need a worked example before the general rule"
   is a directive. Worth covering: attempt first or be shown; the derivation or
   the result; how often they want to be checked.
4. **What does not work on them.** The highest-value answer and the one people
   skip, so ask it directly and specifically: what does a bad explanation look
   like to you? What has a teacher done that made you stop listening? Take what
   they say literally — this section is a list of prohibitions, and you are bound
   by it.
5. **Constraints.** Time per session, language, notation, anything else shaping
   delivery.

## Writing it

Write `USER.md` yourself with the file tools. Then:

- **Remove the `<!-- roots:template -->` marker at the top.** While it is there,
  every session is told the profile is unfilled and sent back here.
- Delete the instructional prose from the template. Keep only their content.
- Write it in their words, not paraphrased into neutral register. "Don't tell me
  something is simple" should survive verbatim; it loses its force as "prefers
  candid framing of difficulty".
- Keep it short. It is loaded on every turn — a page, not an essay.
- Record what you **measured** separately from what they **claimed**, when the
  two came apart. "Says calculus is rusty; got the chain rule instantly and
  missed integration by parts" is worth more than either half alone.

Then show them the file and ask what is wrong with it. People correct a draft
readily and produce a blank page slowly.

## Behaviour preferences

Most of what comes out of this describes the learner and belongs in `USER.md`.

Occasionally something comes out that is really an instruction about how the
agent should behave in this project regardless of topic — a house style, a
language rule, a standing prohibition. That goes in `SOUL.local.md` at the
project root, which is appended to the identity slot and wins over the shipped
identity where they conflict. Create it only when something genuinely warrants
it; a preference about *them* is not one.

## Closing

Say what changed as a result — where you will now start, given what you
measured. Then offer the first lesson and hand over to the `teach` skill.

Do not teach anything during onboarding. It is tempting when a gap surfaces
mid-interview, and it turns a five-minute intake into an unplanned lesson built
on a profile that has not been written yet.
