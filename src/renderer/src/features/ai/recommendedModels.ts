export type RecommendedModel = {
  id: string;
  name: string;
  fileName: string;
  url: string;
  sizeMb: number;
  contextSize: number;
  layers: number;
  estVramMb: number;
  description: string;
};

export const recommendedModels: RecommendedModel[] = [
  {
    id: "qwen-0_5b",
    name: "Qwen 2.5 0.5B Instruct",
    fileName: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
    url: "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf",
    sizeMb: 398,
    contextSize: 8192,
    layers: 24,
    estVramMb: 700,
    description: "Smallest tier. Runs comfortably on any laptop, even without a GPU.",
  },
  {
    id: "llama-3_2-3b",
    name: "Llama 3.2 3B Instruct",
    fileName: "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
    url: "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
    sizeMb: 2020,
    contextSize: 8192,
    layers: 28,
    estVramMb: 3200,
    description: "Good entry-class chat model. Sits well on 4 GB+ VRAM or fast CPU.",
  },
  {
    id: "qwen-7b",
    name: "Qwen 2.5 7B Instruct",
    fileName: "Qwen2.5-7B-Instruct-Q4_K_M.gguf",
    url: "https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf",
    sizeMb: 4680,
    contextSize: 8192,
    layers: 28,
    estVramMb: 6200,
    description: "Mid-tier chat model. Needs 6-8 GB VRAM for full GPU offload.",
  },
  {
    id: "llama-3_1-8b",
    name: "Llama 3.1 8B Instruct",
    fileName: "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
    url: "https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
    sizeMb: 4920,
    contextSize: 8192,
    layers: 32,
    estVramMb: 6800,
    description: "Strong general chat model. Best with 8 GB+ VRAM or pooled GPUs.",
  },
];

export type FitVerdict = {
  level: "ideal" | "tight" | "cpu" | "too-large";
  label: string;
  detail: string;
};

export function evaluateFit(
  model: RecommendedModel,
  totalFreeVramMb: number,
  freeRamMb: number,
): FitVerdict {
  if (totalFreeVramMb >= model.estVramMb) {
    return {
      level: "ideal",
      label: "Fits on GPU",
      detail: `${model.estVramMb} MB needed - ${totalFreeVramMb} MB free`,
    };
  }

  if (totalFreeVramMb >= model.estVramMb * 0.6) {
    return {
      level: "tight",
      label: "Tight on GPU",
      detail: `Partial offload - lower n_gpu_layers if it fails`,
    };
  }

  if (freeRamMb >= model.sizeMb + 1024) {
    return {
      level: "cpu",
      label: "CPU mode",
      detail: `Will run on CPU using ${model.sizeMb} MB of RAM`,
    };
  }

  return {
    level: "too-large",
    label: "Too large",
    detail: `Needs ~${model.sizeMb + 1024} MB free RAM`,
  };
}
