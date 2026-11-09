import { recognizeToolRegions } from './tool-recognition.js';
self.onmessage = async ({ data }) => {
  try {
    const result = await recognizeToolRegions(data.image, { ...data.options, onProgress: progress => self.postMessage({ progress }) });
    self.postMessage({ result }, [result.mask.buffer]);
  } catch (error) { self.postMessage({ error: error.message || 'Rozpoznávání selhalo.' }); }
};
