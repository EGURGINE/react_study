// Decode locally, resize, and re-encode: only the displayed image is shared.
// Re-encoding also excludes the original file's EXIF metadata.
export async function preparePhoto(file) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("JPG, PNG, WebP 사진을 선택해 주세요.");
  if (file.size > 12 * 1024 * 1024)
    throw new Error("12MB 이하의 사진을 선택해 주세요.");
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height)
      throw new Error("이 사진을 열 수 없어요.");
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#faf8ed";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.68, 0.5, 0.35]) {
      const src = canvas.toDataURL("image/jpeg", quality);
      if (src.length < 650000) return src;
    }
    throw new Error("조금 더 작은 사진을 선택해 주세요.");
  } finally {
    bitmap.close();
  }
}
