import { generate, isOllamaAvailable } from './ollama';
import { emitMemoryEvent } from './events';

export interface EvaluationResult {
  score: number; // 1-5
  missed: string[];
  weak: string[];
  good: string[];
  suggestions: string[];
}

/**
 * Evaluate the quality of a memory extraction.
 * Runs a second Ollama call that critiques the extraction.
 * Only called when debug mode is on.
 */
export async function evaluateExtraction(params: {
  input: string;
  extracted: {
    entities: Array<{ name: string; type: string; facts: string[] }>;
    facts: Array<{ content: string; category: string }>;
    summary: string;
  };
  context: string; // e.g. "email from John Smith about Q3 planning"
}): Promise<EvaluationResult | null> {
  if (!(await isOllamaAvailable())) return null;

  const startTime = Date.now();

  const prompt = `You are a memory quality evaluator. Review how well information was extracted from content.

ORIGINAL CONTENT:
${params.input.slice(0, 4000)}

EXTRACTED:
Entities: ${JSON.stringify(params.extracted.entities)}
Facts: ${JSON.stringify(params.extracted.facts)}
Summary: ${params.extracted.summary}

Evaluate the extraction quality:

1. Score (1-5): How well were key facts captured?
2. Missed: Important information NOT captured (be specific)
3. Weak: Extracted items that are too vague or useless
4. Good: Well-extracted items that are specific and useful
5. Suggestions: How to improve extraction

Output ONLY valid JSON:
{
  "score": 4,
  "missed": ["specific thing that was missed"],
  "weak": ["extracted item that is too vague"],
  "good": ["well-extracted item"],
  "suggestions": ["improvement suggestion"]
}

JSON only:`;

  try {
    const response = await generate(prompt, { temperature: 0.2, maxTokens: 1000 });
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    // Clean up common LLM JSON issues (same patterns as extractEmailMemory)
    const cleaned = jsonMatch[0]
      .replace(/,\s*\]/g, ']')           // Remove trailing commas in arrays
      .replace(/,\s*\}/g, '}')           // Remove trailing commas in objects
      .replace(/[\x00-\x1F\x7F]/g, ' '); // Remove control characters

    const parsed = JSON.parse(cleaned) as EvaluationResult;
    const durationMs = Date.now() - startTime;

    // Validate and clamp
    const result: EvaluationResult = {
      score: typeof parsed.score === 'number' ? Math.min(5, Math.max(1, Math.round(parsed.score))) : 3,
      missed: Array.isArray(parsed.missed) ? parsed.missed.filter(s => typeof s === 'string') : [],
      weak: Array.isArray(parsed.weak) ? parsed.weak.filter(s => typeof s === 'string') : [],
      good: Array.isArray(parsed.good) ? parsed.good.filter(s => typeof s === 'string') : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.filter(s => typeof s === 'string') : [],
    };

    // Emit evaluation event
    emitMemoryEvent({
      eventType: 'evaluate',
      trigger: 'manual',
      summary: `Evaluation score: ${result.score}/5 for: ${params.context.slice(0, 60)}`,
      payload: { input: params.context, evaluation: result },
      durationMs,
      metadata: { score: result.score },
    }).catch(() => {});

    return result;
  } catch (error) {
    console.error('[Evaluator] Failed:', error);
    return null;
  }
}
