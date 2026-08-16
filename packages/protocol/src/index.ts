export const PROTOCOL_VERSION = 1 as const;

export type QuaternionTuple = readonly [
  x: number,
  y: number,
  z: number,
  w: number,
];

export interface HelloMessage {
  type: "hello";
  protocolVersion: number;
  token: string;
  client: "ios" | "simulator";
}

export interface AcceptedMessage {
  type: "accepted";
  protocolVersion: typeof PROTOCOL_VERSION;
}

export interface RejectedMessage {
  type: "rejected";
  reason: "invalid-token" | "version-mismatch" | "controller-in-use" | "invalid-message";
}

export interface PoseMessage {
  type: "pose";
  sequence: number;
  timestamp: number;
  quaternion: QuaternionTuple;
}

export interface PanMessage {
  type: "pan";
  dx: number;
  dy: number;
}

export interface ZoomMessage {
  type: "zoom";
  scale: number;
}

export interface RecenterMessage {
  type: "recenter";
}

export interface PingMessage {
  type: "ping";
  timestamp: number;
}

export interface PongMessage {
  type: "pong";
  timestamp: number;
}

export type ControllerClientMessage =
  | HelloMessage
  | PoseMessage
  | PanMessage
  | ZoomMessage
  | RecenterMessage
  | PingMessage;

export type ControllerServerMessage = AcceptedMessage | RejectedMessage | PongMessage;

export type ControllerEvent = Exclude<ControllerClientMessage, HelloMessage | PingMessage>;

export type ControllerStatus =
  | { state: "idle" }
  | { state: "pairing"; host: string; port: number; pairUri: string; expiresAt: number }
  | { state: "connected"; client: string }
  | { state: "error"; message: string };

export type StructureFormat = "mol-v3000";

export interface GenerateConformerRequest {
  protocolVersion: typeof PROTOCOL_VERSION;
  requestId: string;
  operation: "generate-conformer";
  structure: {
    format: StructureFormat;
    data: string;
  };
  options: {
    includeHydrogens: boolean;
    randomSeed: number;
  };
}

export interface GenerateConformerSuccess {
  protocolVersion: typeof PROTOCOL_VERSION;
  requestId: string;
  ok: true;
  result: {
    format: StructureFormat;
    data: string;
    forceField: "MMFF94s" | "UFF";
    atomCount: number;
    warnings: string[];
  };
}

export type ChemistryErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_STRUCTURE"
  | "MULTIPLE_COMPONENTS"
  | "EMBEDDING_FAILED"
  | "UNSUPPORTED_FORCE_FIELD"
  | "INTERNAL_ERROR"
  | "SERVICE_UNAVAILABLE";

export interface GenerateConformerFailure {
  protocolVersion: typeof PROTOCOL_VERSION;
  requestId: string;
  ok: false;
  error: {
    code: ChemistryErrorCode;
    message: string;
  };
}

export type GenerateConformerResponse =
  | GenerateConformerSuccess
  | GenerateConformerFailure;

export interface ChemistryService {
  generateConformer(request: GenerateConformerRequest): Promise<GenerateConformerResponse>;
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function normalizeQuaternion(value: readonly number[]): QuaternionTuple | null {
  if (value.length !== 4 || !value.every(finite)) return null;
  const magnitude = Math.hypot(value[0], value[1], value[2], value[3]);
  if (magnitude < 1e-8) return null;
  return [
    value[0] / magnitude,
    value[1] / magnitude,
    value[2] / magnitude,
    value[3] / magnitude,
  ];
}

export function parseControllerClientMessage(value: unknown): ControllerClientMessage | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  switch (record.type) {
    case "hello":
      return typeof record.protocolVersion === "number" &&
        typeof record.token === "string" &&
        (record.client === "ios" || record.client === "simulator")
        ? (record as unknown as HelloMessage)
        : null;
    case "pose": {
      const quaternion = Array.isArray(record.quaternion)
        ? normalizeQuaternion(record.quaternion)
        : null;
      return Number.isSafeInteger(record.sequence) && finite(record.timestamp) && quaternion
        ? {
            type: "pose",
            sequence: record.sequence as number,
            timestamp: record.timestamp,
            quaternion,
          }
        : null;
    }
    case "pan":
      return finite(record.dx) && finite(record.dy)
        ? { type: "pan", dx: record.dx, dy: record.dy }
        : null;
    case "zoom":
      return finite(record.scale) && record.scale > 0 && record.scale < 10
        ? { type: "zoom", scale: record.scale }
        : null;
    case "recenter":
      return { type: "recenter" };
    case "ping":
      return finite(record.timestamp) ? { type: "ping", timestamp: record.timestamp } : null;
    default:
      return null;
  }
}
