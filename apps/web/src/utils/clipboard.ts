/**
 * Resilient Cross-Browser & Cross-Origin Clipboard Helper
 * Works on:
 * - HTTPS / Localhost (navigator.clipboard Async API)
 * - HTTP LAN IP (e.g. http://192.168.1.50:3000) via document.execCommand fallback
 * - Safari / iOS WebKit without throwing unhandled security rejections
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // 0. Native Android Bridge direct system clipboard support
  if (typeof window !== 'undefined' && (window as any).AndroidBridge && typeof (window as any).AndroidBridge.copyToClipboard === 'function') {
    try {
      (window as any).AndroidBridge.copyToClipboard(text);
      return true;
    } catch {
      // Fall through to web APIs
    }
  }

  // 1. Try modern asynchronous Clipboard API if available and permitted
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to textarea fallback
    }
  }

  // 2. Legacy fallback for non-secure HTTP contexts (e.g. LAN IP browsing)
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    textArea.setAttribute('readonly', '');
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch {
    return false;
  }
}
