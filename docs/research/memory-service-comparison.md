# Memory Service Landscape: Full Comparison for Aurelius

> Research completed 2026-02-05. Evaluating whether to outsource memory extraction/storage to a third-party service.

## The Real Question

Not "which is the best memory API?" but **"should Aurelius stop building its own extraction pipeline and outsource it, so we can focus on workflow features?"**

The current extraction (Ollama + llama3.2:3b) hasn't been great. A lot of time has gone into memory plumbing instead of the "chief of staff" features. The question is whether any of these services solve extraction well enough to be worth the dependency.

---

## The Contenders

| Service | Type | Pricing | TypeScript SDK | Self-Host Option |
|---------|------|---------|----------------|------------------|
| **Supermemory** | Hosted API | $19/mo Pro | Yes (official) | No |
| **Mem0** | Open-source + hosted | $49/mo Pro (hosted) or free self-host | Yes (limited) | Yes (Apache 2.0) |
| **Zep** | Hosted + BYOC | $25/mo Flex | Yes (official) | Enterprise only (BYOC) |
| **Cognee** | Open-source + cloud | Free tier, pricing TBD | No (Python-first) | Yes (Apache 2.0) |
| **LangMem** | SDK/library | Free (OSS) | No (Python only) | N/A (it's a library) |
| **Letta** | Agent framework | Free (OSS) or cloud | Yes (official) | Yes (Apache 2.0) |

---

## Deep Comparison

### Supermemory

**What it does:** Managed cloud API. Send content, it extracts memories, builds a knowledge graph, returns context on search. "Hands-off" approach - you add content, it handles everything.

**Extraction approach:** Automatic. Their pipeline extracts facts, builds update/extends/derives relationships. You don't control the extraction prompts.

**Best for Aurelius:**
- Simplest integration (2-3 API calls replace the whole pipeline)
- User profiles (static + dynamic) would improve system prompt
- Sub-300ms search vs ~6s QMD
- Built-in connectors (Gmail, Google Drive, Notion)

**Concerns:**
- Black box extraction - can't tune for email metrics, meeting decisions, etc.
- Connector overlap with existing triage connectors
- Cloud-only, no self-host option
- Relatively new company

**Verdict:** Good "just make it work" option. Lowest effort integration. But you lose extraction customization.

---

### Mem0

**What it does:** Memory layer with LLM-based extraction, deduplication, and graph memory. Available as both open-source (self-hosted) and managed platform.

**Extraction approach:** Sends conversation to configurable LLM with structured extraction prompt. Classifies each extracted fact as new/update/duplicate/contradiction. More sophisticated dedup than string matching. Graph memory (Neo4j) for entity relationships.

**Best for Aurelius:**
- **Self-hosted with Ollama is possible** - but you'd need a bigger model (70B+) for reliable extraction
- Graph memory adds relationship traversal (something Aurelius lacks)
- Dedup/update/contradiction classification is genuinely better than current string-based approach
- Memory history tracking (changelog per fact)
- Apache 2.0 - take what you want

**Concerns:**
- **Python-first.** TypeScript SDK exists but is limited and designed for the hosted platform. Self-hosted requires running a Python server as a sidecar.
- Extraction prompt is still generic (doesn't know email vs meeting vs Slack)
- No debug/reasoning transparency like Aurelius' debug mode
- Self-hosted adds operational complexity (Python server + potentially Neo4j + vector store)
- The hosted platform ($49/mo) is more expensive than Supermemory for what you get

**Verdict:** Most mature open-source option. The extraction ideas (dedup classification, graph memory) are worth stealing even if you don't adopt the whole platform. But Python dependency is awkward for a TypeScript project.

---

### Zep

**What it does:** "Context engineering" platform. Ingests messages and business data, builds a temporal knowledge graph (Graphiti), returns engineered context blocks for your LLM prompts.

**Extraction approach:** Automatic fact extraction from conversations and business data (JSON, CRM data, etc.). Builds a **temporal knowledge graph** - facts have valid date ranges, so it knows when information changed. Generates user summaries automatically.

**Best for Aurelius:**
- **Temporal fact tracking** is genuinely unique - facts have "valid from/to" dates, handles "Adam changed jobs" natively
- Ingests arbitrary business data (JSON payloads) - great for triage items
- Context blocks are pre-engineered for LLM prompts (P95 < 200ms)
- Good TypeScript SDK
- Custom entity types and extraction instructions (Flex Plus)
- Webhooks for async processing

**Concerns:**
- Cloud-only for non-enterprise (no self-host on free/flex tiers)
- Credit-based pricing can be unpredictable (each "episode" = 1 credit, 350 bytes per credit)
- $25/mo for 20K credits, $475/mo for custom extraction instructions
- Custom extraction requires the expensive tier ($475/mo)
- No Ollama/local option

**Verdict:** Best temporal memory and context engineering. The temporal knowledge graph is the most sophisticated approach. But the pricing model is aggressive - custom extraction instructions (which Aurelius would need) require the $475/mo tier.

---

### Cognee

**What it does:** Open-source "AI memory engine" that builds knowledge graphs from documents. Combines vector search with graph databases. Claims 92.5% accuracy vs 60% for traditional RAG.

**Extraction approach:** ECL (Extract, Cognify, Load) pipelines. Builds ontologies, maps relationships, supports self-improvement through feedback loops. 38+ data types, 30+ connectors.

**Best for Aurelius:**
- Knowledge graph approach is powerful for relationship queries
- Open-source (Apache 2.0)
- Supports multiple graph backends (Neo4j, FalkorDB, NetworkX)
- Parameter tuning for extraction optimization
- Can run 100% local with Ollama

**Concerns:**
- **Python-only** - no TypeScript SDK at all
- More of an enterprise data platform than a simple memory API
- Overkill for a single-user personal assistant
- Maturity unclear for production use
- Would require significant integration work

**Verdict:** Interesting technology but wrong fit. Enterprise-grade knowledge graph platform is overkill for Aurelius' needs. Python-only is a dealbreaker.

---

### LangMem

**What it does:** LangChain's memory SDK. Extracts semantic, episodic, and procedural memories from conversations. Integrates with LangGraph's storage.

**Extraction approach:** Two modes - "hot path" (immediate extraction during conversation) or background (post-interaction). Uses LLM to extract and consolidate memories. Supports memory managers that handle create/update/consolidate operations.

**Best for Aurelius:**
- Well-designed memory type taxonomy (semantic, episodic, procedural)
- Background processing mode fits Aurelius' heartbeat pattern
- Free, open-source

**Concerns:**
- **Python-only**, deeply tied to LangChain/LangGraph ecosystem
- Not a standalone service - it's a library
- Would require adopting LangGraph as the agent framework
- Doesn't solve extraction quality on its own (still depends on your LLM)

**Verdict:** Good ideas but wrong ecosystem. Aurelius isn't built on LangChain and adopting it would be a major rewrite.

---

### Letta (formerly MemGPT)

**What it does:** Agent framework where the agent **manages its own memory** via tool calls. Three memory tiers: core (always in context), archival (vector-searchable), recall (conversation history).

**Extraction approach:** **Fundamentally different.** There's no separate extraction pipeline. The conversational agent itself decides what to remember by calling memory tools (`core_memory_append`, `archival_memory_insert`). The agent's "inner monologue" shows its reasoning about what to save.

**Best for Aurelius:**
- Eliminates the extraction pipeline entirely - the agent IS the extraction
- Built-in transparency (inner monologue shows memory reasoning)
- TypeScript SDK available
- Self-hosted (Apache 2.0) or cloud
- Elegant architecture inspired by OS virtual memory

**Concerns:**
- **Replaces the entire agent, not just memory.** Adopting Letta means using Letta as the chat runtime, not just the memory layer.
- Memory quality depends on the base model's tool-calling ability
- No guarantee the agent will save important things (it's autonomous, not systematic)
- Doesn't help with background extraction from triage items (it's conversation-focused)
- Major architectural change - would need to rebuild the chat system around Letta

**Verdict:** Most elegant architectural design, but it's an all-or-nothing agent framework, not a pluggable memory service. Would require rebuilding Aurelius' chat flow. Doesn't solve the triage/connector extraction problem.

---

## The Interesting Benchmark

Letta published a benchmark showing that **GPT-4o-mini agents with simple filesystem tools scored 74.0% on LoCoMo, beating Mem0's 68.5%** with its specialized memory infrastructure. Their argument: agents are already good at using familiar tools (grep, search files). Specialized memory APIs may actually perform worse because agents are less familiar with them.

This is a provocative finding that suggests **the extraction mechanism matters less than the LLM quality.** If you use a good model for extraction, even a simple approach works well.

---

## Honest Assessment for Aurelius

### The Core Problem

The current extraction isn't great because **llama3.2:3b is too small for reliable structured extraction.** This is a model quality problem, not an architecture problem. Options:

1. **Use a better model for extraction** - Switch from llama3.2:3b to a larger Ollama model (llama3.1:70b) or use a cloud model (Claude Haiku, GPT-4o-mini) for extraction calls. Cost would be minimal at your volume (~$5-10/mo). This is the cheapest fix.

2. **Outsource to a hosted service** - Let someone else handle extraction. Eliminates maintenance. Costs $19-49/mo.

3. **Adopt a self-hosted open-source solution** - Run Mem0 or Cognee alongside Aurelius. Gets better extraction but adds operational complexity.

### My Updated Recommendation

Given that your priority is **stop spending time on extraction and focus on workflow features:**

#### Option A: Supermemory (Simplest)
- Replace extraction + search pipeline with 2-3 API calls
- Keep triage connectors, daily notes, heartbeat (for connector syncing only)
- Remove: Ollama extraction, entity resolution, QMD, search.ts
- Cost: $19/mo
- Effort: Medium (integration work but net code deletion)
- Risk: Vendor dependency on core feature, black box extraction

#### Option B: Better Model + Simplify (Cheapest, Least Disruption)
- Switch extraction LLM from llama3.2:3b to Claude Haiku or GPT-4o-mini via API
- Keep current architecture but it works better with a smarter model
- Cost: ~$5-10/mo in API calls
- Effort: Low (change the model config, maybe tune prompts)
- Risk: Low, but doesn't reduce maintenance burden

#### Option C: Mem0 Hosted (Middle Ground)
- Use Mem0's hosted platform for extraction + storage + search
- Better dedup, graph memory, memory history
- Keep triage connectors, daily notes as input sources
- Cost: $49/mo
- Effort: Medium-High (Python ecosystem friction, API integration)
- Risk: TypeScript SDK limitations, more expensive

#### Option D: Zep (Best Context Engineering)
- Best temporal knowledge graph, pre-engineered context blocks
- Ingest triage items as "episodes" alongside chat messages
- Cost: $25/mo (basic) or $475/mo (custom extraction)
- Effort: Medium (good TypeScript SDK)
- Risk: Custom extraction needs expensive tier

### What I'd Actually Do

**Option A (Supermemory) for quick wins, with Option B as fallback.**

Here's why: You want to stop thinking about extraction. Supermemory is the most "set it and forget it" option. The integration is straightforward:

1. After each chat message: `client.add({ content: conversation, containerTag: "mark" })`
2. After each triage save-to-memory: `client.add({ content: enrichedContent, containerTag: "mark" })`
3. Before each chat response: `const context = await client.profile({ containerTag: "mark", q: userMessage })`
4. Remove: heartbeat entity extraction, QMD search, Ollama extraction, entity-resolution.ts

If Supermemory's extraction quality turns out to be bad for your specific use cases (email metrics, meeting decisions), you can fall back to Option B (better LLM for your existing pipeline) which is cheap and low-risk.

The key insight: **you don't have to pick one forever.** Start with Supermemory. If it doesn't work well enough, the fallback of using a better extraction model in your existing pipeline is always available.

---

## What to Keep Either Way

Regardless of which memory service you choose, these should stay:

- **Daily notes** - Still useful as raw conversation log / short-term context
- **Triage connectors** (Gmail, Granola, Linear, Slack) - These feed the inbox, not just memory
- **Heartbeat** - Still needed for connector syncing (just remove extraction steps)
- **Debug mode** - Adapt to instrument the new memory service calls
- **Chat flow** - Same streaming, tools, etc.

What gets removed:
- `lib/memory/ollama.ts` (extraction prompts)
- `lib/memory/entity-resolution.ts` (entity matching)
- `lib/memory/search.ts` (QMD integration)
- `life/` directory (entity files)
- QMD CLI dependency
- Most of heartbeat entity extraction logic
