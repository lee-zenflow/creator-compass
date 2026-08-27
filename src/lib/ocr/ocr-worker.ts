import type { Worker } from "tesseract.js";

import { normalizeImage } from "./normalize-image";

let workerPromise: Promise<Worker> | null = null;
let progressListener: ((progress: number) => void) | null = null;

async function worker() {
  if (!workerPromise) {
    workerPromise = import("tesseract.js").then(({ createWorker }) => createWorker("chi_sim+eng", 1, {
      logger(message) {
        if (message.status === "recognizing text" && typeof message.progress === "number") progressListener?.(message.progress);
      },
    }));
  }
  return workerPromise;
}

export async function recognizeScreenshot(file: File, onProgress: (progress: number) => void = () => undefined) {
  const normalized = await normalizeImage(file);
  progressListener = onProgress;
  try {
    const activeWorker = await worker();
    const result = await activeWorker.recognize(normalized);
    return { text: result.data.text, confidence: result.data.confidence };
  } finally {
    progressListener = null;
  }
}

export async function terminateOcrWorker() {
  const active = workerPromise;
  workerPromise = null;
  if (active) await (await active).terminate();
}
