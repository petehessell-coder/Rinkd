# COLLECTION C05 — Social Network Effects (the hockey identity layer)

**Objective:** Make Rinkd the default **hockey identity** — the graph that makes the
whole app more valuable as more of hockey joins. This is the moat behind the
Platform Layer Play.

**Real surfaces & files:** `Profile.js` + `/profile/:userId`, `Team.js`,
`lib/teams.js`, `lib/userRole.js`, follow mechanics, `Mentions.js`/`lib/mentions.js`,
`Discover.js`, `lib/publicShare.js`, `ogCard.js`, deep-link handling.

**Scope:**
- **Identity:** a player's Rinkd profile is portable across every league/tournament
  they play — one identity, many contexts (league stats + tournament stats shown
  separately per Decision Log). Make the profile feel like *the* hockey ID card.
- **The follow graph:** you follow rinks, teams, leagues, tournaments, and players —
  not just people. Define what each follow *does* (what shows up on Home Ice).
- **Network-effect loops:** every public profile/team/event page is discoverable and
  shareable (SEO + `ogCard`), so each new participant pulls in their circle.
- **Youth boundary:** minors are name-gated publicly; parents JOIN kids' teams. The
  identity layer must respect this without breaking discovery for adults.

**Deliverable:** `audits/C05_network_effects.md` — the identity/graph model
(what you can follow, what each follow surfaces), the discovery/SEO checklist, and
the viral-loop map. **Guardrail:** never expose minor PII; never make identity feel
like a database record — it's a card people want to share.
