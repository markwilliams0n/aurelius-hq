/**
 * @deprecated This file is deprecated as of Memory V2.
 * Memory is now handled via file writes (daily notes + QMD indexing)
 * rather than tool-based remember() calls.
 * Kept for reference and potential migration of existing data.
 */
import { tool } from "@openrouter/sdk";
import { z } from "zod";
import { upsertEntity } from "@/lib/memory/entities";
import { createFact } from "@/lib/memory/facts";
import { logActivity } from "@/lib/activity";

// Schema for the remember tool
const rememberSchema = z.object({
  entity: z
    .string()
    .min(2)
    .describe("The proper name of the person, project, company, or topic (e.g., 'Sarah', 'Mowgli', 'Acme Corp')"),
  type: z
    .enum(["person", "project", "topic", "company", "team"])
    .describe("Type of entity"),
  fact: z
    .string()
    .min(5)
    .describe("The specific fact to remember about this entity (e.g., 'works at Google', 'lives in Boston')"),
  category: z
    .enum(["preference", "relationship", "status", "context", "milestone"])
    .describe("Category of the fact"),
});

export type RememberParams = z.infer<typeof rememberSchema>;

// Result type for the remember tool
export type RememberResult = {
  success: boolean;
  factId: string;
  content: string;
  params: RememberParams;
};

const rememberResultSchema = z.object({
  success: z.boolean(),
  factId: z.string(),
  message: z.string(),
});

// Create the remember tool with a collector for results
export function createRememberToolWithCollector(conversationId?: string) {
  const results: RememberResult[] = [];

  const rememberTool = tool({
    name: "remember",
    description:
      "Save a noteworthy fact about a person, project, company, or topic for future reference. Use this when you learn something worth remembering.",
    inputSchema: rememberSchema,
    outputSchema: rememberResultSchema,
    execute: async (params) => {
      try {
        // Validate entity name is meaningful (not just punctuation/whitespace)
        const cleanedEntity = params.entity.replace(/[^a-zA-Z0-9\s]/g, "").trim();
        if (cleanedEntity.length < 2) {
          console.error("Remember tool: Invalid entity name:", params.entity);
          return {
            success: false,
            factId: "",
            message: `Invalid entity name: "${params.entity}"`,
          };
        }

        // Upsert entity
        const entity = await upsertEntity(params.entity, params.type);

        // Create fact
        const fact = await createFact(
          entity.id,
          params.fact,
          params.category,
          "chat",
          conversationId
        );

        await logActivity({
          eventType: "memory_created",
          actor: "aurelius",
          description: `Remembered: ${params.fact}`,
          metadata: {
            entityId: entity.id,
            entityName: entity.name,
            factId: fact.id,
          },
        });

        // Collect the result
        results.push({
          success: true,
          factId: fact.id,
          content: params.fact,
          params,
        });

        return {
          success: true,
          factId: fact.id,
          message: `Remembered "${params.fact}" about ${params.entity}`,
        };
      } catch (error) {
        console.error("Remember tool error:", error);

        results.push({
          success: false,
          factId: "",
          content: params.fact,
          params,
        });

        return {
          success: false,
          factId: "",
          message: `Failed to remember: ${error}`,
        };
      }
    },
  });

  return { tool: rememberTool, getResults: () => results };
}

// Export the schemas for use elsewhere
export { rememberSchema, rememberResultSchema };
