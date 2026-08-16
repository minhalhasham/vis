import { app, BrowserWindow, dialog, ipcMain, type WebContents } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  ControllerEvent,
  ControllerStatus,
  GenerateConformerRequest,
} from "@molecvis/protocol";
import { ChemistryWorker } from "./chemistry-worker";
import { ControllerServer } from "./controller-server";

let window: BrowserWindow | null = null;
let chemistry: ChemistryWorker | null = null;
let controller: ControllerServer | null = null;

const repositoryRoot = app.isPackaged
  ? path.dirname(process.resourcesPath)
  : path.resolve(app.getAppPath(), "..", "..");

function send(channel: string, payload: ControllerStatus | ControllerEvent): void {
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1050,
    minHeight: 680,
    backgroundColor: "#07111f",
    title: "MolecVis",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error(`Renderer failed to load ${url}: ${code} ${description}`);
  });
  window.webContents.on("console-message", (details) => {
    const log = details.level === "error"
      ? console.error
      : details.level === "warning"
        ? console.warn
        : console.log;
    log(`[renderer] ${details.message} (${details.sourceId}:${details.lineNumber})`);
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadURL(pathToFileURL(path.join(app.getAppPath(), "dist", "index.html")).toString());
}

function registerIpc(): void {
  chemistry = new ChemistryWorker(repositoryRoot);
  controller = new ControllerServer(
    (status) => send("controller:status", status),
    (event) => send("controller:event", event),
  );

  ipcMain.handle("chemistry:generate", (_event, request: GenerateConformerRequest) =>
    chemistry!.generateConformer(request),
  );
  ipcMain.handle("controller:start", () => controller!.start());
  ipcMain.handle("controller:stop", () => controller!.stop());
  ipcMain.handle("controller:status", () => controller!.currentStatus());

  ipcMain.handle("file:open", async () => {
    const result = await dialog.showOpenDialog(window!, {
      properties: ["openFile"],
      filters: [
        { name: "Molecule structures", extensions: ["mol", "sdf", "smi", "smiles"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    return {
      name: path.basename(filePath),
      extension: path.extname(filePath).toLowerCase(),
      data: await readFile(filePath, "utf8"),
    };
  });

  ipcMain.handle(
    "file:save",
    async (_event, payload: { data: string; defaultName: string; format: "mol" | "sdf" }) => {
      const result = await dialog.showSaveDialog(window!, {
        defaultPath: payload.defaultName,
        filters: [{ name: payload.format.toUpperCase(), extensions: [payload.format] }],
      });
      if (result.canceled || !result.filePath) return false;
      await writeFile(result.filePath, payload.data, "utf8");
      return true;
    },
  );
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  controller?.stop();
  chemistry?.dispose();
});
