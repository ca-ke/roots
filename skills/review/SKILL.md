---
name: review
description: Run a spaced-repetition review session over what is due, and repair what has decayed. Use when the learner asks to review, to practice, to see what they should study, or when a teaching session opens with cards already due.
---

# Review

Flashcard apps grade you and move on. That is the wrong move here, because a
missed card is not a missing fact — it is a **broken edge**. Something that was
supposed to follow from what they already hold no longer does. Showing them the
answer patches the symptom and leaves the edge broken, which is why the same
card keeps coming back.

So: grade like a review session, repair like a teaching session.

## Opening

`USER.md` and `MEMORY.md` are already in context. Call `memory_report` for the
live picture, then tell them in one or two lines what is waiting: how many
cards, which topics are weakest, whether any misconception is still open. Then
ask how long they have. Ten minutes and an hour are different sessions and you
should not guess.

Call `memory_queue` with a `limit` matched to that answer — roughly one card per
90 seconds, since misses cost time. The queue is already ordered by what most
needs review: cards they get wrong often, cards long overdue relative to their
own interval, cards they have forgotten before, and unresolved misconceptions,
which cut to the front.

If nothing is due, say so and offer the alternatives: review ahead with
`include_future: true`, or start something new with the `teach` skill. Do not
invent filler questions — reviewing something already solid teaches nothing and
trains them to expect busywork.

## The loop

For each card, ask it with `quiz`, passing the card's id as `card`. That grades
it and reschedules it in one step.

Ask the question **as it was written**. Rewording a card silently changes what
is being tested, and the whole history attached to that card stops meaning
anything. If the wording is genuinely bad, fix the card deliberately — say so,
`memory_add` a better one, and let the old one go.

You need distractors, and the stored card only carries the answer. Build them by
the construction procedure in the tool guidance: write the correct claim first,
then mutate it into each distractor by asking what someone holding a specific
wrong belief would say. Same shape, same length, same register, no reasoning in
any option.

### On a hit

Say what makes it right in one line and move on. Do not lecture over a correct
answer; it burns the time the misses need.

If the follow-up said "Instant", consider whether the card is still doing work.
A card answered instantly three times in a row is scheduled far out anyway — let
FSRS handle it rather than dropping it.

### On a miss

This is where the session earns its keep. Do not just reveal the answer.

1. **Find out which edge broke.** Which distractor did they take? Each one was
   built from a specific wrong belief — that is what makes the choice
   diagnostic. Read it.
2. **Rebuild the derivation, do not restate the conclusion.** Go back to the
   node this one hangs off — `memory_graph` with `action: "list"` will tell you
   what that is — confirm that node still holds, and walk the step forward
   again. If the node underneath has *also* decayed, you have found the real
   problem: stop here and repair the foundation. Repairing a root fixes every
   card above it at once; patching the leaf fixes nothing.
3. **Check the repair with a fresh `quiz`**, asked differently enough that they
   cannot pass by recognizing the phrasing from a minute ago.
4. **If it was a wrong model rather than a gap, record it.** Create a card with
   `remember: true` and `misconception` set to the wrong model in their words.
   It will then re-test itself on a schedule and hold priority until it is
   actually gone.

Three misses in the same topic is not a run of bad luck — it is a decayed
foundation. Stop reviewing, switch to the `teach` skill, and rebuild that part
of the graph. Say that is what you are doing and why.

## Closing

Call `memory_report` again and tell them:

- what they got through, and how it went;
- what is scheduled next and roughly when;
- the one thing most worth their attention before the next session — the weakest
  topic, or the misconception still standing.

End with one concrete next step, not a list. If the report shows a foundation
that needs rebuilding rather than reviewing, say so plainly: it is the most
useful thing you can tell them, and it is the thing a flashcard app can never
say.
