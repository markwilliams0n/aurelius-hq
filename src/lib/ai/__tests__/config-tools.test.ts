import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleConfigTool } from "../config-tools";

// Mock the config module
vi.mock("@/lib/config", () => ({
  getConfig: vi.fn(),
  getAllConfigs: vi.fn(),
  proposePendingChange: vi.fn(),
  CONFIG_DESCRIPTIONS: {
    soul: "Soul description",
    system_prompt: "System prompt description",
    agents: "Agents description",
    processes: "Processes description",
  },
}));

// Mock the schema module
vi.mock("@/lib/db/schema", () => ({
  configKeyEnum: {
    enumValues: ["soul", "system_prompt", "agents", "processes"],
  },
}));

import { getConfig, getAllConfigs, proposePendingChange } from "@/lib/config";

describe("handleConfigTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("read_config", () => {
    it("should return config content when key exists", async () => {
      const mockConfig = {
        key: "soul",
        content: "Test soul content",
        version: 1,
        createdBy: "user",
        createdAt: new Date().toISOString(),
      };
      vi.mocked(getConfig).mockResolvedValue(mockConfig);

      const { result } = await handleConfigTool("read_config", { key: "soul" });
      const parsed = JSON.parse(result);

      expect(parsed.key).toBe("soul");
      expect(parsed.content).toBe("Test soul content");
      expect(parsed.version).toBe(1);
    });

    it("should return null content when config does not exist", async () => {
      vi.mocked(getConfig).mockResolvedValue(null);

      const { result } = await handleConfigTool("read_config", { key: "soul" });
      const parsed = JSON.parse(result);

      expect(parsed.key).toBe("soul");
      expect(parsed.content).toBeNull();
      expect(parsed.note).toContain("not been set yet");
    });

    it("should return error when key is missing", async () => {
      const { result } = await handleConfigTool("read_config", {});
      const parsed = JSON.parse(result);

      expect(parsed.error).toBeDefined();
      expect(parsed.error).toContain("key");
      expect(getConfig).not.toHaveBeenCalled();
    });

    it("should return error when key is empty string", async () => {
      const { result } = await handleConfigTool("read_config", { key: "" });
      const parsed = JSON.parse(result);

      expect(parsed.error).toBeDefined();
      expect(parsed.error).toContain("key");
      expect(getConfig).not.toHaveBeenCalled();
    });

    it("should return error when key is invalid", async () => {
      const { result } = await handleConfigTool("read_config", { key: "invalid_key" });
      const parsed = JSON.parse(result);

      expect(parsed.error).toBeDefined();
      expect(parsed.error).toContain("Invalid");
      expect(getConfig).not.toHaveBeenCalled();
    });
  });

  describe("propose_config_change", () => {
    it("should return error when key is missing", async () => {
      const { result } = await handleConfigTool("propose_config_change", {
        proposedContent: "new content",
        reason: "test reason",
      });
      const parsed = JSON.parse(result);

      expect(parsed.error).toBeDefined();
      expect(parsed.error).toContain("key");
      expect(proposePendingChange).not.toHaveBeenCalled();
    });

    it("should return error when proposedContent is missing", async () => {
      const { result } = await handleConfigTool("propose_config_change", {
        key: "soul",
        reason: "test reason",
      });
      const parsed = JSON.parse(result);

      expect(parsed.error).toBeDefined();
      expect(parsed.error).toContain("proposedContent");
      expect(proposePendingChange).not.toHaveBeenCalled();
    });

    it("should return error when reason is missing", async () => {
      const { result } = await handleConfigTool("propose_config_change", {
        key: "soul",
        proposedContent: "new content",
      });
      const parsed = JSON.parse(result);

      expect(parsed.error).toBeDefined();
      expect(parsed.error).toContain("reason");
      expect(proposePendingChange).not.toHaveBeenCalled();
    });

    it("should create pending change with valid inputs", async () => {
      const mockPending = {
        id: "test-id",
        key: "soul",
        proposedContent: "new content",
        reason: "test reason",
      };
      vi.mocked(proposePendingChange).mockResolvedValue(mockPending as never);

      const { result, pendingChangeId } = await handleConfigTool("propose_config_change", {
        key: "soul",
        proposedContent: "new content",
        reason: "test reason",
      });
      const parsed = JSON.parse(result);

      expect(parsed.success).toBe(true);
      expect(parsed.pendingChangeId).toBe("test-id");
      expect(pendingChangeId).toBe("test-id");
      expect(proposePendingChange).toHaveBeenCalledWith("soul", "new content", "test reason", undefined);
    });
  });
});
