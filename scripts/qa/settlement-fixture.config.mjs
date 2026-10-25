import { fileURLToPath } from 'node:url';

export default {
  root: fileURLToPath(new URL('./', import.meta.url)),
  build: { rollupOptions: { input: [fileURLToPath(new URL('./settlement-fixture.html', import.meta.url)), fileURLToPath(new URL('./settlement-frame.html', import.meta.url)), fileURLToPath(new URL('./settlement-frame-390.html', import.meta.url))] } },
};
