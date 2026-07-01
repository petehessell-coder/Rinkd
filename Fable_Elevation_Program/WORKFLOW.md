# WORKFLOW — how to run one sprint (Fable ↔ Opus)

> This is the *process* for executing any sprint in this program. The runbook says
> **which** sprint is next; this says **how** to run it. Read once; it applies to
> every sprint.

---

## Two roles, one team
- **Fable = the Product Council (the thinking).** Objective, spec, UX/design review,
  and adversarial QA. Reasoning-heavy, brand- and product-aware.
- **Engineering = the hands.** Implements the *approved* spec in the real codebase,
  then applies approved polish before merge. The engineering seat is **model-tiered**
  (see below) — not always the same model.

**The handoff is a FILE, not a conversation.** Fable writes its spec/audit into
`Fable_Elevation_Program/audits/`; the engineer reads that file and builds from it.
This is what keeps context from getting lost between models — the artifact is the
interface.

---

## Which model executes (tier the engineer, like we tier the ceremony)
Published benchmarks (Jul 2026): Opus 4.8 leads agentic coding (SWE-bench Pro ~69%
vs Sonnet 5 ~63%); on *well-specified* work they produce near-identical output, and
Sonnet 5 is faster. Sonnet's only real weakness is **ambiguity** — which a good Fable
spec removes. So:

- **Default engineer = Sonnet 5.** Use it for **Track A** (elevation/migration —
  tight spec, mechanical: token migration, adding `track()` calls, empty-state
  adoption) and for **Track B builds whose spec is tight**. This is the bulk of the
  program — same quality, faster, cheaper.
- **Escalate to Opus 4.8 when** the work is: architecturally ambiguous or net-new;
  **correctness-critical** — anything touching **RLS, auth, payments, youth-privacy,
  or prod schema**; a large cross-cutting refactor; or a nasty debugging session.
- **Adversarial QA (stage 3) runs on the stronger model** (Opus 4.8 or Fable) for any
  correctness-critical sprint, even when Sonnet 5 built it — that's where "fewer
  errors on complex multi-step" pays off.

> Rule of thumb: the better Fable's spec + the two gates, the more you can safely push
> down to Sonnet 5. Investing in the thinking step is what unlocks cheaper execution.
> When unsure on a given sprint, run it on Sonnet 5 first; escalate to Opus only if
> QA flags real errors.

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
| 2 | **Engineering execution** — implement the approved spec in `rinkd_live`. Must open with a "Confirmed facts (trust these)" block citing real files/lines. No scope creep beyond the spec. | Engineer (Sonnet 5 default · Opus 4.8 if escalated) | scoped PR/branch |
| 3 | **Adversarial QA** — verify against the objective AND the S01 A+ rubric + stress data. Run in a **fresh Fable session** (or Opus 4.8 for correctness-critical) so it isn't grading its own homework. | Fable / Opus 4.8 | `audits/<sprint>_qa.md` |
| — | **🚦 GATE 2 — Pete approves refinements** before merge. | **Pete** | go / revise |
| 4 | **Final polish + merge** — apply approved refinements only. | Engineer (same model as stage 2) | merged |
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
