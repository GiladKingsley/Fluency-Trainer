import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react-swc';

// https://vite.dev/config/
export default ({ mode }) => {
  process.env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };

  return defineConfig({
    plugins: [react()],
    base: mode === 'production' ? '/Fluency-Trainer/' : '/',
    build: {
      outDir: 'docs', // Output to the 'docs' directory
    },
  });
};