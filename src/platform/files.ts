export async function saveFile(content: BlobPart, filename: string, type: string): Promise<boolean> {
  const blob = new Blob([content], { type });
  if (window.routeStudioDesktop) {
    return window.routeStudioDesktop.saveFile({
      name: filename,
      bytes: new Uint8Array(await blob.arrayBuffer()),
    });
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
