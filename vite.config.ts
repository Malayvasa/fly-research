import { defineConfig } from "vite";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [
    {
      name: "local-dualsense-speaker",
      configureServer(server) {
        // Opt-in local macOS USB experiment; never included in production builds.
        let enabled =
          process.platform === "darwin" &&
          process.env.FLY_CONTROLLER_SPEAKER === "1";
        const binary = resolve("artifacts/controller-speaker");
        if (enabled) {
          try {
            mkdirSync(resolve("artifacts"), { recursive: true });
            const sdk =
              "/Library/Developer/CommandLineTools/SDKs/MacOSX15.2.sdk";
            execFileSync("/usr/bin/clang", [
              ...(existsSync(sdk) ? ["-isysroot", sdk] : []),
              "scripts/controller-speaker.c",
              "-framework",
              "AudioToolbox",
              "-framework",
              "CoreAudio",
              "-framework",
              "IOKit",
              "-framework",
              "CoreFoundation",
              "-o",
              binary,
            ]);
          } catch (error) {
            enabled = false;
            server.config.logger.warn(
              `Controller speaker unavailable: ${error}`,
            );
          }
        }
        let ready = false;
        let pending: ((ok: boolean) => void) | null = null;
        const helper = enabled
          ? spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] })
          : null;
        let output = "";
        helper?.stdout.on("data", (chunk) => {
          output += chunk.toString();
          let end: number;
          while ((end = output.indexOf("\n")) >= 0) {
            const line = output.slice(0, end).trim();
            output = output.slice(end + 1);
            if (line === "READY") ready = true;
            else if (line === "PLAYING" || line === "ERROR") {
              const respond = pending;
              pending = null;
              respond?.(line === "PLAYING");
            }
          }
        });
        helper?.stderr.on("data", (chunk) =>
          server.config.logger.warn(chunk.toString()),
        );
        const disconnected = () => {
          ready = false;
          const respond = pending;
          pending = null;
          respond?.(false);
        };
        helper?.on("error", disconnected);
        helper?.on("exit", disconnected);
        server.httpServer?.once("close", () => helper?.stdin.end());
        server.middlewares.use("/__controller/countdown", (req, res) => {
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          const host = req.headers.host;
          if (
            !host ||
            !/^(127\.0\.0\.1|localhost):\d+$/.test(host) ||
            (req.headers.origin && req.headers.origin !== `http://${host}`)
          ) {
            res.statusCode = 403;
            res.end('{"ok":false}');
            return;
          }
          if (req.method === "GET") {
            res.end(JSON.stringify({ enabled: enabled && ready }));
            return;
          }
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end('{"ok":false}');
            return;
          }
          const step = new URL(
            req.url ?? "/",
            "http://localhost",
          ).searchParams.get("step");
          if (!enabled || !ready || !step || !/^[0-5]$/.test(step)) {
            res.statusCode = 503;
            res.end('{"ok":false}');
            return;
          }
          if (pending) {
            res.statusCode = 429;
            res.end('{"ok":false}');
            return;
          }
          const timeout = setTimeout(() => {
            pending = null;
            res.statusCode = 504;
            res.end('{"ok":false}');
          }, 1000);
          pending = (ok) => {
            clearTimeout(timeout);
            res.statusCode = ok ? 200 : 503;
            res.end(JSON.stringify({ ok }));
          };
          helper!.stdin.write(`${step}\n`);
        });
      },
    },
  ],
});
