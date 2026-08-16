import { describe, expect, it } from "vitest";
import {
  inverseQuaternion,
  multiplyQuaternion,
  relativeQuaternion,
  slerpQuaternion,
} from "./motion";

describe("motion quaternion helpers", () => {
  const identity = [0, 0, 0, 1] as const;

  it("computes a relative orientation from the calibration pose", () => {
    const quarterTurn = [0, Math.SQRT1_2, 0, Math.SQRT1_2] as const;
    const relative = relativeQuaternion(identity, quarterTurn);
    relative.forEach((component, index) => expect(component).toBeCloseTo(quarterTurn[index]));
    const reset = multiplyQuaternion(inverseQuaternion(quarterTurn), quarterTurn);
    expect(reset[0]).toBeCloseTo(0);
    expect(reset[3]).toBeCloseTo(1);
  });

  it("interpolates along the shortest path", () => {
    const target = [0, 1, 0, 0] as const;
    const halfway = slerpQuaternion(identity, target, 0.5);
    expect(halfway[1]).toBeCloseTo(Math.SQRT1_2);
    expect(halfway[3]).toBeCloseTo(Math.SQRT1_2);
  });
});
