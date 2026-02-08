/** Extract text content from a file buffer based on MIME type */
export async function extractText(
  buffer: Buffer,
  contentType: string,
  fileName: string
): Promise<string> {
  switch (contentType) {
    case "application/pdf": {
      try {
        const { PDFParse } = await import("pdf-parse");
        const parser = new PDFParse({ data: new Uint8Array(buffer) });
        try {
          const result = await parser.getText();
          return result.text || fileName;
        } finally {
          await parser.destroy();
        }
      } catch (error) {
        console.warn("[Vault] PDF extraction failed, using filename:", error);
        return fileName;
      }
    }
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
      try {
        const mammoth = await import("mammoth");
        const result = await mammoth.default.extractRawText({ buffer });
        return result.value || fileName;
      } catch (error) {
        console.warn("[Vault] DOCX extraction failed, using filename:", error);
        return fileName;
      }
    }
    case "text/plain":
    case "text/markdown":
    case "text/csv": {
      return buffer.toString("utf-8");
    }
    default: {
      // Unknown type — use filename as content for searchability
      return fileName;
    }
  }
}
