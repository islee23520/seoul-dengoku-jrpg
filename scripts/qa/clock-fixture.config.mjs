import { fileURLToPath } from 'node:url';

export default {
  root: fileURLToPath(new URL('./', import.meta.url)),
  build: { rollupOptions: { input: fileURLToPath(new URL('./clock-fixture.html', import.meta.url)) } },
};
