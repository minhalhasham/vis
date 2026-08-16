import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import type { Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  PROTOCOL_VERSION,
  parseControllerClientMessage,
  type ControllerEvent,
  type ControllerStatus,
  type RejectedMessage,
} from "@molecvis/protocol";

const PAIRING_LIFETIME_MS = 120_000;
const MAX_MESSAGE_BYTES = 8 * 1024;

type StatusListener = (status: ControllerStatus) => void;
type EventListener = (event: ControllerEvent) => void;

export class ControllerServer {
  private server: WebSocketServer | null = null;
  private controller: WebSocket | null = null;
  private token = "";
  private expiryTimer: NodeJS.Timeout | null = null;
  private status: ControllerStatus = { state: "idle" };

  constructor(
    private readonly onStatus: StatusListener,
    private readonly onEvent: EventListener,
  ) {}

  async start(): Promise<ControllerStatus> {
    this.stop();
    const host = findLanAddress();
    if (!host) {
      return this.setStatus({
        state: "error",
        message: "No private IPv4 network was found. Connect the PC to Wi-Fi or Ethernet.",
      });
    }

    this.token = randomBytes(16).toString("hex");
    this.server = new WebSocketServer({
      host: "0.0.0.0",
      port: 0,
      maxPayload: MAX_MESSAGE_BYTES,
      perMessageDeflate: false,
    });

    await new Promise<void>((resolve, reject) => {
      const server = this.server!;
      server.once("listening", resolve);
      server.once("error", reject);
    }).catch((error) => {
      this.stop();
      throw error;
    });

    this.server.on("connection", (socket) => this.handleConnection(socket));
    this.server.on("error", (error) => {
      this.setStatus({ state: "error", message: error.message });
    });

    const address = this.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const expiresAt = Date.now() + PAIRING_LIFETIME_MS;
    const pairUri = `molecvis://pair?host=${encodeURIComponent(host)}&port=${port}&token=${this.token}&v=${PROTOCOL_VERSION}`;
    this.expiryTimer = setTimeout(() => this.stop(), PAIRING_LIFETIME_MS);
    return this.setStatus({ state: "pairing", host, port, pairUri, expiresAt });
  }

  stop(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    this.controller?.close(1001, "Pairing ended");
    this.controller = null;
    this.server?.clients.forEach((socket) => socket.terminate());
    this.server?.close();
    this.server = null;
    this.token = "";
    this.setStatus({ state: "idle" });
  }

  currentStatus(): ControllerStatus {
    return this.status;
  }

  private handleConnection(socket: WebSocket): void {
    let authorized = false;
    const authorizationTimer = setTimeout(() => socket.close(1008, "Authentication timeout"), 5_000);

    socket.on("message", (raw, binary) => {
      const payload = Array.isArray(raw)
        ? Buffer.concat(raw)
        : raw instanceof ArrayBuffer
          ? Buffer.from(new Uint8Array(raw))
          : raw;
      if (binary || payload.byteLength > MAX_MESSAGE_BYTES) {
        socket.close(1003, "Text messages only");
        return;
      }

      let decoded: unknown;
      try {
        decoded = JSON.parse(payload.toString("utf8"));
      } catch {
        this.reject(socket, "invalid-message");
        return;
      }

      const message = parseControllerClientMessage(decoded);
      if (!message) {
        this.reject(socket, "invalid-message");
        return;
      }

      if (!authorized) {
        if (message.type !== "hello") {
          this.reject(socket, "invalid-message");
          return;
        }
        if (message.protocolVersion !== PROTOCOL_VERSION) {
          this.reject(socket, "version-mismatch");
          return;
        }
        if (message.token !== this.token || !this.token) {
          this.reject(socket, "invalid-token");
          return;
        }
        if (this.controller && this.controller.readyState === WebSocket.OPEN) {
          this.reject(socket, "controller-in-use");
          return;
        }
        clearTimeout(authorizationTimer);
        authorized = true;
        this.controller = socket;
        if (this.expiryTimer) clearTimeout(this.expiryTimer);
        this.expiryTimer = null;
        socket.send(JSON.stringify({ type: "accepted", protocolVersion: PROTOCOL_VERSION }));
        this.setStatus({ state: "connected", client: message.client });
        return;
      }

      if (message.type === "hello") return;
      if (message.type === "ping") {
        socket.send(JSON.stringify({ type: "pong", timestamp: message.timestamp }));
        return;
      }
      this.onEvent(message);
    });

    socket.on("close", () => {
      clearTimeout(authorizationTimer);
      if (this.controller !== socket) return;
      this.controller = null;
      // Tokens are single-session. Closing the server also closes unauthenticated peers.
      this.stop();
    });
  }

  private reject(socket: WebSocket, reason: RejectedMessage["reason"]): void {
    socket.send(JSON.stringify({ type: "rejected", reason } satisfies RejectedMessage));
    socket.close(1008, reason);
  }

  private setStatus(status: ControllerStatus): ControllerStatus {
    this.status = status;
    this.onStatus(status);
    return status;
  }
}

export function findLanAddress(): string | null {
  const candidates = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter(
      (entry) =>
        entry.family === "IPv4" &&
        !entry.internal &&
        (entry.address.startsWith("10.") ||
          entry.address.startsWith("192.168.") ||
          /^172\.(1[6-9]|2\d|3[01])\./.test(entry.address)),
    );
  return candidates[0]?.address ?? null;
}
