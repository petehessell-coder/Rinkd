# COLLECTION C12 — Platform / Operator Front Door (the GTM unlock)

**Objective:** The polished, branded front door you show a partner platform or a big
operator — the concrete embodiment of the Platform Layer Play. This is the
reality-specific collection tied directly to Rinkd's GTM (not in the generic
ChatGPT plan, but the highest-leverage addition).

**Reality (from BUILD_PRIORITY.md + memory):**
- **Operator first-impression gap:** operators cool off because the front door reads
  as a consumer social feed and the ops tools are buried. Home Ice (event-centric,
  Featured hero at top) already began fixing this.
- **Enterprise Operator Pages — CONFIRMED OPEN:** no `featured_operators` table, no
  `Operator.js`, no `/o/:slug` route yet. This is the enterprise demo unlock.
- **Zero-build sales fix that exists today:** send a **demo-league deep link**, never
  the cold app — `/league/934dd511-e15e-4a07-94ff-1edd6ff31dfc`. Launch featured
  event = XRHL league `a1b2c3d4-e5f6-7890-abcd-ef1234567890` (has logo/brand color).

**Scope:**
- **Branded operator landing** (`/o/:slug`): a premium, image-rich page an operator
  can point their community to — their events, teams, standings, live games, a chip
  strip — that makes Rinkd look like *their* engagement layer.
- **Featured/pinnable inventory:** admin-pinnable `is_featured` on leagues/tournaments
  feeding the Home Ice hero + operator pages (fallback to largest/live event).
- **The demo experience:** ensure a cold evaluator landing on the featured event or a
  demo-league link sees a live, populated, premium product in seconds (never empty).
- **Partner-safe framing:** every string says "engagement layer on top of your
  platform," never "replacement." (Never-Do.)

**Deliverable:** `audits/C12_operator_front_door.md` — the operator-page spec
(route, data model for `featured_operators`, chip strip, hero), the demo-link
playbook, and the cold-evaluator checklist. This is a build spec, so hand it through
the normal `CLAUDE_CODE_PROMPT_*` flow when it's greenlit. **Guardrail:** premium,
populated, never-empty, partner-safe.
