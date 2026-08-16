import type { QuaternionTuple } from "@molecvis/protocol";
import { normalizeQuaternion } from "@molecvis/protocol";

export function multiplyQuaternion(a: QuaternionTuple, b: QuaternionTuple): QuaternionTuple {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function inverseQuaternion(q: QuaternionTuple): QuaternionTuple {
  return [-q[0], -q[1], -q[2], q[3]];
}

export function relativeQuaternion(
  baseline: QuaternionTuple,
  current: QuaternionTuple,
): QuaternionTuple {
  return normalizeQuaternion(multiplyQuaternion(inverseQuaternion(baseline), current))!;
}

/**
 * Core Motion and WebGL both use right-handed quaternions. The relative attitude
 * is therefore kept intact; this named boundary is where device-orientation
 * compensation can be introduced after physical-device calibration.
 */
export function mapDeviceQuaternionToViewer(q: QuaternionTuple): QuaternionTuple {
  return q;
}

export function slerpQuaternion(
  from: QuaternionTuple,
  to: QuaternionTuple,
  amount: number,
): QuaternionTuple {
  let target = to;
  let dot = from[0] * to[0] + from[1] * to[1] + from[2] * to[2] + from[3] * to[3];
  if (dot < 0) {
    target = [-to[0], -to[1], -to[2], -to[3]];
    dot = -dot;
  }

  if (dot > 0.9995) {
    return normalizeQuaternion([
      from[0] + amount * (target[0] - from[0]),
      from[1] + amount * (target[1] - from[1]),
      from[2] + amount * (target[2] - from[2]),
      from[3] + amount * (target[3] - from[3]),
    ])!;
  }

  const theta = Math.acos(Math.min(1, dot));
  const sinTheta = Math.sin(theta);
  const a = Math.sin((1 - amount) * theta) / sinTheta;
  const b = Math.sin(amount * theta) / sinTheta;
  return [
    a * from[0] + b * target[0],
    a * from[1] + b * target[1],
    a * from[2] + b * target[2],
    a * from[3] + b * target[3],
  ];
}

export function quaternionAngularDistance(
  a: QuaternionTuple,
  b: QuaternionTuple,
): number {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, dot));
}

export function smoothingAmount(deltaMs: number, timeConstantMs = 40): number {
  if (deltaMs <= 0) return 0;
  return 1 - Math.exp(-Math.min(deltaMs, 100) / timeConstantMs);
}
