import { useEffect, useMemo, useRef, useState } from "react";
import { Editor } from "ketcher-react";
import { StandaloneStructServiceProvider } from "ketcher-standalone/dist/binaryWasm";
import type { ControllerStatus, GenerateConformerRequest } from "@molecvis/protocol";
import { PROTOCOL_VERSION } from "@molecvis/protocol";
import { MoleculeViewer, type MoleculeViewerHandle } from "./components/MoleculeViewer";
import { PairingDialog } from "./components/PairingDialog";

interface KetcherApi {
  getMolfile(format?: "v2000" | "v3000"): Promise<string>;
  getSdf(format?: "v2000" | "v3000"): Promise<string>;
  getSmiles(isExtended?: boolean): Promise<string>;
  setMolecule(structure: string, options?: { needZoom?: boolean }): Promise<void>;
}

type ViewerStyle = "ball-stick" | "spacefill";

export function App() {
  const provider = useMemo(() => new StandaloneStructServiceProvider(), []);
  const editorRef = useRef<KetcherApi | null>(null);
  const viewerRef = useRef<MoleculeViewerHandle>(null);
  const [viewerStyle, setViewerStyle] = useState<ViewerStyle>("ball-stick");
  const [showHydrogens, setShowHydrogens] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState("Draw a molecule to begin");
  const [error, setError] = useState("");
  const [controllerStatus, setControllerStatus] = useState<ControllerStatus>({ state: "idle" });
  const [showPairing, setShowPairing] = useState(false);

  useEffect(() => {
    void window.molecvis.controller.status().then((status) => {
      setControllerStatus(status);
      viewerRef.current?.setControllerConnected(status.state === "connected");
    });
    const offStatus = window.molecvis.controller.onStatus((status) => {
      setControllerStatus(status);
      viewerRef.current?.setControllerConnected(status.state === "connected");
    });
    const offEvent = window.molecvis.controller.onEvent((event) =>
      viewerRef.current?.applyControllerEvent(event),
    );
    return () => {
      offStatus();
      offEvent();
    };
  }, []);

  const guardEditor = (): KetcherApi => {
    if (!editorRef.current) throw new Error("The 2D editor is still loading.");
    return editorRef.current;
  };

  const reportError = (value: unknown) => {
    setError(value instanceof Error ? value.message : String(value));
  };

  const generate3D = async () => {
    setError("");
    setIsGenerating(true);
    setMessage("Generating a plausible conformer…");
    try {
      const molfile = await guardEditor().getMolfile("v3000");
      if (!molfile.includes("M  END")) throw new Error("Draw or import a molecule first.");
      const request: GenerateConformerRequest = {
        protocolVersion: PROTOCOL_VERSION,
        requestId: crypto.randomUUID(),
        operation: "generate-conformer",
        structure: { format: "mol-v3000", data: molfile },
        options: { includeHydrogens: true, randomSeed: 0x00c0ffee },
      };
      const response = await window.molecvis.chemistry.generateConformer(request);
      if (!response.ok) throw new Error(response.error.message);
      viewerRef.current?.loadMolfile(response.result.data);
      setMessage(
        `${response.result.atomCount} atoms · ${response.result.forceField} · 3D ready`,
      );
    } catch (value) {
      reportError(value);
      setMessage("The previous 3D model was kept");
    } finally {
      setIsGenerating(false);
    }
  };

  const openStructure = async () => {
    setError("");
    try {
      const file = await window.molecvis.files.open();
      if (!file) return;
      let structure = file.data;
      if (file.extension === ".sdf") structure = file.data.split("$$$$")[0];
      if (file.extension === ".smi" || file.extension === ".smiles") {
        structure = file.data.split(/\r?\n/).find((line) => line.trim())?.trim().split(/\s+/)[0] ?? "";
      }
      await guardEditor().setMolecule(structure, { needZoom: true });
      setMessage(`${file.name} loaded · Generate 3D when ready`);
    } catch (value) {
      reportError(value);
    }
  };

  const saveStructure = async (format: "mol" | "sdf") => {
    setError("");
    try {
      const editor = guardEditor();
      const data = format === "mol" ? await editor.getMolfile("v3000") : await editor.getSdf("v3000");
      const saved = await window.molecvis.files.save({
        data,
        defaultName: `molecule.${format}`,
        format,
      });
      if (saved) setMessage(`${format.toUpperCase()} saved`);
    } catch (value) {
      reportError(value);
    }
  };

  const copySmiles = async () => {
    setError("");
    try {
      await navigator.clipboard.writeText(await guardEditor().getSmiles());
      setMessage("SMILES copied to clipboard");
    } catch (value) {
      reportError(value);
    }
  };

  const startPairing = async () => {
    setShowPairing(true);
    try {
      setControllerStatus(await window.molecvis.controller.startPairing());
    } catch (value) {
      setControllerStatus({ state: "error", message: value instanceof Error ? value.message : String(value) });
    }
  };

  const closePairing = () => {
    setShowPairing(false);
    if (controllerStatus.state === "pairing") void window.molecvis.controller.stop();
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <div className="brand-glyph"><span /><span /><span /></div>
          <div>
            <h1>MolecVis</h1>
            <div className="brand-subtitle">MOLECULAR WORKBENCH</div>
          </div>
        </div>

        <nav className="toolbar" aria-label="Molecule actions">
          <button onClick={openStructure}>Open</button>
          <button onClick={() => saveStructure("mol")}>Save MOL</button>
          <button onClick={() => saveStructure("sdf")}>Save SDF</button>
          <button onClick={copySmiles}>Copy SMILES</button>
          <span className="toolbar-divider" />
          <button className="generate-button" onClick={generate3D} disabled={isGenerating}>
            <span className={isGenerating ? "spinner" : "spark"}>✦</span>
            {isGenerating ? "Generating…" : "Generate 3D"}
          </button>
          <button
            className={controllerStatus.state === "connected" ? "phone-button connected" : "phone-button"}
            onClick={startPairing}
          >
            <span className="phone-icon">▯</span>
            {controllerStatus.state === "connected" ? "iPhone connected" : "Pair iPhone"}
          </button>
        </nav>
      </header>

      <section className="workspace">
        <section className="editor-column">
          <div className="pane-heading">
            <div>
              <span className="step-number">01</span>
              <h2>Draw</h2>
            </div>
            <span className="pane-hint">2D STRUCTURE</span>
          </div>
          <div className="ketcher-host">
            <Editor
              staticResourcesUrl="./"
              structServiceProvider={provider}
              disableMacromoleculesEditor
              onInit={(ketcher) => {
                editorRef.current = ketcher as unknown as KetcherApi;
              }}
              errorHandler={(editorMessage) => setError(editorMessage)}
            />
          </div>
        </section>

        <section className="viewer-column">
          <div className="pane-heading">
            <div>
              <span className="step-number">02</span>
              <h2>Explore</h2>
            </div>
            <div className="viewer-controls">
              <label>
                <span>Style</span>
                <select value={viewerStyle} onChange={(event) => setViewerStyle(event.target.value as ViewerStyle)}>
                  <option value="ball-stick">Ball + stick</option>
                  <option value="spacefill">Space filling</option>
                </select>
              </label>
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={showHydrogens}
                  onChange={(event) => setShowHydrogens(event.target.checked)}
                />
                <span>Hydrogens</span>
              </label>
              <button className="compact-button" onClick={() => viewerRef.current?.resetView()}>Reset view</button>
            </div>
          </div>
          <MoleculeViewer ref={viewerRef} style={viewerStyle} showHydrogens={showHydrogens} />
        </section>
      </section>

      <footer className="status-bar">
        <div className="status-message">
          <span className={error ? "status-dot error" : "status-dot"} />
          {error || message}
        </div>
        <div className="connection-state">
          {controllerStatus.state === "connected" ? "LIVE PHONE CONTROL" : "LOCAL WORKSPACE"}
        </div>
      </footer>

      {showPairing && (
        <PairingDialog status={controllerStatus} onClose={closePairing} onRetry={startPairing} />
      )}
    </main>
  );
}
