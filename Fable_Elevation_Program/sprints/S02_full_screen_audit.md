# SPRINT S02 — The Full Screen Audit (A+ → D)

> Prereq: `00_MASTER_PROMPT.md` + the S01 inventory/rubric. THINKING/AUDIT sprint —
> **no code changes.** This is the map the entire elevation program executes against.

---

Treat the current application as the source of truth. Do NOT redesign. Audit every
existing screen from the S01 inventory using the S01 rubric.

### For each screen, produce:
- **Grade:** A+ / A / B / C / D (only A+ is acceptable long-term).
- **Is it obvious?** (Grandparent Test — first try, one-handed, no tutorial.)
- **Is it premium?** Does it create delight, or confusion?
- **Fewer taps?** Where can steps be removed?
- **Hierarchy correct?** Is the one primary action unmistakable?
- **On brand?** Uses `tokens.js` + `components/ui`, or redeclares local styles?
- **State resilience:** does it have real loading (geometric skeleton), empty
  (an invitation), and error (tells you what to do next) states?
- **Stress-test result:** paste the CLAUDE.md torture data mentally — 60-char team
  name, 5-sentence description, 14–0 score, missing image, no data. What breaks?
- **Scalable?** Any polling, full-list fetch, or blocking render? (Saturday Night
  Test.)
- **Would Apple ship this?**

### Method
- Actually open each file in `src/pages/` and its key components. Cite the real file
  and the specific lines/patterns you're grading — no generic advice.
- Where a screen already uses the design system well, say so (e.g. `Profile.js` uses
  `StatNumber`). Where it drifts (local palette, hand-rolled header, generic
  spinner), flag the exact spot.
- Grade honestly. If the front door is a B, say B and say why.

### Deliverable
`Fable_Elevation_Program/audits/S02_screen_audit.md` — one section per screen with
the fields above, plus a **ranked worklist** at the top: every screen below A+,
ordered by (impact on the mission × how cheap the fix is). That ranked worklist
becomes the backlog the later sprints pull from. **No source changes.**
