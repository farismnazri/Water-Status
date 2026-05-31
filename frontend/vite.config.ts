import { fileURLToPath } from "node:url";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const ENV_DIR = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, ENV_DIR, "VITE_");

  if (command === "serve") {
    console.info(
      `[vite] envDir=${ENV_DIR} VITE_API_BASE_URL=${env.VITE_API_BASE_URL ? "set" : "unset"} VITE_API_BASE=${env.VITE_API_BASE ? "set" : "unset"}`
    );
  }

  return {
    envDir: ENV_DIR,
    plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
  };
});
