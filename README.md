# MolecVis

MolecVis is an experimental molecular drawing and visualization workspace. Draw a
small molecule in a ChemDraw-like 2D editor, generate a plausible 3D conformer,
and manipulate the 3D view from an iPhone over the local network.

The first prototype is intentionally local-first:

- Electron + React desktop application for Windows
- Ketcher 2D chemical editor
- RDKit ETKDG/MMFF chemistry worker
- 3Dmol.js molecular viewer
- Native SwiftUI/Core Motion iPhone controller
- Ephemeral QR pairing over a versioned WebSocket protocol

## Repository layout

```text
apps/desktop/         Electron and React desktop application
apps/ios/             Native iPhone controller Xcode project
packages/protocol/    Shared TypeScript wire and chemistry contracts
services/chemistry/   Local Python/RDKit JSON-lines worker
```

## Desktop development

Requirements: Node.js 22+, npm, Python 3.11+, and a Windows machine with WebGL.

```powershell
npm install
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r services\chemistry\requirements.txt
npm run dev
```

`npm run dev` starts Vite and Electron. MolecVis automatically uses
`.venv\Scripts\python.exe`; set `MOLECVIS_PYTHON` to override the interpreter.

Useful checks:

```powershell
npm test
npm run build
.\.venv\Scripts\python.exe -m pytest services\chemistry\tests
```

## iPhone development

Open `apps/ios/MolecVisController.xcodeproj` in Xcode on macOS, choose your
development team, and run it on a physical iPhone. The phone and PC must be on
the same local network. Windows Firewall may ask for permission the first time
the desktop starts pairing.

The iPhone app requests camera access to scan the pairing QR code and local
network access to reach the PC. Molecule data and motion samples remain local;
there are no accounts, telemetry, or cloud calls in this prototype.

## Supported prototype scope

- One connected, ordinary small organic molecule at a time
- MOL, first-record SDF, and pasted SMILES input
- MOL/SDF save and SMILES copy
- Ball-and-stick and space-filling visualization
- Phone orientation for rotation; phone touch gestures for pan and zoom

Reactions, macromolecules, organometallic edge cases, molecular dynamics, DFT,
signed Windows installers, and App Store distribution are future work. The
chemistry service interface and versioned controller protocol are designed so
those capabilities can be added without replacing the editor or phone pairing.

## Prototype security notes

The Electron renderer is sandboxed, uses context isolation, disables Node
integration, blocks external navigation, and exposes only narrow preload APIs.
Ketcher and 3Dmol currently require runtime code generation, so the local-file
Content Security Policy includes `unsafe-eval`; do not load remote web content
in this renderer. The phone socket accepts only versioned control messages and
uses a one-session 128-bit token.

Ketcher 3.14 also brings an unmaintained Draft.js/Immutable.js text-editor
dependency with published denial-of-service/prototype-pollution advisories. It
is retained for this local collaborator prototype and must be replaced or
upstream-patched before a public release. The independently fixable transitive
Minimatch advisory is pinned to a patched release through an npm override.
