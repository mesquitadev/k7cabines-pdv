import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  base: "./",
  plugins: [tsconfigPaths(), tailwindcss(), react()],
  resolve: {
    alias: [
      {
        find: "@tanstack/react-start",
        replacement: fileURLToPath(new URL("./src/lib/desktop/react-start-shim.ts", import.meta.url)),
      },
      {
        find: "@/lib/users.functions",
        replacement: fileURLToPath(new URL("./src/lib/desktop/users-functions-shim.ts", import.meta.url)),
      },
      {
        find: "@/integrations/supabase/client",
        replacement: fileURLToPath(new URL("./src/lib/desktop/supabase-disabled.ts", import.meta.url)),
      },
    ],
  },
  build: {
    outDir: "dist/desktop",
    emptyOutDir: true,
    rollupOptions: {
      input: "index.html",
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
});
