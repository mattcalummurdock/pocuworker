/** Strip file-size mentions from agent chat text in the UI. */
export function stripChatFileSizes(text: string): string {
  return text
    .replace(/,?\s*[\d.]+\s*MB\s*total/gi, "")
    .replace(/,?\s*[\d.]+\s*GB\s*total/gi, "")
    .replace(/\(\s*[\d.]+\s*(MB|GB|KB)\s*\)/gi, "")
    .replace(/\s*·\s*[\d.]+\s*(MB|GB|KB)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+—/g, " —")
    .trim();
}
