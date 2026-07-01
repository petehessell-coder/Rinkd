# WORKFLOW — how to run one sprint (Fable ↔ Opus)

> This is the *process* for executing any sprint in this program. The runbook says
> **which** sprint is next; this says **how** to run it. Read once; it applies to
> every sprint.

---

## Two roles, one team
- **Fable = the Product Council (the thinking).** Objective, spec, UX/design review,
  and adversarial QA. Reasoning-heavy, brand- and product-aware.
- **Opus = Engineering (the hands).** Implements the *approved* spec in the real
  codebase, then applies approved polish before merge.

**The handoff is a FILE, not a conversation.** Fable writes its spec/audit into
`Fable_Elevation_Program/audits/`; Opus reads that file and builds from it. This is
what keeps context from getting lost between models — the artifact is the interface.

---

## Match the ceremony to the work — two tracks

**Track A — Elevation / Migration** *(S03–S10, C01, C02, C09, C10)*
You're polishing existing screens, not inventing features. The audit already is the
spec. **Skip Vision + full Spec.** Run: **Objective → 🚦 approve → Build → QA → 🚦
approve → Polish + merge → log.**

**Track B — Net-new Build** *(C12 Operator Pages, and any real new feature)*
Greenfield surface with unknowns. Run the **full pipeline** below, all stages.

> Rule of thumb: if a sprint changes how an existing screen *looks/feels*, it's Track
> A. If it adds a screen, route, table, or workflow that doesn't exist yet, it's
> Track B.

---

## The full loop (Track B; Track A skips stages 1b–1c)

| # | Stage | Owner | Output |
|---|-------|-------|--------|
| 1a | **Objective** — load `00_MASTER_PROMPT.md` + `constitution/`; write this sprint's objective in one paragraph. *(Do NOT re-derive vision — the constitution IS the vision.)* | Fable | objective note |
| 1b | **Product spec** — user stories, workflows, edge cases, success metric, rollout. Cite real files. | Fable | `audits/<sprint>_spec.md` |
| 1c | **UX / design review** — IA, interaction, accessibility, visual polish vs `DESIGN_MANIFESTO.md` + `tokens.js`. | Fable | appended to spec |
| — | **🚦 GATE 1 — Pete approves the spec** before any code is written. | **Pete** | go / revise |
| 2 | **Engineering execution** — implement the approved spec in `rinkd_live`. Must open with a "Confirmed facts (trust these)" block citing real files/lines. No scope creep beyond the spec. | Opus | scoped PR/branch |
| 3 | **Adversarial QA** — verify against the objective AND the S01 A+ rubric + stress data. Run in a **fresh Fable session** so it isn't grading its own homework. | Fable | `audits/<sprint>_qa.md` |
| — | **🚦 GATE 2 — Pete approves refinements** before merge. | **Pete** | go / revise |
| 4 | **Final polish + merge** — apply approved refinements only. | Opus | merged |
| 5 | **Log the decision** — append any real product/design decision to `constitution/03_DECISION_LOG.md` with date + reason. | Fable | updated log |

---

## The QA checklist (Stage 3 — non-negotiable)
QA is not "does it match the vision." It is:
- **A+ rubric (S01):** obvious · premium · fewer taps · on-system (`tokens.js` +
  `ui/*`, no local `const C`) · loading+empty+error states · stress-safe · scalable ·
  Apple-shippable.
- **Stress data:** 60-char name, 5-sentence description, 14–0 score, no image, no data.
- **Saturday Night Test:** no polling (Realtime), no full-list fetch (cursor
  pagination), no blocking render, instant at 10,000 concurrent.
- **Grandparent Test:** first try, one-handed, no tutorial.
- **Guardrails:** nothing on the `04_NEVER_DO.md` list; no minor PII exposed;
  positioning stays "layer on top," never "replacement."
- **Diff discipline:** the PR does only what the spec approved — flag any scope creep.

If any check fails, QA writes the fix list and it goes back to Opus (loop 2→3), not
to merge.

---

## The two gates are the whole point
Everything auto-flows *except* GATE 1 (before code) and GATE 2 (before merge). Those
are yours. No code gets written on an unapproved spec; nothing merges on unverified
QA. This is what keeps a fast pipeline from shipping the wrong thing quickly.

---

## One-session-per-stage discipline
Start a fresh chat for the spec, and again for QA. Fresh context = sharper thinking
and no self-consistency bias. The files in `audits/` carry state between sessions, so
you lose nothing by starting clean.
