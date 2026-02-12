# Vault Wizard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the vault page's chat-with-list UI with a guided wizard drawer for adding items, and a clean browse/search list for managing them.

**Architecture:** Slide-over drawer wizard (5 steps) launched from a "+Vault" button. Items list is the home view. Chat integration via editable action cards with one-click SuperMemory. No chat UI on the vault page itself.

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind CSS v4, Drizzle ORM, Ollama for classification, SuperMemory for long-term storage.

**Design spec:** `docs/plans/2026-02-08-vault-wizard-design.md`

---

### Task 1: Add `deleteVaultItem` to Vault DB Module

**Files:**
- Modify: `src/lib/vault/index.ts`

**Step 1: Add the delete function**

Add this function at the end of `src/lib/vault/index.ts`, before the closing of the file:

```typescript
/** Delete a vault item by ID */
export async function deleteVaultItem(id: string): Promise<boolean> {
  const result = await db.delete(vaultItems).where(eq(vaultItems.id, id)).returning();
  return result.length > 0;
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep vault | head -20`
Expected: No new errors from vault/index.ts

**Step 3: Commit**

```bash
git add src/lib/vault/index.ts
git commit -m "feat(vault): add deleteVaultItem function"
```

---

### Task 2: Add DELETE Endpoint for Vault Items

**Files:**
- Modify: `src/app/api/vault/items/[id]/route.ts`

**Step 1: Add the DELETE handler**

Add this handler to `src/app/api/vault/items/[id]/route.ts` after the existing PATCH handler. Import `deleteVaultItem` from `@/lib/vault` (add to existing import line).

```typescript
/**
 * DELETE /api/vault/items/[id] — Delete a vault item
 *
 * Returns { success: true }
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid item ID" }, { status: 400 });
    }

    const deleted = await deleteVaultItem(id);
    if (!deleted) {
      return NextResponse.json(
        { error: "Vault item not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Vault API] Delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete vault item" },
      { status: 500 }
    );
  }
}
```

**Step 2: Update the import line**

Change:
```typescript
import { getVaultItem, updateVaultItem } from "@/lib/vault";
```
To:
```typescript
import { getVaultItem, updateVaultItem, deleteVaultItem } from "@/lib/vault";
```

**Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep "vault/items" | head -10`
Expected: No new errors

**Step 4: Test manually**

Open browser to vault page. Verify existing items still load. (DELETE endpoint is tested via wizard UI in later tasks.)

**Step 5: Commit**

```bash
git add src/app/api/vault/items/[id]/route.ts
git commit -m "feat(vault): add DELETE endpoint for vault items"
```

---

### Task 3: Create `/api/vault/parse` Endpoint

This endpoint extracts text from files and classifies content WITHOUT saving it. The wizard uses this for Step 2 (Processing).

**Files:**
- Create: `src/app/api/vault/parse/route.ts`
- Modify: `src/lib/vault/classify.ts` (add `model` parameter)

**Step 1: Add `model` parameter to `classifyVaultItem`**

In `src/lib/vault/classify.ts`, change the function signature from:

```typescript
export async function classifyVaultItem(
  content: string,
  hints?: { title?: string; type?: string; sensitive?: boolean }
): Promise<VaultClassification> {
```

To:

```typescript
export async function classifyVaultItem(
  content: string,
  hints?: { title?: string; type?: string; sensitive?: boolean },
  options?: { model?: string }
): Promise<VaultClassification> {
```

Then pass `options?.model` to the `generate` call. Change:

```typescript
const response = await generate(prompt, {
  temperature: 0.1,
  maxTokens: 200,
});
```

To:

```typescript
const response = await generate(prompt, {
  temperature: 0.1,
  maxTokens: 200,
  model: options?.model,
});
```

Also check that the `generate` function in `src/lib/memory/ollama.ts` accepts a `model` option. If not, add it to the options type and use it as `options?.model || DEFAULT_MODEL` in the API call.

**Step 2: Create the parse endpoint**

Create `src/app/api/vault/parse/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { classifyVaultItem } from "@/lib/vault/classify";
import { extractText } from "@/lib/vault/extract";

/**
 * POST /api/vault/parse — Classify content without saving
 *
 * Body (JSON): { content: string, model?: string, instructions?: string }
 * Body (FormData): file + optional model field
 *
 * Returns { suggestions: VaultClassification }
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const contentType = request.headers.get("content-type") || "";

    let textContent: string;
    let model: string | undefined;
    let fileName: string | undefined;
    let fileContentType: string | undefined;

    if (contentType.includes("multipart/form-data")) {
      // File upload
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      model = (formData.get("model") as string) || undefined;

      if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }

      const MAX_SIZE = 10 * 1024 * 1024;
      if (file.size > MAX_SIZE) {
        return NextResponse.json(
          { error: "File too large (max 10MB)" },
          { status: 400 }
        );
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      fileName = file.name;
      fileContentType = file.type || "application/octet-stream";
      textContent = await extractText(buffer, fileContentType, fileName);
    } else {
      // JSON body with text content
      const body = await request.json();
      textContent = body.content;
      model = body.model;

      if (!textContent) {
        return NextResponse.json(
          { error: "content is required" },
          { status: 400 }
        );
      }

      // If instructions provided, prepend them as context
      if (body.instructions) {
        textContent = `[User instructions: ${body.instructions}]\n\n${textContent}`;
      }
    }

    const suggestions = await classifyVaultItem(
      textContent,
      undefined,
      model ? { model } : undefined
    );

    return NextResponse.json({
      suggestions,
      extractedText: textContent,
      fileName,
      fileContentType,
    });
  } catch (error) {
    console.error("[Vault Parse] Error:", error);
    return NextResponse.json(
      { error: "Failed to parse content" },
      { status: 500 }
    );
  }
}
```

**Step 3: Check the `generate` function accepts `model` option**

Read `src/lib/memory/ollama.ts` and verify the `generate` function's options type includes `model?: string`. If it doesn't, add it:

In the options parameter type, add `model?: string`. In the body of the function, use `options?.model || DEFAULT_MODEL` instead of just `DEFAULT_MODEL`.

**Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep -E "parse|classify" | head -10`
Expected: No new errors

**Step 5: Commit**

```bash
git add src/app/api/vault/parse/route.ts src/lib/vault/classify.ts src/lib/memory/ollama.ts
git commit -m "feat(vault): add /api/vault/parse endpoint with model selection"
```

---

### Task 4: Build the Vault Wizard Drawer Component

This is the main UI component — a slide-over drawer with 5 wizard steps.

**Files:**
- Create: `src/app/vault/vault-wizard.tsx`

**Step 1: Create the wizard component**

Create `src/app/vault/vault-wizard.tsx` with these pieces:

1. **SlideOverDrawer wrapper** — fixed position, right-side, 480px wide, backdrop, transitions
2. **Step indicator** — dots at top, back arrow, X to close
3. **Step 1: Input** — large textarea + file drop zone + model selector pill (Tab to cycle)
4. **Step 2: Processing** — loading spinner + auto-advance
5. **Step 3: Review** — editable fields (title, type dropdown, tags chip input, summary textarea) + chat refinement input + re-run link
6. **Step 4: SuperMemory** — "Send to SuperMemory" (default) vs "Customize..." (expands to level picker + editable preview) vs "Skip"
7. **Step 5: Done** — confirmation + "Add another" / "View in Vault"

```typescript
"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  X,
  ArrowLeft,
  Upload,
  Loader2,
  ChevronDown,
  Plus,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TYPE_ICONS } from "@/components/aurelius/cards/vault-card";

// Available models for classification
const MODELS = ["ollama", "kimi"];

type WizardStep = "input" | "processing" | "review" | "supermemory" | "done";

interface ParseSuggestions {
  title: string;
  type: "document" | "fact" | "credential" | "reference";
  tags: string[];
  sensitive: boolean;
  normalizedContent?: string;
  searchKeywords?: string[];
}

interface WizardState {
  // Input
  textContent: string;
  files: File[];
  model: string;
  // Parse result
  extractedText: string;
  suggestions: ParseSuggestions | null;
  // Review (editable)
  title: string;
  type: "document" | "fact" | "credential" | "reference";
  tags: string[];
  summary: string;
  sensitive: boolean;
  // SuperMemory
  smLevel: string;
  smPreview: string | null;
  // Result
  savedItemId: string | null;
  savedTitle: string;
  // File info (if file was uploaded)
  fileName?: string;
  fileContentType?: string;
}

const INITIAL_STATE: WizardState = {
  textContent: "",
  files: [],
  model: "ollama",
  extractedText: "",
  suggestions: null,
  title: "",
  type: "fact",
  tags: [],
  summary: "",
  sensitive: false,
  smLevel: "medium",
  smPreview: null,
  savedItemId: null,
  savedTitle: "",
};

interface VaultWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onItemSaved: () => void;
  /** Pre-populate for editing an existing item */
  editItem?: {
    id: string;
    title: string;
    type: "document" | "fact" | "credential" | "reference";
    tags: string[];
    content: string | null;
    sensitive: boolean;
    supermemoryStatus: string;
  };
}

export function VaultWizard({ isOpen, onClose, onItemSaved, editItem }: VaultWizardProps) {
  const [step, setStep] = useState<WizardStep>(editItem ? "review" : "input");
  const [state, setState] = useState<WizardState>(() => {
    if (editItem) {
      return {
        ...INITIAL_STATE,
        title: editItem.title,
        type: editItem.type,
        tags: editItem.tags,
        summary: editItem.content || "",
        sensitive: editItem.sensitive,
        savedItemId: editItem.id,
      };
    }
    return INITIAL_STATE;
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [smLoading, setSmLoading] = useState(false);
  const [smCustomize, setSmCustomize] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus textarea when opening
  useEffect(() => {
    if (isOpen && step === "input") {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [isOpen, step]);

  // Reset when closing
  const handleClose = useCallback(() => {
    onClose();
    // Delay reset so animation completes
    setTimeout(() => {
      setStep("input");
      setState(INITIAL_STATE);
      setProcessingError(null);
      setTagInput("");
      setChatInput("");
      setSmCustomize(false);
    }, 300);
  }, [onClose]);

  // ----------------------------------------------------------
  // Step 1: Input handlers
  // ----------------------------------------------------------

  const handleModelCycle = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      setState((prev) => {
        const idx = MODELS.indexOf(prev.model);
        const next = MODELS[(idx + 1) % MODELS.length];
        return { ...prev, model: next };
      });
    }
  }, []);

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) {
      setState((prev) => ({ ...prev, files: [...prev.files, ...droppedFiles] }));
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length > 0) {
      setState((prev) => ({ ...prev, files: [...prev.files, ...selectedFiles] }));
    }
    e.target.value = "";
  }, []);

  const removeFile = useCallback((index: number) => {
    setState((prev) => ({
      ...prev,
      files: prev.files.filter((_, i) => i !== index),
    }));
  }, []);

  // ----------------------------------------------------------
  // Step 2: Processing
  // ----------------------------------------------------------

  const handleNext = useCallback(async () => {
    const hasText = state.textContent.trim().length > 0;
    const hasFiles = state.files.length > 0;

    if (!hasText && !hasFiles) {
      toast.error("Enter text or add a file");
      return;
    }

    setStep("processing");
    setIsProcessing(true);
    setProcessingError(null);

    try {
      let response;

      if (hasFiles) {
        // Process first file (multi-file = each becomes separate item, handle one at a time)
        const formData = new FormData();
        formData.append("file", state.files[0]);
        formData.append("model", state.model);

        response = await fetch("/api/vault/parse", {
          method: "POST",
          body: formData,
        });
      } else {
        response = await fetch("/api/vault/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: state.textContent,
            model: state.model === "ollama" ? undefined : state.model,
          }),
        });
      }

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Parse failed");
      }

      const data = await response.json();

      setState((prev) => ({
        ...prev,
        extractedText: data.extractedText || prev.textContent,
        suggestions: data.suggestions,
        title: data.suggestions?.title || "",
        type: data.suggestions?.type || "fact",
        tags: data.suggestions?.tags || [],
        summary: data.suggestions?.normalizedContent || data.extractedText || prev.textContent,
        sensitive: data.suggestions?.sensitive || false,
        fileName: data.fileName,
        fileContentType: data.fileContentType,
      }));

      setStep("review");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Processing failed";
      setProcessingError(msg);
      toast.error(msg);
      // Stay on processing step but show warning, allow advancing
      setStep("review");
      // Use raw content as fallback
      setState((prev) => ({
        ...prev,
        title: prev.textContent.slice(0, 60).trim() || prev.files[0]?.name || "Untitled",
        summary: prev.textContent || "",
      }));
    } finally {
      setIsProcessing(false);
    }
  }, [state.textContent, state.files, state.model]);

  // ----------------------------------------------------------
  // Step 3: Review handlers
  // ----------------------------------------------------------

  const handleAddTag = useCallback(() => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !state.tags.includes(tag)) {
      setState((prev) => ({ ...prev, tags: [...prev.tags, tag] }));
    }
    setTagInput("");
  }, [tagInput, state.tags]);

  const handleRemoveTag = useCallback((tag: string) => {
    setState((prev) => ({ ...prev, tags: prev.tags.filter((t) => t !== tag) }));
  }, []);

  const handleChatRefine = useCallback(async () => {
    const instructions = chatInput.trim();
    if (!instructions) return;

    setChatInput("");
    setIsProcessing(true);

    try {
      const response = await fetch("/api/vault/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: state.summary || state.extractedText,
          instructions,
          model: state.model === "ollama" ? undefined : state.model,
        }),
      });

      if (!response.ok) throw new Error("Refinement failed");

      const data = await response.json();
      const s = data.suggestions;

      if (s) {
        setState((prev) => ({
          ...prev,
          title: s.title || prev.title,
          type: s.type || prev.type,
          tags: s.tags?.length ? s.tags : prev.tags,
          summary: s.normalizedContent || prev.summary,
          sensitive: s.sensitive ?? prev.sensitive,
        }));
      }
    } catch {
      toast.error("Failed to refine — try editing manually");
    } finally {
      setIsProcessing(false);
    }
  }, [chatInput, state.summary, state.extractedText, state.model]);

  const handleRerunWithModel = useCallback((newModel: string) => {
    setState((prev) => ({ ...prev, model: newModel }));
    // Go back to processing with the new model
    setStep("processing");
    setIsProcessing(true);
    setProcessingError(null);

    const run = async () => {
      try {
        const content = state.extractedText || state.textContent;
        const response = await fetch("/api/vault/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content,
            model: newModel === "ollama" ? undefined : newModel,
          }),
        });

        if (!response.ok) throw new Error("Re-run failed");
        const data = await response.json();
        const s = data.suggestions;

        setState((prev) => ({
          ...prev,
          suggestions: s,
          title: s?.title || prev.title,
          type: s?.type || prev.type,
          tags: s?.tags || prev.tags,
          summary: s?.normalizedContent || data.extractedText || prev.summary,
          sensitive: s?.sensitive ?? prev.sensitive,
        }));

        setStep("review");
      } catch {
        toast.error("Re-run failed");
        setStep("review");
      } finally {
        setIsProcessing(false);
      }
    };

    run();
  }, [state.extractedText, state.textContent]);

  // ----------------------------------------------------------
  // Save to vault
  // ----------------------------------------------------------

  const handleSave = useCallback(async () => {
    setIsProcessing(true);
    try {
      const isEdit = !!editItem;
      const url = isEdit
        ? `/api/vault/items/${editItem!.id}`
        : "/api/vault/items";
      const method = isEdit ? "PATCH" : "POST";

      const body: Record<string, unknown> = {
        title: state.title,
        type: state.type,
        tags: state.tags,
        sensitive: state.sensitive,
      };

      if (!isEdit) {
        body.content = state.summary || state.extractedText || state.textContent;
      }

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) throw new Error("Save failed");
      const data = await response.json();

      setState((prev) => ({
        ...prev,
        savedItemId: data.item.id,
        savedTitle: data.item.title,
      }));

      setStep("supermemory");
    } catch {
      toast.error("Failed to save to vault");
    } finally {
      setIsProcessing(false);
    }
  }, [state, editItem]);

  // ----------------------------------------------------------
  // Step 4: SuperMemory
  // ----------------------------------------------------------

  const handleSmSend = useCallback(async () => {
    if (!state.savedItemId) return;
    setSmLoading(true);

    try {
      // Generate preview first if customizing
      if (smCustomize && !state.smPreview) {
        const previewRes = await fetch(`/api/vault/items/${state.savedItemId}/supermemory`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "preview", level: state.smLevel }),
        });
        if (!previewRes.ok) throw new Error("Preview failed");
        const previewData = await previewRes.json();
        setState((prev) => ({ ...prev, smPreview: previewData.summary }));
        setSmLoading(false);
        return; // Show preview, user clicks Send again
      }

      // Send to SuperMemory
      const res = await fetch(`/api/vault/items/${state.savedItemId}/supermemory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          level: state.smLevel,
          summary: state.smPreview, // null = server generates with default level
        }),
      });

      if (!res.ok) throw new Error("Send failed");
      toast.success("Sent to SuperMemory");
      setStep("done");
    } catch {
      toast.error("Failed to send to SuperMemory");
    } finally {
      setSmLoading(false);
    }
  }, [state.savedItemId, state.smLevel, state.smPreview, smCustomize]);

  const handleSmSkip = useCallback(() => {
    setStep("done");
  }, []);

  // ----------------------------------------------------------
  // Step 5: Done
  // ----------------------------------------------------------

  const handleAddAnother = useCallback(() => {
    setState(INITIAL_STATE);
    setStep("input");
    setProcessingError(null);
    setTagInput("");
    setChatInput("");
    setSmCustomize(false);
  }, []);

  const handleViewInVault = useCallback(() => {
    onItemSaved();
    handleClose();
  }, [onItemSaved, handleClose]);

  // ----------------------------------------------------------
  // Step navigation
  // ----------------------------------------------------------

  const STEPS: WizardStep[] = ["input", "processing", "review", "supermemory", "done"];
  const stepIndex = STEPS.indexOf(step);

  const canGoBack = step === "review" && !editItem;

  const handleBack = useCallback(() => {
    if (canGoBack) setStep("input");
  }, [canGoBack]);

  // ----------------------------------------------------------
  // Render
  // ----------------------------------------------------------

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={handleClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-[480px] bg-background border-l border-border z-50 flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            {canGoBack && (
              <button onClick={handleBack} className="p-1 text-muted-foreground hover:text-foreground">
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <span className="text-sm font-medium text-foreground">
              {editItem ? "Edit Vault Item" : "Add to Vault"}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Step dots */}
            <div className="flex gap-1.5">
              {STEPS.filter((s) => s !== "processing").map((s, i) => (
                <div
                  key={s}
                  className={cn(
                    "w-1.5 h-1.5 rounded-full transition-colors",
                    STEPS.indexOf(s) <= stepIndex
                      ? "bg-gold"
                      : "bg-muted-foreground/30"
                  )}
                />
              ))}
            </div>
            <button onClick={handleClose} className="p-1 text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Step 1: Input */}
          {step === "input" && (
            <div className="space-y-4">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Paste or type content</label>
                <textarea
                  ref={textareaRef}
                  value={state.textContent}
                  onChange={(e) => setState((prev) => ({ ...prev, textContent: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleNext();
                    }
                    handleModelCycle(e);
                  }}
                  placeholder="Paste content, a fact, a credential, a URL..."
                  rows={6}
                  className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-gold/50 focus:border-gold/50 resize-y"
                />
              </div>

              {/* File drop zone */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-gold/50 hover:bg-gold/5 transition-colors"
              >
                <Upload className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  Drop files here or click to browse
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  PDF, DOCX, TXT, CSV, images (max 10MB)
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleFileSelect}
                  multiple
                />
              </div>

              {/* File list */}
              {state.files.length > 0 && (
                <div className="space-y-1">
                  {state.files.map((file, i) => (
                    <div
                      key={`${file.name}-${i}`}
                      className="flex items-center justify-between px-3 py-1.5 rounded bg-muted/50 text-sm"
                    >
                      <span className="truncate">{file.name}</span>
                      <button onClick={() => removeFile(i)} className="text-muted-foreground hover:text-foreground ml-2">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Model selector */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Model:</span>
                <button
                  onClick={() => {
                    setState((prev) => {
                      const idx = MODELS.indexOf(prev.model);
                      return { ...prev, model: MODELS[(idx + 1) % MODELS.length] };
                    });
                  }}
                  className="px-2.5 py-1 rounded text-xs font-medium bg-gold/20 text-gold hover:bg-gold/30 transition-colors capitalize"
                >
                  {state.model}
                </button>
                <span className="text-[10px] text-muted-foreground">Tab to switch</span>
              </div>
            </div>
          )}

          {/* Step 2: Processing */}
          {step === "processing" && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <Loader2 className="w-8 h-8 animate-spin text-gold" />
              <p className="text-sm text-muted-foreground">
                Analyzing with {state.model}...
              </p>
              {processingError && (
                <p className="text-xs text-amber-400 text-center max-w-xs">
                  Warning: {processingError}. You can still edit manually.
                </p>
              )}
            </div>
          )}

          {/* Step 3: Review */}
          {step === "review" && (
            <div className="space-y-4">
              {processingError && (
                <div className="text-xs text-amber-400 bg-amber-400/10 rounded p-2">
                  Classification had issues — please review and edit below.
                </div>
              )}

              {/* Title */}
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Title</label>
                <input
                  type="text"
                  value={state.title}
                  onChange={(e) => setState((prev) => ({ ...prev, title: e.target.value }))}
                  className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-gold/50 focus:border-gold/50"
                />
              </div>

              {/* Type */}
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Type</label>
                <div className="relative">
                  <select
                    value={state.type}
                    onChange={(e) =>
                      setState((prev) => ({
                        ...prev,
                        type: e.target.value as WizardState["type"],
                      }))
                    }
                    className="w-full appearance-none px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-gold/50 focus:border-gold/50 pr-8"
                  >
                    <option value="fact">Fact</option>
                    <option value="credential">Credential</option>
                    <option value="document">Document</option>
                    <option value="reference">Reference</option>
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                </div>
              </div>

              {/* Tags */}
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Tags</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {state.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-gold/10 text-gold/80 cursor-pointer hover:bg-gold/20"
                      onClick={() => handleRemoveTag(tag)}
                    >
                      {tag}
                      <X className="w-3 h-3" />
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddTag();
                      }
                    }}
                    placeholder="Add tag..."
                    className="flex-1 px-3 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-gold/50 focus:border-gold/50"
                  />
                  <Button size="sm" variant="ghost" onClick={handleAddTag}>
                    <Plus className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              {/* Summary / Content */}
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Summary</label>
                <textarea
                  value={state.summary}
                  onChange={(e) => setState((prev) => ({ ...prev, summary: e.target.value }))}
                  rows={4}
                  className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-gold/50 focus:border-gold/50 resize-y"
                />
              </div>

              {/* Chat refinement */}
              <div className="border-t border-border pt-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleChatRefine();
                      }
                    }}
                    placeholder="Ask AI to refine..."
                    disabled={isProcessing}
                    className="flex-1 px-3 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-gold/50 focus:border-gold/50 disabled:opacity-50"
                  />
                  <Button size="sm" onClick={handleChatRefine} disabled={isProcessing || !chatInput.trim()}>
                    {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Refine"}
                  </Button>
                </div>

                {/* Re-run with different model */}
                {!editItem && (
                  <div className="mt-2 flex gap-2 items-center">
                    <span className="text-[10px] text-muted-foreground">Re-run with:</span>
                    {MODELS.filter((m) => m !== state.model).map((m) => (
                      <button
                        key={m}
                        onClick={() => handleRerunWithModel(m)}
                        className="text-[10px] text-gold hover:underline capitalize"
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 4: SuperMemory */}
          {step === "supermemory" && (
            <div className="space-y-4 py-4">
              <p className="text-sm text-foreground">
                Send <span className="font-medium text-gold">{state.savedTitle || state.title}</span> to SuperMemory for long-term recall?
              </p>

              {!smCustomize ? (
                <div className="space-y-2">
                  <Button onClick={handleSmSend} disabled={smLoading} className="w-full">
                    {smLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Send to SuperMemory
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setSmCustomize(true)}
                    className="w-full"
                  >
                    Customize...
                  </Button>
                  <button
                    onClick={handleSmSkip}
                    className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-2"
                  >
                    Skip
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Level picker */}
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Summary level</label>
                    <div className="flex gap-1.5">
                      {["short", "medium", "detailed", "full"].map((level) => (
                        <button
                          key={level}
                          onClick={() => {
                            setState((prev) => ({ ...prev, smLevel: level, smPreview: null }));
                          }}
                          className={cn(
                            "px-2.5 py-1 rounded text-xs font-medium transition-colors capitalize",
                            state.smLevel === level
                              ? "bg-gold/20 text-gold"
                              : "text-muted-foreground hover:text-foreground hover:bg-muted"
                          )}
                        >
                          {level}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Preview */}
                  {state.smPreview !== null ? (
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Preview (editable)</label>
                      <textarea
                        value={state.smPreview}
                        onChange={(e) => setState((prev) => ({ ...prev, smPreview: e.target.value }))}
                        rows={4}
                        className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-gold/50 focus:border-gold/50 resize-y"
                      />
                    </div>
                  ) : null}

                  <Button onClick={handleSmSend} disabled={smLoading} className="w-full">
                    {smLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : null}
                    {state.smPreview !== null ? "Send" : "Generate Preview"}
                  </Button>

                  <button
                    onClick={handleSmSkip}
                    className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-2"
                  >
                    Skip
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Step 5: Done */}
          {step === "done" && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                <Check className="w-6 h-6 text-green-400" />
              </div>
              <h3 className="text-lg font-medium text-foreground">Added to Vault</h3>
              <p className="text-sm text-muted-foreground text-center">
                {state.savedTitle || state.title}
              </p>
              <div className="flex gap-3 mt-4">
                <Button onClick={handleAddAnother} variant="outline">
                  Add another
                </Button>
                <Button onClick={handleViewInVault}>
                  View in Vault
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Footer — only for steps with a primary action */}
        {step === "input" && (
          <div className="border-t border-border px-4 py-3">
            <Button
              onClick={handleNext}
              disabled={!state.textContent.trim() && state.files.length === 0}
              className="w-full"
            >
              Next
            </Button>
            <p className="text-[10px] text-muted-foreground text-center mt-1">
              Cmd+Enter to continue
            </p>
          </div>
        )}

        {step === "review" && (
          <div className="border-t border-border px-4 py-3">
            <Button onClick={handleSave} disabled={isProcessing || !state.title.trim()} className="w-full">
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {editItem ? "Save Changes" : "Save to Vault"}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep "vault-wizard" | head -10`
Expected: No errors (warnings about unused vars are OK during development)

**Step 3: Commit**

```bash
git add src/app/vault/vault-wizard.tsx
git commit -m "feat(vault): add wizard drawer component (5-step flow)"
```

---

### Task 5: Rewrite Vault Page — Strip Chat, Add Wizard

Replace the vault page with: items list + search/filter + "+Vault" button that opens the wizard. Remove all chat UI, `useChat` hook, and `VAULT_CONVERSATION_ID`.

**Files:**
- Modify: `src/app/vault/vault-client.tsx` (major rewrite)

**Step 1: Rewrite vault-client.tsx**

The new file keeps:
- `VaultItem` type (lines 35-51)
- `formatRelativeDate` helper (lines 57-70)
- `VaultItemCard` component (lines 76-409) — with **added delete button**
- Search/filter bar
- Items list
- Empty state

The new file adds:
- `VaultWizard` import + open/close state
- "+Vault" button in header
- Edit handler that opens wizard at review step
- Delete handler with confirmation

The new file removes:
- `VAULT_CONVERSATION_ID`
- `useChat` hook and all chat-related state
- Chat input area
- Chat history section
- `recentMessages` display
- `ActionCard` / `CardContent` imports (only used for chat)

Replace the entire contents of `src/app/vault/vault-client.tsx` with the rewritten version. Key changes:

a) Remove these imports: `useChat`, `ActionCard`, `CardContent`, `Send`
b) Add import: `import { VaultWizard } from "./vault-wizard";` and `Trash2` from lucide
c) Remove `VAULT_CONVERSATION_ID` constant
d) Add wizard state: `const [wizardOpen, setWizardOpen] = useState(false);` and `const [editingItem, setEditingItem] = useState<VaultItem | null>(null);`
e) Remove `useChat` call and all related: `messages`, `isStreaming`, `actionCards`, `send`, `handleCardAction`, `updateCardData`, `chatInput`, `setChatInput`, `handleChatSend`, `handleKeyDown`, `refreshItemsRef`, `refreshItems`
f) Add `handleDelete` function:
```typescript
const handleDelete = async (itemId: string) => {
  if (!confirm("Delete this vault item?")) return;
  try {
    const res = await fetch(`/api/vault/items/${itemId}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Delete failed");
    setItems((prev) => prev.filter((item) => item.id !== itemId));
    fetchTagsFn();
    toast.success("Item deleted");
  } catch {
    toast.error("Failed to delete item");
  }
};
```

g) Add `handleEdit` function that opens wizard with item data:
```typescript
const handleEdit = (item: VaultItem) => {
  setEditingItem(item);
  setWizardOpen(true);
};
```

h) In the header, add the "+Vault" button:
```tsx
<div className="flex items-center justify-between border-b border-border px-6 py-4">
  <div>
    <h1 className="font-serif text-2xl text-gold">Vault</h1>
    <p className="text-sm text-muted-foreground">
      Store and retrieve important documents, facts, and credentials
    </p>
  </div>
  <Button onClick={() => { setEditingItem(null); setWizardOpen(true); }}>
    <Plus className="w-4 h-4 mr-1.5" />
    Vault
  </Button>
</div>
```

i) Remove the AI input area entirely (the drag-and-drop textarea with Send/Upload buttons)
j) Remove the chat history display section
k) Add VaultWizard at the end of the component:
```tsx
<VaultWizard
  isOpen={wizardOpen}
  onClose={() => { setWizardOpen(false); setEditingItem(null); }}
  onItemSaved={() => { fetchItemsFn(); fetchTagsFn(); }}
  editItem={editingItem ? {
    id: editingItem.id,
    title: editingItem.title,
    type: editingItem.type,
    tags: editingItem.tags,
    content: editingItem.content,
    sensitive: editingItem.sensitive,
    supermemoryStatus: editingItem.supermemoryStatus,
  } : undefined}
/>
```

l) Add Edit and Delete buttons to VaultItemCard's expanded view action row.

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep vault | head -20`
Expected: No new errors

**Step 3: Test in browser**

Navigate to http://localhost:3333/vault
- Verify: No chat input area
- Verify: "+Vault" button in top-right corner
- Verify: Items list still shows
- Verify: Search and tag filters work
- Click "+Vault" → wizard drawer opens
- Click Edit on an item → wizard opens at Review step
- Click Delete on an item → confirmation prompt → item removed

**Step 4: Commit**

```bash
git add src/app/vault/vault-client.tsx
git commit -m "feat(vault): rewrite vault page — wizard drawer replaces chat UI"
```

---

### Task 6: Update Vault Action Card for Chat Integration

Rewrite `vault-card.tsx` as a mini-editor action card per the design: editable fields + SuperMemory/Refine/Delete actions.

**Files:**
- Modify: `src/components/aurelius/cards/vault-card.tsx`
- Modify: `src/components/aurelius/action-card.tsx` (update vault pattern actions)

**Step 1: Update PATTERN_ACTIONS for vault**

In `src/components/aurelius/action-card.tsx`, change the vault pattern actions to include the new action set:

```typescript
vault: ["supermemory", "refine", "delete", "dismiss"],
```

Add to `getButtonProps`:
```typescript
case "refine":
  return { variant: "outline", label: "Refine in Vault" };
case "delete":
  return { variant: "destructive", label: "Delete" };
```

**Step 2: Add delete handler to vault handler**

In `src/lib/action-cards/handlers/vault.ts`, register a second handler for delete:

```typescript
registerCardHandler("vault:delete", {
  label: "Delete",
  successMessage: "Deleted from Vault",

  async execute(data) {
    const itemId = data.vault_item_id as string | undefined;
    if (!itemId) {
      return { status: "error", error: "Missing vault item ID" };
    }

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3333"}/api/vault/items/${itemId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      return { status: "confirmed" };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return { status: "error", error: errMsg };
    }
  },
});
```

Note: Server-side handlers can't use relative URLs. Use `deleteVaultItem` from the vault module directly instead:

```typescript
import { deleteVaultItem } from "@/lib/vault";

registerCardHandler("vault:delete", {
  label: "Delete",
  successMessage: "Deleted from Vault",

  async execute(data) {
    const itemId = data.vault_item_id as string | undefined;
    if (!itemId) {
      return { status: "error", error: "Missing vault item ID" };
    }

    try {
      const deleted = await deleteVaultItem(itemId);
      if (!deleted) return { status: "error", error: "Item not found" };
      return { status: "confirmed" };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return { status: "error", error: errMsg };
    }
  },
});
```

**Step 3: Update capability handleSave to set handler IDs for multiple actions**

In `src/lib/capabilities/vault/index.ts`, update the save action card result to include multiple handlers. The action card system currently dispatches to a single handler via `card.handler`. For vault cards with multiple primary actions (supermemory, delete), the handler should be specified per action in the card data. The `dispatchCardAction` function in the registry routes based on action name to the registered handler.

Update the save result to include handler mappings:

```typescript
action_card: {
  pattern: 'vault',
  handler: 'vault:supermemory', // Default handler (for primary action)
  handlers: {
    supermemory: 'vault:supermemory',
    delete: 'vault:delete',
  },
  title: `Saved to Vault: ${item.title}`,
  data: { ... },
},
```

Check how `dispatchCardAction` resolves handlers. If it only checks `card.handler`, we may need to update the registry to check `card.handlers[action]` first. Read `src/lib/action-cards/registry.ts` to understand the dispatch mechanism.

**Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep -E "vault|action-card" | head -20`
Expected: No new errors

**Step 5: Commit**

```bash
git add src/components/aurelius/cards/vault-card.tsx src/components/aurelius/action-card.tsx src/lib/action-cards/handlers/vault.ts src/lib/capabilities/vault/index.ts
git commit -m "feat(vault): mini-editor action card with SuperMemory/Delete actions"
```

---

### Task 7: Update `generate` Function to Accept Model Parameter

**Files:**
- Modify: `src/lib/memory/ollama.ts`

**Step 1: Add model to generate options**

Check the `generate` function signature and its options type. Add `model?: string` to the options parameter type if not already present. Use it in the API call as `options?.model || DEFAULT_MODEL`.

This enables the vault wizard's model selector to pass through to Ollama.

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep ollama | head -10`
Expected: No errors

**Step 3: Commit**

```bash
git add src/lib/memory/ollama.ts
git commit -m "feat(vault): support model parameter in Ollama generate"
```

---

### Task 8: End-to-End Testing & Cleanup

**Files:**
- Various — based on testing results

**Step 1: Test wizard flow**

1. Navigate to http://localhost:3333/vault
2. Click "+Vault"
3. Type some text → click Next → verify processing → verify review fields populated
4. Edit title/tags/type → click "Save to Vault"
5. Verify SuperMemory step appears → click "Send to SuperMemory" or "Skip"
6. Verify done screen → click "View in Vault"
7. Verify item appears in list

**Step 2: Test file upload through wizard**

1. Click "+Vault"
2. Drop a file
3. Verify processing extracts text
4. Verify review shows extracted content

**Step 3: Test edit flow**

1. Click Edit on an existing item
2. Verify wizard opens at Review step with data populated
3. Change title/tags → Save Changes
4. Verify item updated in list

**Step 4: Test delete**

1. Click Delete on an item → confirm
2. Verify item removed from list

**Step 5: Test chat integration**

1. Go to main chat page
2. Type "save X to vault"
3. Verify action card appears with SuperMemory/Delete buttons
4. Click SuperMemory → verify it works

**Step 6: Clean up unused code**

Remove any dead imports, unused constants, or commented-out code introduced during the rewrite.

**Step 7: Verify TypeScript compiles clean**

Run: `npx tsc --noEmit`
Expected: Same error count as before (32 pre-existing)

**Step 8: Commit**

```bash
git add -A
git commit -m "fix(vault): end-to-end testing fixes and cleanup"
```
