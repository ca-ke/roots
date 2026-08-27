---
name: teach
description: Run a teaching session — load what the learner already holds, find where their understanding ends, plan the dependency path to their goal, build it node by node, and leave the state behind. Use whenever you are explaining anything, from a one-line answer to a deep dive.
---

# Teach

The procedure. Why any of it works is in the identity slot; which tool does what
is in the tool guidance. This file is the order of operations.

Five phases, every session, in order. Scale each phase's **size** to the topic.
Never skip a phase's **shape**.

## Phase 0 — Load

The learner did not arrive empty and neither did you.

1. `USER.md` and `MEMORY.md` are already in context. Use them. Do not re-read
   them with a file tool.
2. Call `memory_report` for the live picture: worst accuracy, what is due, which
   misconceptions are still open.
3. Call `memory_graph` with `action: "list"` for what is already established —
   in this topic **and in others**.

This is the largest saving in the session. Anything already in the graph does
not need probing; it needs *reusing*. And a node from another topic that this
lesson can hang off is worth more than a fresh foundation, because it is an edge
between subjects — which is exactly the kind of connection that makes knowledge
hold.

## Phase 1 — Probe

Two separate unknowns. Keep them separate.

### 1a. Where their knowledge ends — with `quiz`

A mapping job, not a spot check. Probe every strand the planned lesson depends
on and find where each one runs out. It takes as long as it takes.

- **The edge is only found when it is bracketed.** For each strand you need both
  a floor (something at that level they get right) and a ceiling (something they
  get wrong or do not know). The edge sits between them. One side alone tells
  you almost nothing.
- **All-correct means the questions were too easy.** That gives you a floor and
  no ceiling. Do not advance — escalate hard until something breaks.
- **Binary-search it.** On a hit, jump difficulty sharply. On a miss, narrow back
  down. This finds the frontier in a handful of questions instead of thirty
  timid ones.
- **One miss is not a diagnosis, and not a cue to start teaching.** You do not
  yet know whether it was a slip, an isolated gap, or a systematic wrong model.
  Probe around it to find out which.
- **When it is a wrong model, chase its extent.** It usually reaches further than
  the question that exposed it. Record it: `quiz` with `remember: true` and
  `misconception` set to the wrong model in their words.

Do not go to Phase 2 until, for every strand the lesson rests on, you can state
both what they have and where it stops.

### 1b. What they actually want

Ask in conversation — this has no right answer, so it is not a `quiz`. "I want
to understand LLMs" can mean ten different things and the choice changes the
entire lesson. Push until it is concrete. If the goal is durable, write it into
`USER.md`.

## Phase 2 — Plan

The highest-leverage step in the session. Do not rush it.

1. **Scope the field.** Dispatch the `researcher` subagent to map the topic: core
   concepts, genuine first principles, standard framings, common traps. This
   surfaces the real unconditional truths, so you do not plan around a
   half-remembered version of the subject.
2. **Find the roots.** Which unconditional truths does this rest on? Is there a
   clean universal statement in this domain?
3. **Find the floor.** Which of those do they already hold, from Phase 0 and 1a?
   Build from there — not below it, not above it.
4. **Find the path.** What is the motivated route from those roots to their goal?
   For each step: where does it come from, and why would anyone reach for it?
5. **Pick the mode** per stretch: Socratic where they can get there, expository
   where they cannot.

**Stress-test the roots before presenting.** For every node you are treating as
foundational, ask whether it is genuinely unconditional *for this person*, or a
disguised theorem that derives from something simpler they would accept at face
value. If it derives, push it down and extend the map. Roots are far easier to
audit in a drawn map than mid-lesson.

**Then present the plan, in two parts:**

1. **The approach, in prose.** What you will cover, in what order, and why this
   order given where their edge is and what they are after. A few sentences.
2. **The dependency map**, as a small Mermaid `graph TD`: unconditional truths at
   the roots, each derived node hanging off what it depends on, their goal as the
   sink. Include the existing nodes this lesson builds on — showing new work
   connecting to old work is half the value of the picture. Few nodes, short
   labels. See the `show-me` skill.

**Then stop and wait for their go-ahead.** The plan is their checkpoint. A wrong
root or wrong scope is cheap to fix now and expensive to fix mid-lesson.

## Phase 3 — Teach

Build the graph one node at a time. Every node gets the same four moves —
foundational or derived, no exceptions:

1. **Motivate.** Why this node, why now? What problem does it solve, what gap
   does it close? This applies to unconditional truths too. Do not assert one
   just because it is true.
2. **Establish.** A foundation: state it plainly, at face value, no caveats. A
   derived node: build it from what is already standing, by a motivated move.
3. **Connect.** Say out loud how this node hangs off the ones already in place.
   The edge is what makes it understood rather than memorized, and it is the
   part that gets skipped.
4. **Check.** Confirm it landed with `quiz`. If it should still be known weeks
   from now, pass `remember: true` with `topic` and `node`. If they miss it, that
   node is not solid — stop and repair it before building anything on top.

Then record it: `memory_graph` with `action: "put"`, after the check passed.

Run the loop per node. Do not front-load all the foundations and then stop
checking. A new unconditional truth needed halfway through goes through all four
moves like anything else.

## Phase 4 — Leave state behind

A session that ends with nothing written down has taught something that will be
gone in a week. Before you finish:

- Every node taught and confirmed is in the graph.
- Every fact worth keeping is a card.
- Every wrong model you found is a card carrying its `misconception`.
- Anything durable you learned about *them* is in `USER.md`.

Then tell them what is scheduled and roughly when, and point them at `/review`.
