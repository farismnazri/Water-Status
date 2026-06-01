import { fileURLToPath } from "node:url";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const ENV_DIR = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, ENV_DIR, "VITE_");
  const isDebugViteEnv = process.env.DEBUG_VITE_ENV === "1";
  const chromeDevtoolsPath = "/.well-known/appspecific/com.chrome.devtools.json";

  if (command === "serve" && isDebugViteEnv) {
    console.info(
      `[vite] envDir=${ENV_DIR} VITE_API_BASE_URL=${env.VITE_API_BASE_URL ? "set" : "unset"} VITE_API_BASE=${env.VITE_API_BASE ? "set" : "unset"}`
    );
  }

  return {
    envDir: ENV_DIR,
    plugins: [
      {
        name: "chrome-devtools-appspecific-noise-filter",
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const path = req.url?.split("?")[0];
            if (path === chromeDevtoolsPath) {
              res.statusCode = 204;
              res.end();
              return;
            }
            next();
          });
        },
      },
      tailwindcss(),
      reactRouter(),
      tsconfigPaths(),
    ],
  };
});
