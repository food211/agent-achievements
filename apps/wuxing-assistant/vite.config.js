import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: { "/api": "http://localhost:4318", "/health": "http://localhost:4318" }
  }
});
