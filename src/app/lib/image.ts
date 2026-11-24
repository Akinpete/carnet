// Screenshots are shrunk before upload: the model's time grows with the
// image's pixels, not with its French. Measured 2026-11-24 on Mistral Small
// 3.1: a phone screenshot at full size took ≈ 14 s to read, at ≈ 1.3
// megapixels ≈ 6 s, with the same text read back.

/** About a phone screenshot at 768 px wide. Desktop screenshots keep more width. */
const MAX_PIXELS = 1_300_000;
const MAX_SIDE = 2048;
const QUALITY = 0.8;

/** What the server accepts as it is, if the browser can't redraw the image. */
const PASSTHROUGH = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function shrinkForUpload(file: Blob): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    if (PASSTHROUGH.includes(file.type)) return new File([file], "screenshot", { type: file.type });
    throw new Error("Carnet can't read that image. Try a screenshot.");
  }
  const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (bitmap.width * bitmap.height)), MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("Carnet can't read that image. Try a screenshot.");
  // JPEG has no transparency: put screenshots with clear areas on white.
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, width, height);
  g.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
  if (!blob) throw new Error("Carnet can't read that image. Try a screenshot.");
  return new File([blob], "screenshot.jpg", { type: "image/jpeg" });
}
