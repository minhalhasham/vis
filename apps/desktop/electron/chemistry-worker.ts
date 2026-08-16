import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type {
  ChemistryService,
  GenerateConformerRequest,
  GenerateConformerResponse,
} from "@molecvis/protocol";
import { PROTOCOL_VERSION } from "@molecvis/protocol";

interface PendingRequest {
  resolve: (response: GenerateConformerResponse) => void;
  timer: NodeJS.Timeout;
}

export class ChemistryWorker implements ChemistryService {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(private readonly repositoryRoot: string) {}

  async generateConformer(
    request: GenerateConformerRequest,
  ): Promise<GenerateConformerResponse> {
    try {
      this.ensureStarted();
    } catch (error) {
      return this.failure(request.requestId, "SERVICE_UNAVAILABLE", this.message(error));
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.requestId);
        resolve(
          this.failure(
            request.requestId,
            "SERVICE_UNAVAILABLE",
            "The local chemistry worker did not respond within 45 seconds.",
          ),
        );
      }, 45_000);

      this.pending.set(request.requestId, { resolve, timer });
      this.child!.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(request.requestId);
        resolve(this.failure(request.requestId, "SERVICE_UNAVAILABLE", this.message(error)));
      });
    });
  }

  dispose(): void {
    this.child?.kill();
    this.child = null;
    this.rejectAll("The chemistry worker stopped.");
  }

  private ensureStarted(): void {
    if (this.child && !this.child.killed) return;

    const workerPath = path.join(this.repositoryRoot, "services", "chemistry", "worker.py");
    if (!existsSync(workerPath)) {
      throw new Error(`Chemistry worker not found at ${workerPath}`);
    }

    const python = this.resolvePython();
    this.child = spawn(python, ["-u", workerPath], {
      cwd: this.repositoryRoot,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const lines = readline.createInterface({ input: this.child.stdout });
    lines.on("line", (line) => this.handleLine(line));
    this.child.stderr.on("data", (chunk) => {
      console.error(`[chemistry] ${String(chunk).trimEnd()}`);
    });
    this.child.on("error", (error) => this.rejectAll(this.message(error)));
    this.child.on("exit", (code) => {
      this.child = null;
      this.rejectAll(`The chemistry worker exited with code ${code ?? "unknown"}.`);
    });
  }

  private resolvePython(): string {
    if (process.env.MOLECVIS_PYTHON) return process.env.MOLECVIS_PYTHON;
    const local = process.platform === "win32"
      ? path.join(this.repositoryRoot, ".venv", "Scripts", "python.exe")
      : path.join(this.repositoryRoot, ".venv", "bin", "python");
    return existsSync(local) ? local : process.platform === "win32" ? "python" : "python3";
  }

  private handleLine(line: string): void {
    let response: GenerateConformerResponse;
    try {
      response = JSON.parse(line) as GenerateConformerResponse;
    } catch {
      console.error("Chemistry worker emitted invalid JSON.");
      return;
    }
    const pending = this.pending.get(response.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(response.requestId);
    pending.resolve(response);
  }

  private rejectAll(message: string): void {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve(this.failure(requestId, "SERVICE_UNAVAILABLE", message));
    }
    this.pending.clear();
  }

  private failure(
    requestId: string,
    code: "SERVICE_UNAVAILABLE",
    message: string,
  ): GenerateConformerResponse {
    return {
      protocolVersion: PROTOCOL_VERSION,
      requestId,
      ok: false,
      error: { code, message },
    };
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

