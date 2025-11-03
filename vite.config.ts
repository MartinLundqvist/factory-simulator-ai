import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  console.log(env);
  const port = env.PORT || 3000;
  return {
    plugins: [react()],
    build: {
      outDir: "dist/client",
      sourcemap: true,
    },
    server: {
      port: 5174,
      proxy: {
        "/api": {
          target: `http://localhost:${port}`,
          changeOrigin: true,
        },
      },
    },
  };
});
