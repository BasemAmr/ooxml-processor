import { fileURLToPath, URL } from 'node:url';

// Keep the demo's static files rooted at the app so Vite serves the browser shell
// without allowing accidental reads from package source directories.
export default {
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  build: { outDir: 'dist-web', emptyOutDir: true },
};
