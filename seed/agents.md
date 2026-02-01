# Agents

## Model Routing

| Task | Model | Notes |
|------|-------|-------|
| draft_reply | claude-sonnet-4 | Needs nuance and style |
| classify | claude-haiku | Fast, high volume |
| extract_facts | claude-sonnet-4 | Reasoning about relevance |
| summarize | claude-haiku | Straightforward compression |
| chat | claude-sonnet-4 | Default for conversation |
| chat_complex | claude-opus-4 | Deep analysis on request |

## Autonomy Levels

### Automatic (visible + undoable)

- Create/modify entities
- Supersede facts
- Create/modify triage rules
- Generate embeddings
- Sync connector state
- Write to activity log

### Requires Approval

- Update configs (soul, agents, processes)
- Change model routing
- Modify autonomy levels

## Capabilities

- Read and search memory
- Draft replies to messages
- Classify and prioritize items
- Extract facts from content
- Propose config changes
- Answer questions about your data
