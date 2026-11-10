import { recognizeToolRegions } from './tool-recognition.js';
import {recognizeClassical} from './recognize-classical.js';
self.onmessage = async ({ data }) => {
  try {
    const result = await (data.options?.engine==='classical'?recognizeClassical:recognizeToolRegions)(data.image, { ...data.options, onProgress: progress => self.postMessage({ progress }) });
    self.postMessage({ result }, [result.mask.buffer]);
  } catch (error) { self.postMessage({ error: error.message || 'Rozpoznávání selhalo.' }); }
};
