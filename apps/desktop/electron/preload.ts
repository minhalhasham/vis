import { contextBridge, ipcRenderer } from "electron";
import type {
  ControllerEvent,
  ControllerStatus,
  GenerateConformerRequest,
  GenerateConformerResponse,
} from "@molecvis/protocol";

const api = {
  chemistry: {
    generateConformer: (request: GenerateConformerRequest): Promise<GenerateConformerResponse> =>
      ipcRenderer.invoke("chemistry:generate", request),
  },
  controller: {
    startPairing: (): Promise<ControllerStatus> => ipcRenderer.invoke("controller:start"),
    stop: (): Promise<void> => ipcRenderer.invoke("controller:stop"),
    status: (): Promise<ControllerStatus> => ipcRenderer.invoke("controller:status"),
    onStatus: (listener: (status: ControllerStatus) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, status: ControllerStatus) => listener(status);
      ipcRenderer.on("controller:status", wrapped);
      return () => ipcRenderer.removeListener("controller:status", wrapped);
    },
    onEvent: (listener: (event: ControllerEvent) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, event: ControllerEvent) => listener(event);
      ipcRenderer.on("controller:event", wrapped);
      return () => ipcRenderer.removeListener("controller:event", wrapped);
    },
  },
  files: {
    open: (): Promise<{ name: string; extension: string; data: string } | null> =>
      ipcRenderer.invoke("file:open"),
    save: (payload: { data: string; defaultName: string; format: "mol" | "sdf" }): Promise<boolean> =>
      ipcRenderer.invoke("file:save", payload),
  },
};

contextBridge.exposeInMainWorld("molecvis", api);

export type MolecVisDesktopApi = typeof api;
