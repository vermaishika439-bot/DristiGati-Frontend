import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: [".sg2.manus.computer", "localhost", "127.0.0.1"],
  },
  preview: {
    allowedHosts: [".sg2.manus.computer", "localhost", "127.0.0.1"],
  },
});
