import { homedir } from "node:os";
import { join } from "node:path";
import type { Message } from "@huggingface/transformers";

const modelId = "onnx-community/Qwen2.5-0.5B-Instruct";
type ModelStatus = {
  status: "not_started" | "loading" | "ready" | "error";
  progress: number | null;
};

let modelStatus: ModelStatus = { status: "not_started", progress: null };
let pipelinePromise: ReturnType<typeof loadPipeline> | null = null;

async function loadPipeline() {
  const { env, pipeline } = await import("@huggingface/transformers");
  env.cacheDir = join(homedir(), ".cache", "hybrid-power-ai");
  return pipeline("text-generation", modelId, {
    dtype: "q4f16",
    progress_callback: (progress) => {
      if (progress.status === "progress_total") {
        modelStatus = { status: "loading", progress: Math.round(progress.progress) };
      }
    },
  });
}

function getPipeline() {
  if (!pipelinePromise) {
    modelStatus = { status: "loading", progress: null };
    pipelinePromise = loadPipeline()
      .then((loadedPipeline) => {
        modelStatus = { status: "ready", progress: 100 };
        return loadedPipeline;
      })
      .catch((error: unknown) => {
        modelStatus = { status: "error", progress: null };
        pipelinePromise = null;
        throw new AssistantModelError(
          "The assistant couldn't download or load its model. Check your internet connection and available disk space, then try again.",
          { cause: error },
        );
      });
  }
  return pipelinePromise;
}

export class AssistantModelError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AssistantModelError";
  }
}

export function getAssistantModelStatus(): ModelStatus {
  return { ...modelStatus };
}

export async function generateAssistantReply(messages: Message[]): Promise<string> {
  const generator = await getPipeline();
  try {
    const output = await generator(messages, { max_new_tokens: 160, do_sample: false });
    const generated = output[0]?.generated_text;
    const lastMessage = typeof generated === "string" ? undefined : generated?.at(-1);
    const answer = typeof generated === "string"
      ? generated
      : typeof lastMessage?.content === "string"
        ? lastMessage.content
        : undefined;
    if (!answer?.trim()) throw new Error("The model returned an empty answer.");
    return answer.trim();
  } catch (error) {
    throw new AssistantModelError("The assistant couldn't generate a response. Please try again.", { cause: error });
  }
}
