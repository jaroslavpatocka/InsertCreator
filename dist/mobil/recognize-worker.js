import { autoTraceImage } from './auto-trace.js';
self.onmessage = async ({ data }) => {
  try {
    const result = await autoTraceImage(data.image, { ...data.options, onProgress: progress => self.postMessage({ progress }) });
    self.postMessage({ result }, [result.mask.buffer]);
  } catch (error) { self.postMessage({ error: error.message || 'Rozpoznávání selhalo.' }); }
};
