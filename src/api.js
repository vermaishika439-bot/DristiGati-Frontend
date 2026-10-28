const BASE_KEY = "dristigati.apiBaseUrl";
const DEFAULT_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:5000";

export function getApiBaseUrl() {
  if (typeof window === "undefined") return DEFAULT_BASE;
  return window.localStorage.getItem(BASE_KEY) || DEFAULT_BASE;
}

export function setApiBaseUrl(value) {
  const clean = String(value || "")
    .trim()
    .replace(/\/+$/, "");
  if (clean) {
    const parsed = new URL(clean);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      (parsed.pathname && parsed.pathname !== "/")
    ) {
      throw new TypeError(
        "API base URL must be an HTTP(S) origin without credentials or a path",
      );
    }
  }
  window.localStorage.setItem(BASE_KEY, clean || DEFAULT_BASE);
  return getApiBaseUrl();
}

function endpoint(path) {
  return `${getApiBaseUrl()}${path}`;
}

export class ApiError extends Error {
  constructor(message, { status, code, payload } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

async function request(
  path,
  { method = "GET", body, signal, timeoutMs = 7000 } = {},
) {
  const controller = new AbortController();
  const timer = window.setTimeout(
    () =>
      controller.abort(new DOMException("Request timed out", "TimeoutError")),
    timeoutMs,
  );
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(endpoint(path), {
      method,
      headers:
        body === undefined
          ? { Accept: "application/json" }
          : { Accept: "application/json", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.success !== true) {
      throw new ApiError(
        payload?.error?.message ||
          `Backend request failed (${response.status || "invalid response"})`,
        {
          status: response.status,
          code: payload?.error?.code,
          payload,
        },
      );
    }
    if (!Object.hasOwn(payload, "data"))
      throw new ApiError("Backend response is missing the data field", {
        status: response.status,
        payload,
      });
    return { data: payload.data, timestamp: payload.timestamp ?? null };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) {
      const reason = controller.signal.reason;
      throw new ApiError(
        reason?.name === "TimeoutError"
          ? "Backend request timed out"
          : "Backend request was cancelled",
        { code: "REQUEST_ABORTED" },
      );
    }
    throw new ApiError(error?.message || "Backend is unreachable", {
      code: "NETWORK_ERROR",
    });
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

async function image(path, { timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(
    () =>
      controller.abort(new DOMException("Request timed out", "TimeoutError")),
    timeoutMs,
  );
  try {
    const response = await fetch(endpoint(path), {
      headers: { Accept: "image/jpeg" },
      signal: controller.signal,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new ApiError(
        payload?.error?.message || `Image request failed (${response.status})`,
        { status: response.status, code: payload?.error?.code, payload },
      );
    }
    const blob = await response.blob();
    if (!blob.type.startsWith("image/"))
      throw new ApiError("Snapshot response was not an image", {
        code: "INVALID_IMAGE",
      });
    const source = response.headers.get("X-Camera-Source");
    if (source !== "physical-rover")
      throw new ApiError(
        "Backend did not attest this snapshot as a physical rover camera frame",
        { code: "CAMERA_SOURCE_UNVERIFIED" },
      );
    const timestampHeader = response.headers.get("X-Frame-Timestamp");
    const numericTimestamp = Number(timestampHeader);
    const frameMs =
      timestampHeader && Number.isFinite(numericTimestamp)
        ? numericTimestamp < 1e12
          ? numericTimestamp * 1000
          : numericTimestamp
        : Date.parse(timestampHeader || "");
    const ageMs = Date.now() - frameMs;
    if (!Number.isFinite(frameMs) || ageMs > 5000 || ageMs < -5000)
      throw new ApiError(
        "Snapshot is stale or has no valid frame timestamp; evidence was not saved",
        { code: "STALE_CAMERA_FRAME" },
      );
    return {
      blob,
      source,
      timestamp: new Date(frameMs).toISOString(),
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      controller.signal.aborted
        ? "Camera snapshot request timed out"
        : error?.message || "Camera snapshot unavailable",
      { code: controller.signal.aborted ? "TIMEOUT" : "NETWORK_ERROR" },
    );
  } finally {
    window.clearTimeout(timer);
  }
}

export const api = {
  health: (options) => request("/api/health", options),
  systemStatus: (options) => request("/api/system/status", options),
  capabilities: (options) => request("/api/system/capabilities", options),
  cameraStatus: (options) => request("/api/camera/status", options),
  missionStatus: (options) => request("/api/mission/status", options),
  missionHistory: (options) => request("/api/mission/history", options),
  start: () => request("/api/mission/start", { method: "POST", body: {} }),
  stop: () => request("/api/mission/stop", { method: "POST", body: {} }),
  resume: () => request("/api/mission/resume", { method: "POST", body: {} }),
  currentDetection: (options) => request("/api/detections/current", options),
  detectionHistory: (options) => request("/api/detections/history", options),
  acknowledge: (eventId) =>
    request("/api/detections/acknowledge", {
      method: "POST",
      body: { event_id: eventId },
    }),
  detectionConfig: (options) => request("/api/detections/config", options),
  currentObstacle: (options) => request("/api/obstacles/current", options),
  obstacleHistory: (options) => request("/api/obstacles/history", options),
  obstacleConfig: (options) => request("/api/obstacles/config", options),
  roverStatus: (options) => request("/api/rover/status", options),
  snapshot: () => image("/api/camera/snapshot"),
  streamUrl: (nonce = "") =>
    `${endpoint("/api/camera/stream")}${nonce ? `?retry=${encodeURIComponent(nonce)}` : ""}`,
};
