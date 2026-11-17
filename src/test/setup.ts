import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Reading and validating a whole CSV takes longer under coverage instrumentation and with every test file
// running in parallel; the default 1 s wait for async UI updates is too tight there.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.location.hash = '';
  document.body.style.overflow = '';
});

// jsdom's Blob/File lack arrayBuffer() and text(), which every real browser has (the upload page uses them).
if (!Blob.prototype.arrayBuffer) {
  const read = (blob: Blob, as: 'buffer' | 'text') =>
    new Promise<ArrayBuffer | string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as ArrayBuffer | string);
      r.onerror = () => reject(r.error);
      if (as === 'buffer') r.readAsArrayBuffer(blob);
      else r.readAsText(blob);
    });
  Blob.prototype.arrayBuffer = function () {
    return read(this, 'buffer') as Promise<ArrayBuffer>;
  };
  Blob.prototype.text = function () {
    return read(this, 'text') as Promise<string>;
  };
}
