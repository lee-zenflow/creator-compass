export async function normalizeImage(file: File, maxSide = 2200): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("INVALID_IMAGE_TYPE");
  if (file.size > 12 * 1024 * 1024) throw new Error("IMAGE_TOO_LARGE");
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("CANVAS_NOT_AVAILABLE");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const image = context.getImageData(0, 0, width, height);
  for (let index = 0; index < image.data.length; index += 4) {
    const gray = 0.299 * (image.data[index] ?? 0) + 0.587 * (image.data[index + 1] ?? 0) + 0.114 * (image.data[index + 2] ?? 0);
    const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.35 + 128));
    image.data[index] = contrasted;
    image.data[index + 1] = contrasted;
    image.data[index + 2] = contrasted;
  }
  context.putImageData(image, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("IMAGE_NORMALIZE_FAILED")), "image/png"));
}
