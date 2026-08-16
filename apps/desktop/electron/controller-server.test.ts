// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ControllerServer } from "./controller-server";
import type { ControllerEvent, ControllerStatus } from "@molecvis/protocol";

const waitForMessage = (socket: WebSocket): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    socket.once("message", (data) => resolve(JSON.parse(data.toString()) as Record<string, unknown>));
    socket.once("error", reject);
  });

describe("ControllerServer", () => {
  let server: ControllerServer | null = null;

  afterEach(() => {
    server?.stop();
    server = null;
  });

  it("authenticates one-time QR credentials and forwards validated events", async () => {
    const statuses: ControllerStatus[] = [];
    const events: ControllerEvent[] = [];
    server = new ControllerServer((status) => statuses.push(status), (event) => events.push(event));
    const pairing = await server.start();
    if (pairing.state === "error") throw new Error(pairing.message);
    expect(pairing.state).toBe("pairing");
    if (pairing.state !== "pairing") return;

    const uri = new URL(pairing.pairUri);
    const socket = new WebSocket(`ws://127.0.0.1:${pairing.port}`);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    socket.send(JSON.stringify({
      type: "hello",
      protocolVersion: 1,
      token: uri.searchParams.get("token"),
      client: "simulator",
    }));
    expect(await waitForMessage(socket)).toEqual({ type: "accepted", protocolVersion: 1 });

    socket.send(JSON.stringify({
      type: "pose",
      sequence: 7,
      timestamp: 12,
      quaternion: [0, 0, 0, 2],
    }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(events).toEqual([
      { type: "pose", sequence: 7, timestamp: 12, quaternion: [0, 0, 0, 1] },
    ]);
    expect(statuses.at(-1)).toEqual({ state: "connected", client: "simulator" });
    socket.close();
  });

  it("rejects an invalid token without forwarding control data", async () => {
    const events: ControllerEvent[] = [];
    server = new ControllerServer(() => {}, (event) => events.push(event));
    const pairing = await server.start();
    if (pairing.state !== "pairing") throw new Error("LAN pairing unavailable in test environment");
    const socket = new WebSocket(`ws://127.0.0.1:${pairing.port}`);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    socket.send(JSON.stringify({
      type: "hello",
      protocolVersion: 1,
      token: "wrong",
      client: "simulator",
    }));
    expect(await waitForMessage(socket)).toEqual({ type: "rejected", reason: "invalid-token" });
    expect(events).toEqual([]);
  });
});
