import OpenAI from "openai";

// OpenAI client for embeddings only
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Generate embedding for text
export async function embed(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

// Generate embeddings for multiple texts (batch)
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: texts,
  });
  return response.data.map((d) => d.embedding);
}
