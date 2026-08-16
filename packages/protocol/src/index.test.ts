import { describe, expect, it } from "vitest";
import { normalizeQuaternion, parseControllerClientMessage } from "./index";

describe("normalizeQuaternion", () => {
  it("normalizes a finite quaternion", () => {
    expect(normalizeQuaternion([0, 0, 0, 2])).toEqual([0, 0, 0, 1]);
  });

  it("rejects zero and non-finite quaternions", () => {
    expect(normalizeQuaternion([0, 0, 0, 0])).toBeNull();
    expect(normalizeQuaternion([0, 0, Number.NaN, 1])).toBeNull();
  });
});

describe("parseControllerClientMessage", () => {
  it("normalizes incoming poses", () => {
    expect(
      parseControllerClientMessage({
        type: "pose",
        sequence: 4,
        timestamp: 10,
        quaternion: [0, 0, 0, 2],
      }),
    ).toEqual({
      type: "pose",
      sequence: 4,
      timestamp: 10,
      quaternion: [0, 0, 0, 1],
    });
  });

  it("rejects malformed and unsafe events", () => {
    expect(parseControllerClientMessage({ type: "zoom", scale: -1 })).toBeNull();
    expect(parseControllerClientMessage({ type: "pose", sequence: 1 })).toBeNull();
  });
});
