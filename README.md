# roots

A learning system for [pi](https://github.com/earendil-works/pi) that remembers.

It teaches from unconditional truths upward, checks that every step actually
landed, and then — this is the part most AI tutors skip — **writes down what you
learned and schedules it before you forget it**.

## Why it exists

The pedagogy here is not new. Teach from foundations the learner can accept at
face value; make every step feel discovered rather than announced; check
understanding with graded questions instead of asking "does that make sense?".
That works, and [amosblomqvist/learn](https://github.com/amosblomqvist/learn)
encodes it well — this repo started as an attempt to improve on it.

The gap it kept running into is that the philosophy says *connected knowledge
preserves itself*, and then the session ends and every connection is discarded.
The dependency graph is drawn in Mermaid and thrown away. The next session
re-probes from zero. Nothing is ever reviewed. Misconceptions — which the
teaching itself calls the most important thing to catch — are noted aloud and
never tracked.

So `roots` keeps state:

| | learn | roots |
| --- | --- | --- |
| Dependency graph | drawn, discarded | persisted in `graph.jsonl`, reused across topics |
| Where you left off | re-probed each session | loaded from disk before probing |
| Retention | none | FSRS-5 spaced repetition |
| Misconceptions | mentioned | tracked as cards until provably dissolved |
| "What should I study?" | — | ranked by your own error record |
| Prompt structure | one skill file | five slots, separately owned |
| Visuals | headless Chrome renders PNGs | fenced Mermaid, rendered by your reader |

## Install

The repo **is** a `.pi` directory. From the root of the project you want to
study in:

```bash
git clone https://github.com/ca-ke/roots .pi
pi
```

On first run it writes `USER.md` into your project. **Fill it in** — it is how
the agent knows who it is teaching, and it is the single highest-leverage file
here.

Then:

```
/journal notes/lesson-01.md    # mirror the lesson somewhere renderable
teach me how TCP guarantees ordering
```

and on a later day:

```
/review
```

## How it is put together

### The system prompt has five slots

```
┌──────────────────────────────────────────────────────────┐
│  Slot 1  Identity            SOUL.md                     │
├──────────────────────────────────────────────────────────┤
│  Slot 2  Tool guidance       SYSTEM_PROMPT.md            │
├──────────────────────────────────────────────────────────┤
│  Slot 3  Persistent memory   USER.md + MEMORY.md         │
├──────────────────────────────────────────────────────────┤
│  Slot 4  Skills register     pi, from skills/            │
├──────────────────────────────────────────────────────────┤
│  Slot 5  Project context     pi, from AGENTS.md          │
├──────────────────────────────────────────────────────────┤
│  Conversation turns begin here                           │
└──────────────────────────────────────────────────────────┘
```

Slots 1–3 are assembled by `extensions/prompt.ts`. Slots 4 and 5 are pi's own
and are left exactly as pi builds them. Run `/slots` to see what loaded.

The separation is the point:

- **`SOUL.md`** is identity — how the agent teaches and decides. It rarely
  changes.
- **`SYSTEM_PROMPT.md`** is tool guidance — which tool does what, how to write
  quiz options, how to format for a markdown reader. It changes when the tools
  change.
- **`USER.md`** is you. Hand-written; the agent also edits it when it learns
  something durable about how you learn.
- **`MEMORY.md`** is generated from the JSONL state on every turn. Never edit
  it — but do read it. It is the system showing its work.
- **`skills/`** are procedures, and stay *discoverable* rather than pinned. Only
  their descriptions sit in context; the full procedure loads when a task
  matches. A procedure that matters one turn in ten does not belong in the
  identity slot.

### Skills

- **`teach`** — load → probe → plan → teach → leave state behind. Probing
  binary-searches for the edge of what you know and refuses to advance while
  you are getting everything right, because all-correct means the questions were
  too easy. Planning stops and shows you the dependency map before teaching
  anything.
- **`review`** — a spaced-repetition session that repairs rather than drills. A
  missed card is treated as a broken edge, not a missing fact: it walks back to
  the node underneath, checks whether *that* has decayed too, and rebuilds the
  derivation. Three misses in one topic stops the review and goes back to
  teaching.
- **`show-me`** — the catalogue of visual forms and when each earns its place.

### Extensions

- **`memory/`** — FSRS-5 scheduling, the JSONL store, priority ranking, and the
  `MEMORY.md` digest. Tools: `memory_add`, `memory_queue`, `memory_grade`,
  `memory_report`, `memory_graph`. Commands: `/queue`, `/report`.
- **`quiz.ts`** — a graded question. Options are shuffled; "I don't know" is
  always offered and never shuffled, because an honest blank is a different
  signal from a wrong guess and calls for different teaching. A correct answer
  on a scheduled card gets one follow-up — *instant / fine / had to dig* —
  which is the strongest spacing signal FSRS gets.
- **`journal.ts`** — mirrors the lesson to a markdown file. Commands:
  `/journal <path>`, `/journal off`.
- **`prompt.ts`** — slot assembly. Command: `/slots`.

## The state

Everything lives in your project, in plain text you can read, diff, and delete.

```
USER.md                   who you are            (yours; agent may edit)
MEMORY.md                 what has been taught   (generated; do not edit)
learning/cards.jsonl      the review queue
learning/history.jsonl    every review ever
learning/graph.jsonl      the dependency graph
```

### The JSONL contract

`cards.jsonl` is **the queue, not a log**. One line per card, holding its
current state. When a card is reviewed, its old line is *removed* and the new
one written; the review event is appended to `history.jsonl`, which never loses
anything.

That split is deliberate. The queue stays a true picture of the present — open
the file and see exactly what is pending, with no replay to reconstruct it —
while the history keeps everything that ever happened, which is where the
right/wrong record comes from. Writes go through a temp file and a rename, so a
crash mid-write cannot corrupt the queue, and one malformed line is skipped
rather than taking the file down.

### Scheduling: FSRS-5

`extensions/memory/fsrs.ts` implements
[FSRS-5](https://github.com/open-spaced-repetition/fsrs4anki/wiki) with the
default trained weights. Two variables per card: **stability** (days until
recall drops to 90%) and **difficulty** (1–10, how hard this card is to
stabilise). Reviews are scheduled at 90% predicted retention, because the
stability gain is largest when you have *nearly* forgotten something — drilling
what is still fresh is close to worthless.

### Priority: what to review first

FSRS says *when*. It does not say what to do when thirty cards are due and you
have time for ten. That is decided by your own record:

```
priority = 100 × ( 0.50 · error rate      smoothed, so one lucky answer proves nothing
                 + 0.35 · urgency         how overdue, in multiples of its own interval
                 + 0.15 · fragility       how often it has been forgotten before
                 + 0.25  if an open misconception )
```

Urgency is measured on the card's own clock: a 2-day card four days late is in
far more trouble than a 90-day card four days late. Misconceptions cut the line,
because a confident wrong model is worse than a gap — it produces wrong answers
everywhere downstream of it. Each ranked card carries a plain-language reason
(`missed 3 of 4`, `6d overdue (2d interval)`), which is what makes `/report`
worth reading.

A misconception counts as dissolved after three consecutive successes. Until
then it keeps re-testing itself.

## Requirements

- [pi](https://github.com/earendil-works/pi)
- A markdown reader for the journal. Obsidian is the easy choice — LaTeX and
  Mermaid both render with no plugins.
- **Optional:** a subagent implementation, for the `researcher`. With one, the
  agent verifies before it asserts. Without one it still teaches, and the tool
  guidance tells it to say plainly when it is working from memory instead of
  presenting it as checked. `agents/researcher.md` follows the format used by
  [pi-interactive-subagents](https://github.com/amosblomqvist/pi-interactive-subagents);
  adapt the frontmatter for other implementations.

## Known limits

- **Quizzes are single-select.** Multi-select would need a custom TUI component;
  `ctx.ui.select` is what this uses. In practice the teaching loop wants
  single-select almost everywhere.
- **The scheduler is unparameterised.** FSRS weights are the published defaults,
  not fitted to you. Fitting needs a few hundred reviews before it beats the
  defaults, which is a fair way off for a system this young.
- **The graph is not validated.** Nothing stops the agent recording a node whose
  dependency does not exist. `MEMORY.md` will show it; fix it by hand.

## Credits

- [amosblomqvist/learn](https://github.com/amosblomqvist/learn) — the teaching
  system this improves on, and the source of the two principles at its centre.
  The `teach` procedure here is a rewrite of its shape, not a copy of its text.
- [HumanLayer's `show-me`](https://github.com/humanlayer/skills) — the catalogue
  of compact visual forms, adapted here for lessons rather than codebases.
  ([the write-up](https://www.humanlayer.com/blog/show-me-skill))
- [FSRS](https://github.com/open-spaced-repetition/fsrs4anki) — the scheduling
  algorithm and its published weights.
- 3Blue1Brown, for "how could I have discovered this?", which is the whole of
  Principle 2.

## License

MIT.
