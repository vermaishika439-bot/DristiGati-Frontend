import test from "node:test";
import assert from "node:assert/strict";
import {
  asArray,
  confidencePercent,
  eventId,
  formatConfidence,
  isEventTime,
  isPhysicalCameraVerified,
  isPhysicalRoverVerified,
  isPerson,
  readable,
} from "../src/utils.js";

test("confidence values support both unit and percentage scales", () => {
  assert.equal(confidencePercent(0.873), 87.3);
  assert.equal(confidencePercent(87.3), 87.3);
  assert.equal(formatConfidence(1), "100%");
  assert.equal(formatConfidence(null), "Confidence unavailable");
  assert.equal(confidencePercent(Number.NaN), null);
});

test("event and person helpers preserve backend identity and class semantics", () => {
  assert.equal(eventId({ event_id: "evt-9", id: "fallback" }), "evt-9");
  assert.equal(eventId({ id: "mission-2" }), "mission-2");
  assert.equal(
    eventId({ event_type: "person_detected", timestamp: 123 }),
    "person_detected-123",
  );
  assert.equal(isPerson({ object_class: "person" }), true);
  assert.equal(isPerson({ object_class: "vehicle" }), false);
});

test("missing or invalid backend values remain explicit", () => {
  assert.deepEqual(asArray({}), []);
  assert.equal(isEventTime("not-a-time"), null);
  assert.match(readable("PERSON_DETECTED"), /Person Detected/);
});

test("physical rover trust fails closed on missing, simulated, disconnected, or stale status", () => {
  const capabilities = { simulated_rover: false };
  const rover = { mode: "PHYSICAL", connected: true };
  const status = { connection: "connected", errors: {} };
  assert.equal(isPhysicalRoverVerified(capabilities, rover, status), true);
  assert.equal(
    isPhysicalRoverVerified({ simulated_rover: true }, rover, status),
    false,
  );
  assert.equal(isPhysicalRoverVerified(null, rover, status), false);
  assert.equal(
    isPhysicalRoverVerified(
      capabilities,
      { ...rover, mode: "SIMULATED" },
      status,
    ),
    false,
  );
  assert.equal(
    isPhysicalRoverVerified(capabilities, rover, {
      ...status,
      errors: { capabilities: "timeout" },
    }),
    false,
  );
  assert.equal(
    isPhysicalRoverVerified(capabilities, rover, {
      ...status,
      errors: { rover: "timeout" },
    }),
    false,
  );
  assert.equal(
    isPhysicalRoverVerified(capabilities, rover, {
      ...status,
      connection: "disconnected",
    }),
    false,
  );
  assert.equal(
    isPhysicalRoverVerified(
      capabilities,
      { ...rover, connected: false },
      status,
    ),
    false,
  );
});

test("physical camera trust requires source identity and a fresh connected frame", () => {
  const now = Date.parse("2026-10-26T18:00:00.000Z");
  const camera = {
    source_verified: true,
    configured: true,
    connected: true,
    streaming: true,
    stale: false,
    latest_frame_timestamp: now,
  };
  assert.equal(isPhysicalCameraVerified(camera, true, false, now), true);
  assert.equal(isPhysicalCameraVerified(camera, false, false, now), false);
  assert.equal(
    isPhysicalCameraVerified(
      { ...camera, source_verified: false },
      true,
      false,
      now,
    ),
    false,
  );
  assert.equal(
    isPhysicalCameraVerified({ ...camera, stale: true }, true, false, now),
    false,
  );
  assert.equal(
    isPhysicalCameraVerified(
      { ...camera, latest_frame_timestamp: now - 5001 },
      true,
      false,
      now,
    ),
    false,
  );
  assert.equal(
    isPhysicalCameraVerified(
      { ...camera, latest_frame_timestamp: now + 5001 },
      true,
      false,
      now,
    ),
    false,
  );
  assert.equal(isPhysicalCameraVerified(camera, true, true, now), false);
  assert.equal(
    isPhysicalCameraVerified(
      { ...camera, latest_frame_timestamp: undefined },
      true,
      false,
      now,
    ),
    false,
  );
});
