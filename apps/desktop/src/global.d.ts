import type { MolecVisDesktopApi } from "../electron/preload";

declare global {
  interface Window {
    molecvis: MolecVisDesktopApi;
  }
}

declare module "3dmol" {
  export interface GLViewer {
    addModel(data: string, format: string): unknown;
    removeAllModels(): void;
    setStyle(selection: object, style: object): void;
    zoomTo(): void;
    zoom(factor: number): void;
    render(callback?: () => void): void;
    resize(): void;
    getView(): number[];
    setView(view: number[]): void;
  }

  export function createViewer(
    element: HTMLElement,
    config?: Record<string, unknown>,
  ): GLViewer;
}

export {};
