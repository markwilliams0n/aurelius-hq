# Vault Wizard Redesign

**Goal:** Replace the current chat-with-list vault page with a guided wizard flow for adding items, and a clean browse/search list for managing them.

**Architecture:** Slide-over drawer wizard (5 steps) launched from a "+Vault" button. Items list is the home view. Chat integration via editable action cards with one-click SuperMemory. No chat UI on the vault page itself.

## Page Layout

The vault page has one primary view: the **items list** with search bar, tag filter chips, and expandable item cards. No chat input area.

- Top-right: **"+ Vault" button** opens a slide-over drawer (~480px) from the right
- Items in the list get **Edit** (opens drawer at Review step) and **Delete** (with confirmation)
- Old chat history section removed entirely — use main chat for vault AI interactions

## Wizard Steps

Step indicator at top (dots, not numbers — some steps are skippable). Back arrow + X to close. Draft state persists until explicit discard.

### Step 1: Input

- Large text area for pasting/typing
- Drop zone for files (click or drag). Multiple files OK — each becomes a separate vault item
- Model selector pill: "Ollama" default, **Tab key cycles** through available models (Ollama, Kimi, etc)
- "Next" button or Cmd+Enter

### Step 2: Processing

- Loading state ("Analyzing with Ollama...")
- Warning (not block) if extraction fails
- Auto-advances to Review

### Step 3: Review

- Pre-filled editable fields:
  - **Title** — text input
  - **Type** — dropdown (fact / credential / document / reference)
  - **Tags** — chip input (click to remove, type to add)
  - **Summary** — textarea
- **Chat input** below fields — "Ask AI to refine..." updates fields live
- **"Re-run with [other model]"** link — goes back to Step 2 with different model
- "Save to Vault" button

### Step 4: SuperMemory

Two options as cards/buttons:

- **"Send to SuperMemory"** (default, highlighted) — medium summary, sends immediately
- **"Customize..."** — expands to level picker (short/medium/detailed/full) + editable preview + "Send"
- **"Skip"** — smaller link, saves without SuperMemory

### Step 5: Done

- Confirmation: "Added to Vault" with item title
- "Add another" (resets wizard) or "View in Vault" (closes drawer, scrolls to item)

## Chat Integration (Action Card)

When AI saves to vault via main chat, the action card is a mini-editor:

- Header: "Saved to Vault: [Title]" with type icon
- Editable fields: Title (text), Type (dropdown), Tags (chips)
- Actions:
  - **"Send to SuperMemory"** — one-click, medium summary (primary)
  - **"Refine in Vault"** — opens vault page drawer at Review step with item loaded
  - **"Delete"** — removes from vault with confirmation

After confirmation, card collapses to compact state: title + "View in Vault" link.

## Retro-Editing

Clicking Edit on any item in the vault list opens the drawer at Step 3 (Review), pre-populated with current data. Same fields, same chat refinement, same SuperMemory flow. "Save changes" instead of "Save to Vault."

## Delete

Available in three places:
1. Action card in chat
2. Item list (icon button)
3. Review step of wizard

Always with confirmation. Calls `DELETE /api/vault/items/[id]`.

## Technical Changes

### New files

- `src/app/vault/vault-wizard.tsx` — multi-step drawer component
- `src/app/vault/vault-item-list.tsx` — extracted browse/search/filter list
- `src/app/api/vault/parse/route.ts` — extraction + classification endpoint (text + files + model choice → suggestions)

### Modified files

- `src/app/vault/vault-client.tsx` — rewrite: strip chat UI, keep items list, add +Vault button
- `src/app/api/vault/items/[id]/route.ts` — add DELETE handler
- `src/lib/vault/classify.ts` — accept model parameter
- `src/components/aurelius/cards/vault-card.tsx` — rewrite as mini-editor action card
- `src/lib/capabilities/vault/index.ts` — simplify handleSave, return editable card format

### Removed

- Chat input/history from vault page
- `useChat` hook dependency on vault page
- `VAULT_CONVERSATION_ID` constant
- SM buttons in item detail view

### Data flow (wizard)

1. User inputs content/files → `POST /api/vault/parse` with model choice
2. API extracts text, classifies → returns suggestions (title, type, tags, summary, normalizedContent, keywords)
3. User edits in Review, optionally chats to refine (same parse endpoint with instructions)
4. User confirms → `POST /api/vault/items` creates item
5. SuperMemory step → `POST /api/vault/items/[id]/supermemory`

### Data flow (chat action card)

1. AI calls `save_to_vault` → item created immediately
2. Action card shows editable fields + SuperMemory/Refine/Delete actions
3. Edits → `PATCH /api/vault/items/[id]`
4. SuperMemory → `POST /api/vault/items/[id]/supermemory`
5. Delete → `DELETE /api/vault/items/[id]`
