export const asArray = (value) => (Array.isArray(value) ? value : []);
export const isPerson = (event) =>
  /person|human/i.test(String(event?.object_class || ""));
export const confidencePercent = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round((value >= 0 && value <= 1 ? value * 100 : value) * 10) / 10;
};
export const formatConfidence = (value) => {
  const percent = confidencePercent(value);
  return percent == null ? "Confidence unavailable" : `${percent}%`;
};
export const formatDate = (value) => {
  if (value == null || value === "") return "Not reported";
  const date =
    typeof value === "number"
      ? new Date(value < 1e12 ? value * 1000 : value)
      : new Date(value);
  return Number.isNaN(date.getTime()) ? "Not reported" : date.toLocaleString();
};
export const formatTime = (value) => {
  if (value == null || value === "") return "Not reported";
  const date =
    typeof value === "number"
      ? new Date(value < 1e12 ? value * 1000 : value)
      : new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not reported"
    : date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
};
export const eventId = (event) =>
  event?.event_id ||
  event?.id ||
  `${event?.event_type || event?.object_class || "event"}-${event?.timestamp || ""}`;
export const isEventTime = (value) => {
  if (value == null || value === "") return null;
  const date =
    typeof value === "number"
      ? new Date(value < 1e12 ? value * 1000 : value)
      : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
};
export const readable = (value) =>
  value == null || value === ""
    ? "Not reported"
    : String(value)
        .replaceAll("_", " ")
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase());

export const isPhysicalRoverVerified = (capabilities, rover, status = {}) =>
  status.connection === "connected" &&
  !status.errors?.capabilities &&
  !status.errors?.rover &&
  capabilities?.simulated_rover === false &&
  rover?.mode === "PHYSICAL" &&
  rover?.connected === true;

export const isPhysicalCameraVerified = (
  camera,
  physicalRoverVerified,
  cameraError = false,
  now = Date.now(),
) => {
  if (
    !physicalRoverVerified ||
    cameraError ||
    camera?.source_verified !== true ||
    camera?.configured !== true ||
    camera?.connected !== true ||
    camera?.streaming !== true ||
    camera?.stale !== false
  )
    return false;
  const timestamp = isEventTime(camera.latest_frame_timestamp);
  const age = timestamp == null ? Infinity : now - timestamp;
  return age >= -5000 && age <= 5000;
};
