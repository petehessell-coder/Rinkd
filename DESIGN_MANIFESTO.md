# Rinkd Design Manifesto
## The living design system — read this before touching any UI

---

## North Stars — These Override Everything

These five principles are non-negotiable. They sit above the aesthetic direction, the design tokens, and any individual screen decision. If a design choice conflicts with a north star, the design changes.

### 1. Stupid-Proof Simple
Every surface must work for a volunteer scorekeeper, a hockey grandparent, and a teenager who's never seen the app before — on the first try, without a tutorial.

- Big tap targets. No tiny icons for important actions.
- One primary action per screen. Never make the user choose between three equally prominent options.
- Labels beat icons every time when there's room for both.
- If the flow requires reading instructions, the flow is wrong.
- Error states must tell you exactly what to do next — not just that something failed.

*This extends to EVERY surface, not just live scoring. Admin flows, team management, registration — all of it.*

### 2. Intuitively Familiar
The flow must match what every smartphone user already knows. Don't invent new interaction patterns when an existing pattern already works.

- Pull-to-refresh refreshes. Always.
- Swipe back navigates back. Always.
- Tapping a card opens it. Never requires a separate "View" button.
- Notifications behave like every other app's notifications.
- If you have to explain how something works, redesign it.

### 3. Social-First Flow
The default mental model is Instagram / TikTok / Twitter — not a sports stats website. Every person with a smartphone already knows how to scroll a feed, like a post, follow someone, and share something. Exploit that.

- **Feed is the home.** Not a dashboard, not a schedule grid. A living scroll.
- **Actions are immediate** — like, comment, share happen in-place, no navigation.
- **Content is the product.** Game recaps, milestones, player moments — these are posts, not database records.
- Sharing must be one tap to native share sheet. No friction.
- Following teams/leagues/players should feel like following an Instagram account — instant, visible feedback.

### 4. Engaging
The app should be worth opening when there's no game happening.

- Feed has fresh content even between games (recaps, milestones, standings updates, community chirps).
- Stats are a story, not a table. Show the narrative — "Tyler's on a 5-game point streak" beats "G: 7, A: 12."
- Notifications bring people back. A POTG mention, a chirp reply, a milestone hit — these are reasons to open.
- Every empty state is an invitation, not a dead end.

### 5. Shareable and Sticky
If it can't be screenshotted and sent to a group chat, it's not designed right.

- Player stat cards, game recaps, POTG posts — these must look good as screenshots without the UI chrome.
- Share buttons are visible, not buried.
- Deep links work. Sharing a game card takes you directly to that game.
- Parents should want to post this. If a parent wouldn't share a stat card to their family group chat, the card isn't done.

---

## The Hierarchy

```
North Stars (above everything)
  └── 1. Stupid-Proof Simple
  └── 2. Intuitively Familiar
  └── 3. Social-First Flow
  └── 4. Engaging
  └── 5. Shareable & Sticky

Design Philosophy (serves the north stars)
  └── Premium / hockey-authentic aesthetic
  └── Arena visual language
  └── Motion and interaction system
  └── Typography-led layout
```

The aesthetic is the jersey. The north stars are the game.

---

## Who We Are

We are not building another sports app.
We are building the **digital hockey arena**.

The FLOW is Instagram-familiar. The SKIN is hockey-authentic. Never confuse the two — don't redesign how social media works, dress it in hockey.

Every screen competes with ESPN, Nike, Apple, and Strava. Act accordingly.

### What We Steal From Each Reference Brand

Rinkd is what you get if Facebook, Instagram, ESPN, Nike, and CCM all had a baby. Here's what we take from each — and what we leave behind.

| Brand | What we steal | What we leave behind |
|---|---|---|
| **Instagram** | Feed rhythm, follow model, community told through a scroll, in-place actions | Pastels, softness, influencer aesthetic |
| **ESPN** | Red as urgency, broadcast typography, the score bug, breaking-news energy on live events | Clutter, cramped layout, information overload |
| **Nike** | Typographic confidence — big, bold, no apology. Bold sans-serif authority. White space is earned, not default. | Cold minimalism, product-over-community |
| **CCM** | Grit. Equipment. Locker room culture. This is for players and hockey families who can smell the ice. | Darkness for darkness's sake |
| **Facebook** | Community layer — groups, events, the social graph of a rink | Endless scroll manipulation, low-quality content |

*If something feels too soft, it's too Instagram. Too cluttered, it's too ESPN. Too minimal, it's too Nike without the swagger. Too dark, it's too CCM without the warmth. Find the intersection.*

---

## The Emotional Goal

Every interaction should make the user feel one or more of:

- **Excited** — Red is in the frame. Live games have a red left-border on the card, the score pulses, the badge glows. If there's no red visible on a live screen, it's not done.
- **Competitive** — Stats are comparisons, not records. "Tyler leads the league in points" not "G: 7, A: 12." Rankings are visible without digging.
- **Proud** — Stat cards, POTG posts, and game recaps look good enough to screenshot and send to a group chat. If a parent wouldn't post it, the card isn't done.
- **Connected** — The rink has a pulse. Activity from teammates and opponents is visible in the feed even between games.
- **Immersed** — The typography, the motion, and the colors should feel like you're inside a hockey broadcast, not browsing a sports website.

Design around these emotions. If a screen doesn't trigger one, it's not done.

---

## Design Principles

1. **Motion has meaning.** Never animate for decoration. Animate to communicate state change, direction, or importance.
2. **Typography leads.** Build every screen around the type hierarchy first. Components exist to support type — not replace it.
3. **Information density beats empty space.** Hockey parents and coaches want data. Empty whitespace feels like the app doesn't know anything yet.
4. **Hockey culture over startup culture.** No glassmorphism. No gradients-for-gradients-sake. No oversized rounded cards.
5. **Every interaction should feel intentional.** If you can't explain why a button has that shadow or why that animation goes that direction, remove it.
6. **Speed is a feature.** 60fps, transitions under 250ms, no jank. A game is live. Latency is embarrassing.
7. **Community is always visible.** The app is never empty. If the feed is empty, that's a designed moment — not an afterthought.

---

## What We Are NOT

Never imitate:
- Instagram (too soft, too social-media)
- Generic SaaS dashboards (tabs, tables, KPI cards)
- Material UI defaults
- Bootstrap grid layouts
- Dribbble trends (glassmorphism, neomorphism, whatever is trending)
- Template marketplaces
- "Modern sports app" — that phrase means nothing

If a screen looks like something found on Dribbble in 5 seconds, it needs a redesign.

---

## The Arena Analogy — Apply This Everywhere

| App Element | Think of it as | NOT | What it looks like |
|---|---|---|---|
| Bottom nav | Scoreboard bug | Tab bar | Compact, icon + label, hugs the bottom edge — not floating cards |
| Section headers | Broadcast lower-third | Card title | White text on solid navy/red bar bleeding to the left edge, Barlow Condensed 700 italic, all caps. Think "PERIOD 2 · LIVE" not "Recent Games" |
| Stats | TV score overlay | Spreadsheet row | Number first, huge, Barlow Condensed 900 italic. Label underneath, small and muted. Never in a bordered table. |
| Player card | ESPN player graphic | Profile tile | Name in large condensed italic across the card. Position/number as a secondary mark. Stat highlight visible without tapping. |
| Notification | Goal horn moment | Toast popup | Bold, red-accented, feels like something just happened — not a subtle banner |
| Loading state | Period intermission | Spinner | Skeleton screens matching exact layout. Copy: "Getting the ice ready." Never a generic spinner. |
| Empty state | Pre-game warmup | "No data" | Rizzo the mascot + punchy one-liner. An invitation, not an error. |
| Live indicator | Red light on, siren | Green dot | Pulsing red ring expanding outward, 1.5s infinite. You feel it before you read it. |
| Feed | Arena feed board | Social media scroll | Cards with real hierarchy — live games float above everything else |

---

## Design Tokens

### Colors
```
Background (deep rink): #0A1E38
Surface (boards):       #0f2847
Surface elevated:       #162f55  ← use for cards that matter
Border default:         rgba(46,91,140,0.4)
Border accent:          rgba(46,91,140,0.8)
Red (primary CTA):      #D72638
Red glow:               rgba(215,38,56,0.35)
Ice white (text):       #F4F7FA
Muted (secondary text): #8ba3be
Gold (milestone/award): #C9A84C
```

### Color Intent — When to Use What

**Red (#D72638): action and urgency only.**
CTAs, live indicators, goal alerts, error states. If red is on screen and nothing urgent is happening, remove it. Red means something is alive or something needs your attention — never decoration.

**Blue glow (rgba(46,91,140)): live game cards and elevated surfaces.**
The rink light. Use for game card shadows and border accents on hero surfaces. Not for buttons.

**Gold (#C9A84C): milestones, awards, achievements — and nothing else.**
Scarce by design. If gold appears on more than one element per screen it loses all meaning. Reserve it for POTG badges, streaks, and personal bests.

**Ice white (#F4F7FA): primary text only.**
Never a background. Never decorative. Text that matters gets this color.

**Muted (#8ba3be): secondary info that should stay secondary.**
If something is muted color, it's allowed to stay quiet. Don't let it compete with primary content by making it larger or bolder.

### Typography
```
Hero moments:    Barlow Condensed, 900, italic — 48–72px
Page titles:     Barlow Condensed, 900, italic — 28–36px
Section heads:   Barlow Condensed, 700, italic — 18–22px
Body / labels:   Barlow, 500, normal — 13–15px
Numbers/stats:   Barlow Condensed, 900, italic — always
Metadata:        Barlow, 400, normal — 11–12px, muted color
```

Typography rule: **stat numbers are always Barlow Condensed 900 italic**. They look like a jersey. That's the point.

### Spacing Rhythm
Base unit: 4px. Everything is a multiple of 4.
```
xs:  4px
sm:  8px
md:  16px
lg:  24px
xl:  32px
2xl: 48px
```

### Corner Philosophy
Not everything gets the same radius.
```
Cards (standard):   12px
Buttons:            999px (pill — decisive, not bubbly)
Badges / chips:     6px
Hero surfaces:      0px or 4px (sharp = hard = hockey)
Modal sheets:       16px top corners only
```

The app should NOT feel like a pillow. Sharp corners on hero surfaces are intentional.

### Shadow / Depth System
Three levels — use intentionally:
```
Resting (standard card):  none — flat on the surface
Active / hover:           0 4px 16px rgba(0,0,0,0.4)
Hero / CTA:               0 8px 24px rgba(215,38,56,0.35)  [red glow for primary]
                          0 8px 24px rgba(46,91,140,0.4)   [blue glow for game cards]
Live game cards:          0 0 0 1px rgba(215,38,56,0.6), 0 8px 32px rgba(215,38,56,0.2)
```

### Card Hierarchy
Three types — pick the right one:

**card-hero** — Live games, featured content. Feels like the TV is on. Slightly elevated surface (#162f55), 1px red border glow, blue box-shadow underneath. You notice it before you read it. Use for: live games, pinned announcements, featured player moments.

**card-standard** — Regular feed content. The rink wall — flat, navy, no shadow. Just content. No decoration competing with what's inside. Use for: game recaps, standings updates, regular chirps.

**card-quiet** — Metadata, secondary info. Fades into the background like the fine print on the back of a ticket. Lower opacity border, more transparent background. Never competes. Use for: timestamps, secondary stats, admin info.

---

## Motion Language

Puck physics: **quick acceleration, smooth stop**. Not the other way around.

```
Entrance:        fade-in + translateY(-8px) → (0), 250ms, ease-out
Exit:            fade-out + translateY(8px), 200ms, ease-in
Press/tap:       scale(0.97), 100ms, ease-in-out
Score update:    scale(1.15) → (1.0), 300ms, spring (bounce)
Live pulse:      ring expand 0→16px, opacity 1→0, 1.5s infinite
Tab indicator:   slide, 200ms, cubic-bezier(0.4, 0, 0.2, 1)
Number change:   count up from prev value, 400ms, ease-out
Sheet slide up:  translateY(100%) → 0, 350ms, cubic-bezier(0.32, 0, 0.67, 0)
```

### Hockey-Specific Motion Moments

These are not generic animations — they are tied to specific in-game events and must feel right.

- **Goal scored:** Score number does a single hard bounce — scale(1.2) → scale(1.0), 200ms, cubic-bezier(0.34, 1.56, 0.64, 1). Hard like a puck hitting the post. Not soft. Not springy.
- **POTG award:** A single gold shimmer sweeps across the card left-to-right, 600ms, plays once. Never loops.
- **Live game card activates:** The card border animates on left-to-right — like a light turning on in the rink. 400ms, ease-out.
- **New chirp/comment arrives:** Slides in from the bottom of the list, 250ms ease-out. Feels like a message, not a page refresh.
- **Personal milestone hit:** Brief scale pulse on the stat number (scale 1.0 → 1.1 → 1.0), gold color flash, 300ms. Earned, not cheap.

Rules:
- No animation over 400ms (except loading states)
- No bounce on nav transitions — directional only
- Every animation must reduce perceived wait time or communicate meaning
- Disable all animation at `prefers-reduced-motion`

---

## Interaction Principles

**Every interactive element needs 4 states:**
1. Resting
2. Hover (desktop) / Touch active (mobile) — scale 0.97 + shadow shift
3. Loading / processing
4. Success / error

**Primary buttons (red):**
- Pill shape, red fill
- Box shadow: `0 8px 24px rgba(215,38,56,0.35)`
- On press: shadow collapses to `0 2px 8px`, scale 0.97
- Feels physical. Like pressing a puck into tape.

**Secondary buttons:**
- Transparent fill, bordered
- On press: background fills to `rgba(46,91,140,0.2)`

**Like / reaction:**
- Scale bounce on tap: 1.0 → 1.3 → 1.0, 300ms
- Color fills in during bounce
- Count increments with a brief translateY(-4px) slide

---

## Screen Design Process (use this every time)

Before writing a single line of code or component, answer:

1. **What is the primary story this screen tells?**
2. **What emotion should the user feel in the first 2 seconds?**
3. **What is the single most important action on this screen?**
4. **What would make a senior product designer at Apple raise an eyebrow (in a good way)?**
5. **What obvious solution am I avoiding?**

If you can't answer all 5, the screen isn't ready to implement.

### The 2-Second Test

After implementing any screen, cover it after 2 seconds. The user should be able to answer both of these without reading anything:

1. **Is something live right now?**
2. **What am I supposed to do here?**

If they can't answer both — the visual hierarchy is wrong. Fix the hierarchy, not the copy.

---

## Anti-Patterns — Hard No

- Random gradients (gradient must be earned)
- Every card the same size, shape, and color
- Generic loading spinner with no personality
- Tab icons that are just emoji
- "No posts yet" as an empty state
- Flat avatar circles on white/light backgrounds
- Stats in a table with borders
- Padding that feels like it came from a design system you didn't write
- Cluttered toolbars with 6+ actions
- Info without hierarchy (everything the same size)

## Hard Yes — Signs It's Done Right

The anti-patterns tell you what to avoid. These tell you when you've landed it:

- A parent would screenshot it and send it to the family group chat without being asked
- It looks like it belongs on a broadcast — not a website, not an app store template
- The stat number looks like it belongs on a jersey
- Red is visible on every live surface
- You can tell something is live within 2 seconds without reading
- A volunteer grandparent could figure out the primary action without help
- You could remove the Rinkd logo and it still feels unmistakably like Rinkd

## Visual Reference Points

When designing, anchor against these specific references — not the brand as a whole, but the specific element listed:

- **ESPN ScoreCenter score bug** → how live scores look in the corner of a broadcast. Compact, always visible, instantly readable.
- **Nike SNKRS app drop card** → how a hero card commands full attention without being loud.
- **Instagram Stories progress bar** → how live state is communicated passively without UI clutter.
- **CCM product page typography** → how to make a number feel like it belongs on a jersey.
- **NFL RedZone channel switcher** → how to communicate multiple live events without confusion.

If your design doesn't hold up against these references, it's not done.

---

## Onboarding Narrative — Locker Room → Tunnel → Ice

This is the single most important first impression in the product. It plays once, on first signup, and never again. It must feel real — not illustrated, not cartoon, not a gradient approximation. Enterprise quality. NHL quality.

### The Arc

**Locker Room (Signup/Onboarding)**
Dark, close, intimate. The user is getting ready. Birth year, name, team selection happen here. The visual environment is a real hockey locker room — stalls, tape, jersey hooks, rubber floor, the smell of the game implied by the image. This is private and focused. The UI sits on top of the photograph, not in front of a generic dark background.

**The Tunnel (Transition)**
When the user completes onboarding and hits the final CTA, the screen pushes forward. A short video clip (3–5 seconds, real footage) of walking down a hockey tunnel toward the ice. POV perspective — the player's eyes, low, moving forward. Light growing at the end. Boards becoming visible. This plays once, ever. It is not skippable on first run. It transitions directly into the first feed load.

**The Ice (First Feed)**
The feed rises up from below as the tunnel clip ends. Full brightness after the darkness. Live game cards glowing. The arena opens. The contrast with the locker room is the entire point — you earned the ice.

### Non-Negotiables

- **Real photography and video only.** No CSS gradients, no illustrations, no stock icons of hockey sticks. If the image doesn't look like it was taken in an actual rink, replace it.
- **The tunnel clip is a real video.** Compressed for PWA (target under 2MB), autoplay muted, plays once on first login and never again. Stored in localStorage to track whether it's been seen.
- **This plays once.** The moment it's seen twice it becomes an annoying loading screen. Flag it in localStorage on completion.
- **Fallback.** If video fails to load or device is low-power, a single high-quality still photograph of the tunnel (brightness at the end) with a fade transition is acceptable. Never a spinner.

### Asset Requirements

Two paths — choose based on timeline:

**Shoot it (right answer long-term):** One 2-hour session at Crystal Fieldhouse or any pilot rink. iPhone 15 Pro or better. Shots needed: locker room wide (stalls, gear, rubber floor), locker room detail (taped stick, jersey hook), tunnel POV walking toward ice, ice surface reveal from tunnel mouth. Ownable, authentic, free.

**License it (faster to pilots):** Getty Images and Shutterstock have usable hockey tunnel and locker room footage. Search: "hockey tunnel POV," "hockey locker room," "NHL dressing room," "hockey player entering ice." Budget $50–200 for the right shots. Not ownable but gets you to Northern Prospects launch on time.

### Reference Quality Bar

- NHL app player profiles
- ESPN's "NFL Films" style opening sequences  
- Under Armour's "Rule Yourself" campaign visual language
- Any behind-the-scenes NHL access content (players walking to ice)

If it doesn't look like it belongs in one of those contexts, it's not done.

---

## Loading States — The Period Intermission Rule

**Loading is not an interruption. It's part of the experience.**

The old way: spinner + "Loading Rinkd…" — feels like a gap in the product.
The Rinkd way: the loading state should feel like a period intermission — expected, branded, part of the rhythm.

Rules:
- **Never a generic spinner.** Ever.
- **Skeleton screens** must match the exact layout of what's coming — same card shapes, same spacing. Already partially built in `Skeletons.js` — use them everywhere.
- **Loading copy** (when needed): *"Getting the ice ready."* / *"Warming up."* / *"Dropping the puck."* — short, hockey, never generic.
- **If the load is under 300ms,** show nothing. Flash of skeleton is worse than no skeleton.
- **If the load is over 1s,** show a skeleton + subtle shimmer animation on the placeholder elements.

---

## The Benchmark Question

Before shipping any screen, ask:

> **"Why would someone remember this interface?"**

If there's no answer, it needs work.

---

## Rinkd in One Sentence

*The digital arena for hockey — fast, cold, competitive, and unmistakably ours.*
