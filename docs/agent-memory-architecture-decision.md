# Minga Agent Memory Architecture Decision Framework

---

## The Two Architectures

### Architecture A: Provider-Hosted Memory (The Conway Model)

In this model, each tool's memory lives inside the provider. Claude Code's `CLAUDE.md` files and project memories stay in Anthropic's ecosystem. Gemini's context lives in Google's infrastructure. Cursor's codebase understanding lives in Cursor. Each department's agents accumulate knowledge within their respective platforms.

**How it works for Minga:**

- Engineering uses Claude Code with per-repo `CLAUDE.md` files and project memories. Institutional knowledge about your legacy codebase accumulates in Anthropic's memory layer.
- Teams using Gemini through your Google Enterprise account get workspace-integrated memory — docs, calendar context, email patterns.
- Cursor users build up codebase understanding within Cursor's index.
- Each tool gets smarter about Minga's context independently, but none of them talk to each other.

**What the provider controls:**

- Memory format, storage, retention policy, and access patterns
- What gets remembered vs. forgotten
- How memory is surfaced during interactions
- Whether and how you can export accumulated context
- Pricing for memory/context features (which will increase as they become load-bearing)

**What you control:**

- What you put into each system
- `CLAUDE.md` files (which are just files in your repos — actually portable)
- Your Snowflake data warehouse
- Your source code

**Setup time:** Days. You're already partially here.
**Ongoing maintenance:** Low per-tool, but multiplied across tools with no integration between them.

---

### Architecture B: Self-Owned Memory (The Open Brain Model)

In this model, Minga owns a central knowledge layer — a database and service you control — exposed to any model through MCP servers. Organizational knowledge, product context, codebase documentation, and workflow patterns live in your infrastructure. Models are consumers of this knowledge, not custodians of it.

**How it works for Minga:**

- A central knowledge service (likely PostgreSQL with pgvector, or a purpose-built solution) stores organizational context: product specs extracted from code, architectural decisions, department-specific knowledge, workflow patterns.
- MCP servers expose this knowledge to any tool — Claude Code, Gemini, Cursor, Codex, n8n pipelines, or whatever comes next.
- A PII firewall layer sits between your knowledge base and any model provider, ensuring school/student data never leaves your infrastructure in raw form.
- Long-horizon modernization pipelines read from and write to this shared context, so work done by one team or agent is visible to others.
- Your Snowflake warehouse connects through this layer too — reporting context is available to agents without exposing raw PII.

**What infrastructure you'd need:**

- A PostgreSQL instance with pgvector (you likely already have Postgres)
- 2-3 MCP servers: one for product/code knowledge, one for organizational context, one as a PII-aware gateway to Snowflake
- An orchestration layer (n8n is a reasonable choice here) for long-running pipelines
- A thin API or gateway that handles auth and PII scrubbing

**What protocol layer connects it to models:**

- MCP (Model Context Protocol) — supported by Claude Code natively, Cursor, and increasingly others
- For Gemini through Google Workspace, you'd use Google's tool/function-calling to bridge to the same backing services
- For unsupervised pipelines, direct API access to the knowledge layer

**Setup time:** 4-8 weeks to MVP with a dedicated champion (you) and SRE support.
**Ongoing maintenance:** 3-5 hours/week for the knowledge layer itself, plus ongoing curation of what goes into it.

---

## Decision Matrix

Scored 1-5 (5 = best). Weights reflect Minga's stated priorities.

| Dimension | Weight | A: Provider-Hosted | B: Self-Owned | Notes |
|---|---|---|---|---|
| Time to working prototype | 2 | **5** | 2 | A is already partially working |
| Ongoing maintenance burden | 2 | 4 | **3** | A is lower per-tool but fragmented |
| Switching cost at 6 months | 3 | 2 | **5** | A accumulates non-portable context fast |
| Switching cost at 18 months | 4 | 1 | **5** | At 18 months, A's memory is deeply embedded |
| Memory richness | 5 | 2 | **5** | B enables cross-tool, cross-department memory |
| Multi-model flexibility | 5 | 1 | **5** | A silos each provider; B serves all of them |
| Extension/tool ecosystem | 2 | 4 | **3** | A has built-in integrations; B needs wiring |
| Data sovereignty / PII | 5 | 1 | **5** | **This is the decisive dimension for Minga** |
| Cost trajectory | 3 | 2 | **4** | Provider memory features will get expensive |
| Cross-org knowledge sharing | 5 | 1 | **5** | A cannot do this; B is built for it |

| | A: Provider-Hosted | B: Self-Owned |
|---|---|---|
| **Weighted Total** | **72 / 180** | **156 / 180** |

This isn't close. Your constraints — PII, multi-provider, cross-org knowledge sharing — make provider-hosted memory architecturally untenable as a primary strategy.

---

## The MCP vs. Proprietary Extension Trade-off

You said all cards are on the table, so this is relevant.

**The proprietary distribution argument:** Claude Code plugins (`.cnw.zip`), Cursor extensions, etc. give you discoverability where your engineers already work. If your team lives in Claude Code, a well-built plugin with custom commands and agents is immediately useful with zero adoption friction.

**The open MCP argument:** An MCP server that exposes Minga's product knowledge, architectural context, and safe Snowflake access works in Claude Code, Cursor, Codex, and anything else that speaks MCP. You build once. When the next tool shows up in 6 months that your team wants to try, it already works.

**The historical pattern:** This is the App Store vs. open web question. Proprietary formats win on distribution and polish. Open protocols win on longevity and reach. But here's the thing — you're not building for external distribution. You're building for your own 20-person engineering team. You don't need an app store. You need interoperability across the tools your team already uses.

**Recommendation for Minga:** Build MCP servers as your primary integration layer. If specific teams want Claude Code plugins or Cursor extensions as thin convenience wrappers around those MCP servers, fine — but the knowledge and logic lives in the MCP layer, not in any proprietary format. The plugins become UI sugar, not the architecture.

---

## The Honest Trade-off

**The convenience tax with Architecture A:**
You're already paying it. Your Claude Code memories know things about your codebase that Cursor doesn't. Your Gemini workspace context knows things about your org that Claude doesn't. Every week this continues, the silos deepen. The tax isn't money — it's fragmentation. Your agents don't share a brain, and in an org trying to coordinate across departments, that's the whole problem.

**The portability tax with Architecture B:**
Real talk: this is 4-8 weeks of focused engineering work to get an MVP, and it needs a champion. You've volunteered for that role, which is good, because this kind of infrastructure rots without one. The ongoing cost is modest (your SRE team can handle it), but the initial build requires someone who understands both the AI tooling landscape and Minga's organizational needs. That's you. If you leave or get pulled to something else before it's stable and adopted, it will decay.

**The behavioral context question:**
Can you export what Claude Code has learned about your codebase? Partially — `CLAUDE.md` files are just markdown in your repos, and that's genuinely portable. But the *behavioral* context (how Claude navigates your specific codebase, what patterns it's learned from your corrections) lives in Anthropic's infrastructure and is not exportable. With Architecture B, the knowledge you curate in your own systems is yours forever, in a format you control.

**The "most users" problem:**
Most companies will go with Architecture A because it's easier and they don't have the constraints you do. But Minga is not most companies. You have:

- PII from minors in K-12 schools (FERPA, COPPA implications — this alone should be disqualifying for provider-hosted memory of any substantive organizational data)
- A multi-provider tooling environment that isn't going to consolidate
- A cross-departmental knowledge sharing requirement that no single provider solves
- An explicit goal of long-horizon automated pipelines that need shared context

You are genuinely in the minority that needs to own this layer.

---

## The Hybrid Option

This is actually the recommended approach for Minga. Pure self-owned is the right *architecture*, but you should be pragmatic about the *interface layer*.

**The hybrid:**

- **Own the memory.** Your knowledge layer — product context, architectural decisions, organizational knowledge, PII-scrubbed Snowflake access — lives in your infrastructure, in PostgreSQL with pgvector, exposed through MCP servers.
- **Use provider interfaces.** Your engineers keep using Claude Code, Cursor, Gemini, whatever they like. These tools connect to your knowledge layer through MCP. The interaction experience is provider-hosted. The knowledge is yours.
- **PII firewall.** A mandatory gateway layer between your knowledge base and any model provider. Student data, school data, anything covered by FERPA/COPPA goes through a scrubbing layer before it touches any external model. This is non-negotiable for edtech with K-12 data.
- **n8n for orchestration.** Your unsupervised pipelines and long-horizon modernization work runs through n8n (self-hosted), reading from and writing to the same knowledge layer. This means automated pipelines and human-driven agent sessions share context.
- **`CLAUDE.md` as cache, not source of truth.** Keep using `CLAUDE.md` files in repos — they're great for per-repo developer experience. But treat them as a cache of knowledge that originates in your central system, not as the canonical store.

**What this gives you:** Portability of the valuable part (organizational knowledge, product context, PII-safe data access) while keeping the developer experience your team already likes. When a new tool shows up — and it will — it plugs into the same knowledge layer.

**What it costs:** More setup than pure provider-hosted. Your SRE team needs to treat the knowledge layer as production infrastructure. You need to build the PII scrubbing layer thoughtfully, not as an afterthought.

---

## Implementation Recommendation

**Architecture B (Hybrid variant) is the clear choice for Minga.**

The PII constraint alone makes this decision for you, but the multi-provider environment and cross-org knowledge sharing requirement confirm it independently.

### First three steps this week

1. **Stand up a PostgreSQL + pgvector instance** in your existing infrastructure. Seed it with one concrete knowledge domain — pick either your product's architectural structure (extracted from the codebase) or your Snowflake data dictionary. Just one. Make it real and useful before making it comprehensive.

2. **Build your first MCP server** that exposes this knowledge to Claude Code. Your engineering team already likes Claude Code — give them something that makes their existing workflow better. "Ask the codebase questions" or "get context on this module's history and dependencies" are good starting points. The adoption story is: this makes the tool you already use smarter.

3. **Design your PII firewall contract.** Before any Snowflake data or student-adjacent information flows through this system, define what gets scrubbed, what gets anonymized, what never leaves your infrastructure. Write this down as a policy document, not just code. Have it reviewed by whoever handles FERPA compliance at Minga.

### Re-evaluation checkpoint

Revisit this architecture in **8 weeks**. The questions to ask:

- Is the engineering team actually using the MCP-connected knowledge layer, or are they ignoring it?
- Is the PII firewall holding up under real usage patterns?
- Has a new provider or tool emerged that changes the multi-model calculus?

If adoption is low after 8 weeks, the problem is likely the knowledge quality, not the architecture. Fix what's in the knowledge layer before questioning the approach.

### The one thing you should not do regardless of path

**Do not put K-12 student PII into any provider-hosted memory system.** Not Claude's project memory, not Gemini's workspace context, not Cursor's index. Even if the provider says it's safe, even if their terms say they don't train on it. You are in edtech with minors' data. The regulatory, reputational, and ethical risk is not worth the convenience. Keep PII in infrastructure you control, behind a scrubbing layer you audit.

---

## Platform Risk Weather Report

Every major lab is converging on persistent agent layers — Anthropic with Claude Code's memory and projects, Google with Gemini's workspace integration, OpenAI with Codex's autonomous agents and memory. In 12 months, these will be significantly more capable and significantly more sticky. The window where you can build a self-owned knowledge layer and have it be *the* place your organizational context lives is right now. If you wait a year, your teams will have accumulated 12 months of provider-specific context that's painful to migrate, and the convenience gap between provider-hosted and self-owned will have widened. But Minga's constraints — PII from minors, multi-provider reality, cross-departmental coordination — aren't going away. If anything, FERPA enforcement around AI systems is tightening, not loosening. The industry is making it easier to go all-in on one provider. Your job is to make sure Minga owns the layer that matters (your organizational knowledge and data) while riding the wave of provider competition for everything else (model quality, interface, speed). Build the brain now. Let the providers compete to be the best mouth.
