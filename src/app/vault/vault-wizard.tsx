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

const MODELS = ["kimi", "ollama"];

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
  textContent: string;
  files: File[];
  model: string;
  extractedText: string;
  suggestions: ParseSuggestions | null;
  title: string;
  type: "document" | "fact" | "credential" | "reference";
  tags: string[];
  summary: string;
  sensitive: boolean;
  smLevel: string;
  smPreview: string | null;
  savedItemId: string | null;
  savedTitle: string;
  fileName?: string;
  fileContentType?: string;
}

const INITIAL_STATE: WizardState = {
  textContent: "",
  files: [],
  model: "kimi",
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

export interface VaultWizardEditItem {
  id: string;
  title: string;
  type: "document" | "fact" | "credential" | "reference";
  tags: string[];
  content: string | null;
  sensitive: boolean;
  supermemoryStatus: string;
}

interface VaultWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onItemSaved: () => void;
  editItem?: VaultWizardEditItem;
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

  // Reset state when editItem changes
  useEffect(() => {
    if (editItem) {
      setStep("review");
      setState({
        ...INITIAL_STATE,
        title: editItem.title,
        type: editItem.type,
        tags: editItem.tags,
        summary: editItem.content || "",
        sensitive: editItem.sensitive,
        savedItemId: editItem.id,
      });
    } else if (isOpen) {
      setStep("input");
      setState(INITIAL_STATE);
    }
  }, [editItem, isOpen]);

  // Focus textarea when opening
  useEffect(() => {
    if (isOpen && step === "input") {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [isOpen, step]);

  const handleClose = useCallback(() => {
    onClose();
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
  // Step 1: Input
  // ----------------------------------------------------------

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

  const cycleModel = useCallback(() => {
    setState((prev) => {
      const idx = MODELS.indexOf(prev.model);
      return { ...prev, model: MODELS[(idx + 1) % MODELS.length] };
    });
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
        const formData = new FormData();
        formData.append("file", state.files[0]);
        if (state.model !== "ollama") {
          formData.append("model", state.model);
        }

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
      // Fall through to review with raw content
      setState((prev) => ({
        ...prev,
        title: prev.textContent.slice(0, 60).trim() || prev.files[0]?.name || "Untitled",
        summary: prev.textContent || "",
      }));
      setStep("review");
    } finally {
      setIsProcessing(false);
    }
  }, [state.textContent, state.files, state.model]);

  // ----------------------------------------------------------
  // Step 3: Review
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

  const handleRerunWithModel = useCallback(
    (newModel: string) => {
      setState((prev) => ({ ...prev, model: newModel }));
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
    },
    [state.extractedText, state.textContent]
  );

  // ----------------------------------------------------------
  // Save
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

      onItemSaved();

      // Skip SM step for edits where item already has SM
      if (isEdit && editItem!.supermemoryStatus === "sent") {
        setStep("done");
      } else {
        setStep("supermemory");
      }
    } catch {
      toast.error("Failed to save to vault");
    } finally {
      setIsProcessing(false);
    }
  }, [state, editItem, onItemSaved]);

  // ----------------------------------------------------------
  // Step 4: SuperMemory
  // ----------------------------------------------------------

  const handleSmSend = useCallback(async () => {
    if (!state.savedItemId) return;
    setSmLoading(true);

    try {
      if (smCustomize && !state.smPreview) {
        // Generate preview first
        const previewRes = await fetch(
          `/api/vault/items/${state.savedItemId}/supermemory`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "preview", level: state.smLevel }),
          }
        );
        if (!previewRes.ok) throw new Error("Preview failed");
        const previewData = await previewRes.json();
        setState((prev) => ({ ...prev, smPreview: previewData.summary }));
        setSmLoading(false);
        return;
      }

      // Send
      const res = await fetch(
        `/api/vault/items/${state.savedItemId}/supermemory`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "send",
            level: state.smLevel,
            summary: state.smPreview,
          }),
        }
      );

      if (!res.ok) throw new Error("Send failed");
      toast.success("Sent to SuperMemory");
      setStep("done");
    } catch {
      toast.error("Failed to send to SuperMemory");
    } finally {
      setSmLoading(false);
    }
  }, [state.savedItemId, state.smLevel, state.smPreview, smCustomize]);

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
  // Navigation
  // ----------------------------------------------------------

  const STEPS: WizardStep[] = ["input", "processing", "review", "supermemory", "done"];
  const stepIndex = STEPS.indexOf(step);
  const canGoBack = step === "review" && !editItem;

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={handleClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-[480px] bg-background border-l border-border z-50 flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            {canGoBack && (
              <button
                onClick={() => setStep("input")}
                className="p-1 text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <span className="text-sm font-medium text-foreground">
              {editItem ? "Edit Vault Item" : "Add to Vault"}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Step dots (skip processing — it's transient) */}
            <div className="flex gap-1.5">
              {STEPS.filter((s) => s !== "processing").map((s) => (
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
            <button
              onClick={handleClose}
              className="p-1 text-muted-foreground hover:text-foreground"
            >
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
                <label className="text-xs text-muted-foreground block mb-1">
                  Paste or type content
                </label>
                <textarea
                  ref={textareaRef}
                  value={state.textContent}
                  onChange={(e) =>
                    setState((prev) => ({ ...prev, textContent: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleNext();
                    }
                    if (e.key === "Tab" && !e.shiftKey) {
                      e.preventDefault();
                      cycleModel();
                    }
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
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFile(i);
                        }}
                        className="text-muted-foreground hover:text-foreground ml-2"
                      >
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
                  onClick={cycleModel}
                  className="px-2.5 py-1 rounded text-xs font-medium bg-gold/20 text-gold hover:bg-gold/30 transition-colors capitalize"
                >
                  {state.model}
                </button>
                <span className="text-[10px] text-muted-foreground">
                  Tab to switch
                </span>
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
            </div>
          )}

          {/* Step 3: Review */}
          {step === "review" && (
            <div className="space-y-4">
              {processingError && (
                <div className="text-xs text-amber-400 bg-amber-400/10 rounded p-2">
                  Classification had issues — review and edit below.
                </div>
              )}

              {/* Title */}
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={state.title}
                  onChange={(e) =>
                    setState((prev) => ({ ...prev, title: e.target.value }))
                  }
                  className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-gold/50 focus:border-gold/50"
                />
              </div>

              {/* Type */}
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  Type
                </label>
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
                <label className="text-xs text-muted-foreground block mb-1">
                  Tags
                </label>
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
                <label className="text-xs text-muted-foreground block mb-1">
                  Summary
                </label>
                <textarea
                  value={state.summary}
                  onChange={(e) =>
                    setState((prev) => ({ ...prev, summary: e.target.value }))
                  }
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
                  <Button
                    size="sm"
                    onClick={handleChatRefine}
                    disabled={isProcessing || !chatInput.trim()}
                  >
                    {isProcessing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      "Refine"
                    )}
                  </Button>
                </div>

                {/* Re-run with different model */}
                {!editItem && (
                  <div className="mt-2 flex gap-2 items-center">
                    <span className="text-[10px] text-muted-foreground">
                      Re-run with:
                    </span>
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
                Send{" "}
                <span className="font-medium text-gold">
                  {state.savedTitle || state.title}
                </span>{" "}
                to SuperMemory for long-term recall?
              </p>

              {!smCustomize ? (
                <div className="space-y-2">
                  <Button
                    onClick={handleSmSend}
                    disabled={smLoading}
                    className="w-full"
                  >
                    {smLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : null}
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
                    onClick={() => setStep("done")}
                    className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-2"
                  >
                    Skip
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Level picker */}
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">
                      Summary level
                    </label>
                    <div className="flex gap-1.5">
                      {["short", "medium", "detailed", "full"].map((level) => (
                        <button
                          key={level}
                          onClick={() =>
                            setState((prev) => ({
                              ...prev,
                              smLevel: level,
                              smPreview: null,
                            }))
                          }
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
                  {state.smPreview !== null && (
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">
                        Preview (editable)
                      </label>
                      <textarea
                        value={state.smPreview}
                        onChange={(e) =>
                          setState((prev) => ({
                            ...prev,
                            smPreview: e.target.value,
                          }))
                        }
                        rows={4}
                        className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-gold/50 focus:border-gold/50 resize-y"
                      />
                    </div>
                  )}

                  <Button
                    onClick={handleSmSend}
                    disabled={smLoading}
                    className="w-full"
                  >
                    {smLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : null}
                    {state.smPreview !== null ? "Send" : "Generate Preview"}
                  </Button>

                  <button
                    onClick={() => setStep("done")}
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
              <h3 className="text-lg font-medium text-foreground">
                {editItem ? "Changes Saved" : "Added to Vault"}
              </h3>
              <p className="text-sm text-muted-foreground text-center">
                {state.savedTitle || state.title}
              </p>
              <div className="flex gap-3 mt-4">
                {!editItem && (
                  <Button onClick={handleAddAnother} variant="outline">
                    Add another
                  </Button>
                )}
                <Button onClick={handleViewInVault}>View in Vault</Button>
              </div>
            </div>
          )}
        </div>

        {/* Footer — primary action buttons */}
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
            <Button
              onClick={handleSave}
              disabled={isProcessing || !state.title.trim()}
              className="w-full"
            >
              {isProcessing ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              {editItem ? "Save Changes" : "Save to Vault"}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
