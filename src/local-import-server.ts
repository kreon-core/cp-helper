import * as http from "http";
import * as vscode from "vscode";
import { LOCAL_IMPORT_MAX_BODY } from "./constants";
import { cpLog } from "./log";

/**
 * POST /import on 127.0.0.1 for OJ Sync (no vscode:// browser prompt).
 * @param onImport called with UTF-8 body after successful POST /import
 */
export function startLocalImportHttpServer(
  onImport: (body: string) => Promise<void>,
): { restart: () => void; dispose: () => void } {
  let localImportHttpServer: http.Server | undefined;

  const restart = (): void => {
    if (localImportHttpServer) {
      localImportHttpServer.close();
      localImportHttpServer = undefined;
    }
    const cfg = vscode.workspace.getConfiguration("cp-helper");
    if (cfg.get<boolean>("enableLocalImportServer") === false) {
      cpLog("Local import server: disabled (cp-helper.enableLocalImportServer).");
      return;
    }
    const rawPort = cfg.get<number>("localImportPort");
    const port =
      typeof rawPort === "number" &&
      Number.isFinite(rawPort) &&
      rawPort >= 1 &&
      rawPort <= 65535
        ? Math.floor(rawPort)
        : 17337;

    const cors: Record<string, string> = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept",
    };

    const server = http.createServer((req, res) => {
      const sendJson = (code: number, obj: Record<string, unknown>): void => {
        const body = JSON.stringify(obj);
        res.writeHead(code, {
          ...cors,
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": Buffer.byteLength(body, "utf8"),
        });
        res.end(body);
      };

      if (req.method === "OPTIONS") {
        res.writeHead(204, cors);
        res.end();
        return;
      }

      let pathname = "";
      try {
        pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      } catch {
        pathname = "";
      }
      if (req.method !== "POST" || pathname !== "/import") {
        sendJson(404, { ok: false, error: "not found" });
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      let oversize = false;
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > LOCAL_IMPORT_MAX_BODY) {
          oversize = true;
          sendJson(413, { ok: false, error: "Request body too large" });
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        if (oversize) {
          return;
        }
        void (async () => {
          const bodyStr = Buffer.concat(chunks).toString("utf8");
          try {
            await onImport(bodyStr);
            sendJson(200, { ok: true });
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            sendJson(400, { ok: false, error: message });
          }
        })();
      });
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        cpLog(
          `Local import server: port ${port} in use — pick another cp-helper.localImportPort or close the other window.`,
        );
      } else {
        cpLog(`Local import server: ${err.message}`);
      }
    });

    server.listen(port, "127.0.0.1", () => {
      cpLog(
        `Local import server: POST http://127.0.0.1:${port}/import (OJ Sync)`,
      );
    });
    localImportHttpServer = server;
  };

  restart();

  const dispose = (): void => {
    if (localImportHttpServer) {
      localImportHttpServer.close();
      localImportHttpServer = undefined;
    }
  };

  return { restart, dispose };
}
