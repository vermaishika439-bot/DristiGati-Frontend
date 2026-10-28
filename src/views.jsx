import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertOctagon,
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  Bell,
  Camera,
  Check,
  CheckCheck,
  ChevronRight,
  Command,
  CircleHelp,
  Clock3,
  Download,
  ExternalLink,
  FileDown,
  Filter,
  Image,
  MapPin,
  Maximize,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  ScanEye,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { api, setApiBaseUrl } from "./api.js";
import {
  asArray,
  confidencePercent,
  eventId,
  formatConfidence,
  formatDate,
  formatTime,
  isEventTime,
  isPerson,
  readable,
} from "./utils.js";

const Panel = ({ title, subtitle, action, children, className = "" }) => (
  <section className={`panel ${className}`}>
    <header className="panel-head">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </header>
    {children}
  </section>
);
const Empty = ({ icon: Icon = CircleHelp, title, children, action }) => (
  <div className="empty-state">
    {Icon && (
      <span className="empty-icon">
        <Icon size={20} />
      </span>
    )}
    <b>{title}</b>
    <p>{children}</p>
    {action}
  </div>
);
const Badge = ({ tone = "neutral", children, dot = false }) => (
  <span className={`badge ${tone}`}>
    {dot && <i className="status-dot" />}
    {children}
  </span>
);
const DataRow = ({ label, value, tone }) => (
  <div className="data-row">
    <span>{label}</span>
    <b className={tone || ""}>{value ?? "Not reported"}</b>
  </div>
);
const SectionLabel = ({ children, right }) => (
  <div className="section-label">
    <span>{children}</span>
    {right}
  </div>
);
const verifiedPhysical = (c) => !!c.physicalLinkReported;
const missionState = (c) => c.currentMission?.state || "Not reported";
const backendStatus = (c) =>
  c.connection === "connected"
    ? "Backend reachable"
    : c.connection === "connecting"
      ? "Connecting"
      : "Backend disconnected";
const roverModeLabel = (c) =>
  c.capabilities?.simulated_rover === true
    ? "Simulated backend · physical data withheld"
    : verifiedPhysical(c)
      ? "Physical link reported · hardware unverified"
      : "Physical rover not verified";
const missionHistory = (c) => asArray(c.data.missionHistory);
const detectionHistory = (c) => asArray(c.data.detections);
const obstacleHistory = (c) => asArray(c.data.obstacleHistory);
const withheldTitle = (c, label) =>
  c.simulationActive
    ? `${label} withheld in simulated mode`
    : `${label} withheld · physical source unverified`;
const withheldMessage = (c) =>
  c.simulationActive
    ? "Backend reports simulated rover mode; simulation-derived values are not presented as physical data."
    : "Backend has not jointly confirmed simulation disabled and a connected PHYSICAL rover adapter; physical values remain withheld.";
const visionWithheldTitle = (c, label) =>
  c.physicalDataWithheld
    ? withheldTitle(c, label)
    : `${label} withheld · camera source not attested`;
const visionWithheldMessage = (c) =>
  c.physicalDataWithheld
    ? withheldMessage(c)
    : "The backend does not attest which camera source produced these frames; visual events and evidence are withheld.";
const allEvents = (c) =>
  [
    ...missionHistory(c).map((e) => ({
      ...e,
      source: "Mission",
      label: e.event_type || "Mission event",
    })),
    ...detectionHistory(c).map((e) => ({
      ...e,
      source: "Vision",
      label: `${e.object_class || "Object"} detection`,
    })),
    ...obstacleHistory(c).map((e) => ({
      ...e,
      source: "Obstacle vision",
      label: `${e.object_class || "Obstacle"} · ${e.status || "warning"}`,
    })),
  ]
    .filter((e) => e.timestamp != null)
    .sort(
      (a, b) =>
        (isEventTime(b.timestamp) || 0) - (isEventTime(a.timestamp) || 0),
    );
const dataUnavailable = (c, key) =>
  !!c.errors[key] || c.connection !== "connected";
const cameraStatusLabel = (c) => {
  if (c.physicalDataWithheld)
    return c.simulationActive
      ? "Withheld · simulated backend"
      : "Physical source not verified";
  const camera = c.data.camera || c.data.system?.camera;
  if (!camera)
    return dataUnavailable(c, "camera") ? "Unavailable" : "Not reported";
  if (camera.connected && !c.physicalLinkReported)
    return "Stream source unverified";
  if (camera.connected && camera.source_verified !== true)
    return "Source not attested";
  if (!camera.configured) return "Not configured";
  if (!camera.connected) return "Disconnected";
  if (camera.stale) return "Stale frame";
  return "Connected";
};
const cameraTone = (c) =>
  cameraStatusLabel(c) === "Connected"
    ? "good"
    : [
          "Stale frame",
          "Stream source unverified",
          "Source not attested",
          "Physical source not verified",
        ].includes(cameraStatusLabel(c))
      ? "warn"
      : cameraStatusLabel(c).startsWith("Withheld")
        ? "neutral"
        : "bad";
const detectionPipelineLabel = (c) => {
  const cfg = c.data.detectionConfig || c.data.system?.detection;
  if (!cfg)
    return dataUnavailable(c, "detectionConfig")
      ? "Unavailable"
      : "Not reported";
  if (!cfg.weights_available) return cfg.error || "Model weights unavailable";
  return "Model weights found; inference not independently verified";
};
const safetySummary = (c) => {
  const r = c.rover;
  if (!verifiedPhysical(c)) return "Physical safety state not verified";
  if (Array.isArray(r?.active_safety_faults) && r.active_safety_faults.length)
    return `${r.active_safety_faults.length} active controller fault(s)`;
  if (r?.obstacle_sensor !== "SAFE" || r?.cliff_sensor !== "SAFE")
    return "A sensor is not reported SAFE";
  if (!Array.isArray(r?.active_safety_faults))
    return "Active safety faults not reported";
  return "Backend reports sensors SAFE · hardware test still unverified";
};

function useBlobUrl(blob) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!blob) {
      setUrl("");
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

function CameraPanel({ c, compact = false }) {
  const camera = c.data.camera || c.data.system?.camera;
  const [retryKey, setRetryKey] = useState(0);
  const [failed, setFailed] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const container = useRef(null);
  const frameTime = isEventTime(camera?.latest_frame_timestamp);
  const frameAge = frameTime == null ? Infinity : Date.now() - frameTime;
  const frameAvailable =
    !c.physicalVisionWithheld &&
    camera?.source_verified === true &&
    !!camera?.configured &&
    !!camera?.connected &&
    !!camera?.streaming &&
    camera?.stale === false &&
    frameAge >= -5000 &&
    frameAge <= 5000 &&
    !failed;
  const streamSrc = frameAvailable ? api.streamUrl(String(retryKey)) : "";
  useEffect(() => {
    const changed = () =>
      setFullscreen(document.fullscreenElement === container.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  const enterFullscreen = async () => {
    setFullscreenError("");
    try {
      if (!document.fullscreenElement)
        await container.current?.requestFullscreen();
      else await document.exitFullscreen();
    } catch (error) {
      setFullscreenError(
        error.message || "Fullscreen is unavailable in this browser",
      );
    }
  };
  const retry = () => {
    setFailed(false);
    setRetryKey((v) => v + 1);
    c.refresh();
  };
  const captureReady = frameAvailable && !c.commandState.busy;
  return (
    <Panel
      title={compact ? "Rover camera" : "Rover camera feed"}
      subtitle={
        compact
          ? "Backend-attested, fresh physical camera feed only"
          : "Only fresh frames with explicit physical-camera provenance are shown"
      }
      action={
        <Badge tone={cameraTone(c)} dot>
          {cameraStatusLabel(c)}
        </Badge>
      }
      className={compact ? "camera-panel compact-camera" : "camera-panel"}
    >
      <div
        className={`camera-stage ${fullscreen ? "camera-fullscreen" : ""}`}
        ref={container}
      >
        {streamSrc && (
          <img
            key={retryKey}
            src={streamSrc}
            alt="Live physical rover camera stream"
            onError={() => setFailed(true)}
          />
        )}
        {!frameAvailable && (
          <div className="camera-placeholder">
            <span className="camera-placeholder-icon">
              <Video size={24} />
            </span>
            <b>
              {c.simulationActive
                ? "Camera feed withheld in simulated mode"
                : c.physicalDataWithheld
                  ? "Physical rover camera source unverified"
                  : camera?.source_verified !== true
                    ? "Camera source not attested by backend"
                    : !camera?.configured
                      ? "Rover camera not connected"
                      : !camera?.connected
                        ? "Waiting for rover camera connection"
                        : camera?.stale
                          ? "Camera frame is stale"
                          : failed
                            ? "Camera stream unavailable"
                            : "Waiting for rover camera connection"}
            </b>
            <p>
              {c.simulationActive
                ? "Backend is configured for simulation; the dashboard does not present its camera state as physical rover evidence."
                : c.physicalDataWithheld
                  ? "A backend camera URL alone does not verify that frames originate from the physical rover."
                  : camera?.source_verified !== true
                    ? "The backend does not attest which camera source produced the stream, so the feed and capture are withheld."
                    : !camera?.configured
                      ? "The backend has no CAMERA_STREAM_URL configured. The operator’s laptop camera is never used."
                      : camera?.stale
                        ? "Backend reports that its latest frame is stale; live imagery is withheld."
                        : c.errors.camera
                          ? `Camera status unavailable: ${c.errors.camera}`
                          : "No current frame from the rover camera is available."}
            </p>
          </div>
        )}
        {fullscreen && (
          <div
            className="fullscreen-ops"
            role="group"
            aria-label="Camera fullscreen safety controls"
          >
            <div className="fullscreen-ops-status">
              <span className={`status-pill ${c.connection}`}>
                Backend {c.connection === "connected" ? "online" : c.connection}
              </span>
              <span className="fullscreen-mission-state">
                Mission: {c.currentMission?.state || "Not reported"}
              </span>
              <span className="fullscreen-safety-copy">
                {c.heldByBackend
                  ? "Backend reports an active hold; no duplicate stop will be sent."
                  : !c.physicalLinkReported
                    ? "Physical rover link not verified."
                    : "Use Stop Rover only if required; controller interlocks remain authoritative."}
              </span>
            </div>
            <button
              className="stop-button fullscreen-stop"
              disabled={!c.canStop || c.commandState.busy}
              onClick={() => c.runCommand("stop")}
              aria-label="Stop rover"
            >
              <AlertOctagon size={16} />
              {c.commandState.busy
                ? "SENDING…"
                : c.canStop
                  ? "STOP ROVER"
                  : c.heldByBackend
                    ? "ALREADY HELD"
                    : "STOP UNAVAILABLE"}
            </button>
          </div>
        )}
        {fullscreen && (
          <button
            className="fullscreen-exit"
            onClick={enterFullscreen}
            aria-label="Exit camera fullscreen"
          >
            <X size={18} />
            Exit fullscreen
          </button>
        )}
        <div className="camera-overlay">
          <span>
            <i className={`status-dot ${frameAvailable ? "good" : "bad"}`} />
            {frameAvailable ? "LIVE FEED" : "NO LIVE FRAME"}
          </span>
          {frameAvailable && camera?.latest_frame_timestamp && (
            <time>{formatTime(camera.latest_frame_timestamp)}</time>
          )}
        </div>
      </div>
      {!compact && (
        <div className="camera-meta">
          <span>
            Frame rate{" "}
            <b>
              {camera?.actual_fps == null
                ? "Not reported"
                : `${camera.actual_fps} FPS`}
            </b>
          </span>
          <span>
            Dimensions{" "}
            <b>
              {camera?.frame_dimensions
                ? `${camera.frame_dimensions.width} × ${camera.frame_dimensions.height}`
                : "Not reported"}
            </b>
          </span>
          <span>
            Freshness{" "}
            <b>
              {camera?.stale == null
                ? "Not reported"
                : camera.stale
                  ? "Stale"
                  : "Current"}
            </b>
          </span>
        </div>
      )}
      <div className="button-row camera-actions">
        <div className="segmented-control">
          <button className="selected" type="button">
            Raw
          </button>
          <button
            type="button"
            disabled
            title="The supplied backend returns an unannotated frame from this route."
          >
            Annotated unavailable
          </button>
        </div>
        <button className="button secondary" onClick={retry}>
          <RefreshCw size={15} />
          Reconnect
        </button>
        <button className="button secondary" onClick={enterFullscreen}>
          <Maximize size={15} />
          Fullscreen
        </button>
        <button
          className="button primary"
          disabled={!captureReady}
          onClick={c.capture}
        >
          <Camera size={15} />
          Capture evidence
        </button>
      </div>
      {fullscreenError && <p className="inline-error">{fullscreenError}</p>}
      {c.captureError && <p className="inline-error">{c.captureError}</p>}
    </Panel>
  );
}

function Overview({ c }) {
  const mission = c.currentMission;
  const cam = c.data.camera || c.data.system?.camera;
  const latestDetection = c.currentDetection || detectionHistory(c)[0];
  const obstacles = c.data.obstacles;
  const physical = verifiedPhysical(c);
  return (
    <div className="page-stack">
      <div className="page-intro">
        <div>
          <div className="eyebrow">LIVE OPERATIONS OVERVIEW</div>
          <h2>
            Good {greeting()}, {c.operatorName || "Operator"}
          </h2>
          <p>
            Situational awareness from the connected backend. Unknown values are
            intentionally left unfilled.
          </p>
        </div>
        <button
          className="button secondary"
          onClick={c.refresh}
          disabled={c.refreshing}
        >
          <RefreshCw size={15} />
          {c.refreshing ? "Refreshing…" : "Refresh all data"}
        </button>
      </div>
      <div className="summary-strip">
        <div className="summary-cell">
          <span>Backend</span>
          <b
            className={c.connection === "connected" ? "text-good" : "text-bad"}
          >
            {backendStatus(c)}
          </b>
          <small>
            {c.socketConnected ? "Socket connected" : "Socket not connected"}
          </small>
        </div>
        <div className="summary-cell">
          <span>Rover mode</span>
          <b>{roverModeLabel(c)}</b>
          <small>
            {physical
              ? "Physical connection is reported; test verification is false"
              : "No physical telemetry will be presented"}
          </small>
        </div>
        <div className="summary-cell">
          <span>Camera</span>
          <b className={`text-${cameraTone(c)}`}>{cameraStatusLabel(c)}</b>
          <small>
            {cam?.latest_frame_timestamp
              ? `Frame ${formatDate(cam.latest_frame_timestamp)}`
              : "No frame timestamp reported"}
          </small>
        </div>
        <div className="summary-cell">
          <span>Mission</span>
          <b>{missionState(c)}</b>
          <small>
            {mission?.operator_paused
              ? "Manual operator pause reported"
              : "Mission mode from backend"}
          </small>
        </div>
      </div>
      {!physical && (
        <div className="integrity-banner">
          <ShieldAlert size={18} />
          <div>
            <b>Physical rover data is not verified</b>
            <p>
              {c.capabilities?.simulated_rover
                ? "Backend is configured for simulated mode. Its synthetic rover values are withheld from this dashboard."
                : c.connection === "connected"
                  ? "Backend capability flags do not verify a connected physical rover. Movement controls are locked."
                  : "Backend is not currently reachable; telemetry and safety status cannot be verified."}
            </p>
          </div>
          <Badge tone="warn">INTEGRATION STATUS</Badge>
        </div>
      )}
      <div className="dashboard-grid">
        <div className="main-column">
          <CameraPanel c={c} compact />
          <Panel
            title="Current mission"
            subtitle="Authoritative mission state from the backend"
            action={
              <Badge
                tone={
                  mission?.state === "SCANNING"
                    ? "good"
                    : mission?.state === "SAFETY_STOP" ||
                        mission?.state === "EMERGENCY_STOP"
                      ? "bad"
                      : "neutral"
                }
              >
                {missionState(c)}
              </Badge>
            }
          >
            {mission ? (
              <>
                <div className="mission-state-card">
                  <div className="mission-state-icon">
                    <Command size={18} />
                  </div>
                  <div>
                    <b>{mission.state || "State not reported"}</b>
                    <span>
                      {mission.operator_paused
                        ? "Manual operator stop reported"
                        : mission.current_detection
                          ? "Person event requires operator review"
                          : "Mission objective not supplied by backend"}
                    </span>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => c.go("mission")}
                  >
                    Mission controls <ChevronRight size={15} />
                  </button>
                </div>
                <div className="detail-grid">
                  <DataRow
                    label="Mission ID"
                    value={mission.mission_id || mission.id || "Not reported"}
                  />
                  <DataRow
                    label="Objective"
                    value={mission.objective || "Not reported"}
                  />
                  <DataRow
                    label="Mission start time"
                    value={
                      mission.started_at
                        ? formatDate(mission.started_at)
                        : "Not reported"
                    }
                  />
                  <DataRow label="Safety state" value={safetySummary(c)} />
                </div>
              </>
            ) : (
              <Empty
                icon={Command}
                title={
                  c.physicalDataWithheld || c.missionStateWithheld
                    ? c.missionStateWithheld
                      ? visionWithheldTitle(c, "Person-detection mission state")
                      : withheldTitle(c, "Mission state")
                    : dataUnavailable(c, "mission")
                      ? "Mission status unavailable"
                      : "Mission status not reported"
                }
              >
                {c.physicalDataWithheld || c.missionStateWithheld
                  ? c.missionStateWithheld
                    ? visionWithheldMessage(c)
                    : withheldMessage(c)
                  : c.errors.mission ||
                    "No authoritative mission state has been received yet."}
              </Empty>
            )}
          </Panel>
          <div className="two-column">
            <Panel
              title="Latest detection"
              subtitle="Only events reported by the backend are shown"
            >
              {latestDetection ? (
                <DetectionSummary event={latestDetection} c={c} />
              ) : (
                <Empty
                  icon={ScanEye}
                  title={
                    c.physicalVisionWithheld
                      ? visionWithheldTitle(c, "Physical detections")
                      : c.errors.detections || c.errors.currentDetection
                        ? "Detection service unavailable"
                        : !c.data.detectionConfig?.weights_available
                          ? "Vision model unavailable"
                          : "No detection event received"
                  }
                >
                  {c.physicalVisionWithheld
                    ? visionWithheldMessage(c)
                    : c.errors.detections ||
                      c.data.detectionConfig?.error ||
                      "The detection service has not reported a current event."}
                </Empty>
              )}
            </Panel>
            <Panel
              title="Latest obstacle warning"
              subtitle="Vision warning is not a motor-stop signal"
            >
              {obstacles ? (
                <>
                  <div className="object-highlight">
                    <Badge
                      tone={
                        obstacles.status === "VERIFIED" ? "warn" : "neutral"
                      }
                    >
                      {obstacles.status || "Status not reported"}
                    </Badge>
                    <b>
                      {obstacles.object_class || "Object class not reported"}
                    </b>
                    <span>{formatConfidence(obstacles.confidence)}</span>
                  </div>
                  <DataRow
                    label="Warning"
                    value={obstacles.warning || "Not reported"}
                  />
                  <DataRow
                    label="Timestamp"
                    value={formatDate(obstacles.timestamp)}
                  />
                  <DataRow
                    label="Physical safety stop"
                    value="Not indicated by this visual warning"
                  />
                </>
              ) : (
                <Empty
                  icon={ShieldAlert}
                  title={
                    c.physicalVisionWithheld
                      ? visionWithheldTitle(c, "Obstacle values")
                      : c.errors.obstacles
                        ? "Obstacle data unavailable"
                        : "No obstacle warning received"
                  }
                >
                  {c.physicalVisionWithheld
                    ? visionWithheldMessage(c)
                    : c.errors.obstacles ||
                      "Obstacle events appear only when reported by the backend."}
                </Empty>
              )}
            </Panel>
          </div>
        </div>
        <aside className="side-column">
          <ControlCard c={c} compact />
          <Panel title="System components">
            <div className="component-list">
              <ComponentStatus
                label="Backend API"
                value={backendStatus(c)}
                tone={c.connection === "connected" ? "good" : "bad"}
              />
              <ComponentStatus
                label="Realtime socket"
                value={c.socketConnected ? "Connected" : "Disconnected"}
                tone={c.socketConnected ? "good" : "neutral"}
              />
              <ComponentStatus
                label="Camera feed"
                value={cameraStatusLabel(c)}
                tone={cameraTone(c)}
              />
              <ComponentStatus
                label="Vision model"
                value={
                  c.data.detectionConfig?.weights_available
                    ? "Weights available"
                    : c.data.detectionConfig?.error || "Unavailable"
                }
                tone={
                  c.data.detectionConfig?.weights_available ? "warn" : "bad"
                }
              />
              <ComponentStatus
                label="Physical safety state"
                value={safetySummary(c)}
                tone={physical && c.sensorsSafe ? "warn" : "neutral"}
              />
            </div>
            <button
              className="text-button full-width"
              onClick={() => c.go("robot")}
            >
              View robot diagnostics <ArrowUpRight size={14} />
            </button>
          </Panel>
          <Panel
            title="Recent backend activity"
            action={
              <button className="text-button" onClick={() => c.go("analysis")}>
                All events <ChevronRight size={14} />
              </button>
            }
          >
            <ActivityList
              events={allEvents(c).slice(0, 5)}
              errors={c.errors}
              physicalDataWithheld={c.physicalVisionWithheld}
            />
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
}
function ComponentStatus({ label, value, tone }) {
  return (
    <div className="component-status">
      <span>
        <i className={`status-dot ${tone}`} />
        {label}
      </span>
      <b title={value}>{value}</b>
    </div>
  );
}
function DetectionSummary({ event, c }) {
  return (
    <>
      <div
        className={`detection-banner ${isPerson(event) ? "person-detection" : ""}`}
      >
        <span className="detection-symbol">
          <ScanEye size={19} />
        </span>
        <div>
          <small>{isPerson(event) ? "PERSON DETECTED" : "OBJECT EVENT"}</small>
          <b>{event.object_class || "Class unavailable"}</b>
        </div>
        <Badge tone={event.acknowledged ? "good" : "warn"}>
          {event.acknowledged
            ? "Acknowledged"
            : event.status || "Unacknowledged"}
        </Badge>
      </div>
      <DataRow label="Confidence" value={formatConfidence(event.confidence)} />
      <DataRow label="Timestamp" value={formatDate(event.timestamp)} />
      <DataRow label="Event ID" value={event.event_id || "Not reported"} />
      <DataRow
        label="Mission state"
        value={event.mission_state || c.currentMission?.state || "Not reported"}
      />
      {isPerson(event) && (
        <DataRow
          label="Acknowledgement"
          value={
            event.acknowledged
              ? "Confirmed by backend"
              : "Operator acknowledgement required"
          }
        />
      )}
    </>
  );
}
function ActivityList({ events, errors, physicalDataWithheld = false }) {
  if (physicalDataWithheld)
    return (
      <Empty icon={Activity} title="Physical history withheld">
        Backend capability, connected physical-rover status, and physical-camera
        provenance have not all been confirmed, so event history is withheld.
      </Empty>
    );
  if (errors.missionHistory && errors.detections && errors.obstacleHistory)
    return (
      <Empty icon={Activity} title="Activity unavailable">
        Backend history endpoints could not be read.
      </Empty>
    );
  if (!events.length)
    return (
      <Empty icon={Activity} title="No history records returned">
        The backend has no retained records to display.
      </Empty>
    );
  return (
    <ol className="activity-list">
      {events.map((event, index) => (
        <li key={`${eventId(event)}-${index}`}>
          <span className="activity-marker" />
          <time>{formatTime(event.timestamp)}</time>
          <div>
            <b>{event.label}</b>
            <small>
              {event.source}
              {event.state ? ` · ${event.state}` : ""}
            </small>
          </div>
        </li>
      ))}
    </ol>
  );
}

function ControlCard({ c, compact = false }) {
  const mission = c.currentMission;
  const person = c.currentDetection && isPerson(c.currentDetection);
  const stopDisabled =
    !c.canStop ||
    !!mission?.operator_paused ||
    (mission?.state === "PERSON_DETECTED" && !!person);
  return (
    <Panel
      title="Rover controls"
      subtitle="Only documented backend commands are available"
      className="control-card"
    >
      <div className="control-safety">
        <ShieldAlert size={16} />
        <span>
          {!c.physicalLinkReported
            ? "Physical connection not verified"
            : c.physicalVisionWithheld
              ? "Physical camera source/freshness not verified; search movement remains locked"
              : !c.movementVerified
                ? "Start/resume safety checks not verified"
                : safetySummary(c)}
        </span>
      </div>
      <div className="control-buttons">
        <button
          className="button primary"
          disabled={!c.canStart || c.commandState.busy}
          onClick={() => c.runCommand("start")}
        >
          <Play size={15} />
          Start Search
        </button>
        <button
          className="button danger-outline"
          disabled={stopDisabled || c.commandState.busy}
          onClick={() => c.runCommand("stop")}
        >
          <Pause size={15} />
          Hold Here
        </button>
        <button
          className="button secondary"
          disabled={!c.canResume || c.commandState.busy}
          onClick={() => c.runCommand("resume")}
        >
          <RotateCcw size={15} />
          Resume Search
        </button>
        <button
          className="button disabled-control"
          disabled
          title="No backend route or firmware protocol is implemented"
        >
          Turn Around <span>Integration pending</span>
        </button>
        <button
          className="button disabled-control"
          disabled
          title="No backend route or firmware protocol is implemented"
        >
          Return to Base <span>Integration pending</span>
        </button>
      </div>
      {person && (
        <div className="person-action">
          <div className="person-action-head">
            <AlertOctagon size={17} />
            <b>Person event requires review</b>
          </div>
          <p>
            {formatConfidence(c.currentDetection.confidence)} ·{" "}
            {formatDate(c.currentDetection.timestamp)}
          </p>
          {c.currentDetection.acknowledged ? (
            <Badge tone="good">Event acknowledged</Badge>
          ) : (
            <button
              className="button warning"
              disabled={c.commandState.busy || !c.currentDetection.event_id}
              onClick={() => c.acknowledgeEvent(c.currentDetection.event_id)}
            >
              <Check size={15} />
              Acknowledge this event
            </button>
          )}
        </div>
      )}
      {c.commandState.message && (
        <p
          className={`command-feedback ${c.commandState.error ? "error" : ""}`}
          role="status"
        >
          {c.commandState.message}
        </p>
      )}
      <p className="safety-footnote">
        Hardware interlocks, cliff protection, obstacle protection, and
        controller watchdogs remain authoritative. Frontend controls cannot
        bypass them.
      </p>
    </Panel>
  );
}

function MissionControl({ c }) {
  const state = c.currentMission;
  const current = c.currentDetection;
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");
  useEffect(() => {
    const updateFullscreen = () =>
      setFullscreen(
        document.fullscreenElement?.classList.contains("main-shell") || false,
      );
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () =>
      document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);
  const toggleFocus = async () => {
    setFullscreenError("");
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        const shell = document.querySelector(".main-shell");
        if (!shell?.requestFullscreen)
          throw new Error("Fullscreen is not supported by this browser.");
        await shell.requestFullscreen();
      }
    } catch (error) {
      setFullscreenError(error.message || "Could not enter fullscreen mode.");
    }
  };
  return (
    <div className="page-stack">
      <PageIntro
        kicker="MISSION MANAGEMENT"
        title="Mission control"
        subtitle="Commands are routed only through the documented mission endpoints. No movement state is simulated."
        c={c}
        action={
          <button
            className="button secondary"
            type="button"
            onClick={toggleFocus}
            aria-label={
              fullscreen
                ? "Exit mission-control fullscreen"
                : "Enter mission-control fullscreen"
            }
            aria-pressed={fullscreen}
          >
            <Maximize size={14} />
            {fullscreen ? "Exit focus view" : "Focus mission view"}
          </button>
        }
      />
      {fullscreenError && <p className="inline-error">{fullscreenError}</p>}
      <div className="control-layout">
        <div className="main-column">
          <ControlCard c={c} />
          <Panel
            title="Current mission state"
            subtitle="Live state from GET /api/mission/status"
          >
            {state ? (
              <>
                <div className="large-state">
                  <span className="state-glyph">
                    <Command size={20} />
                  </span>
                  <div>
                    <b>{state.state || "Not reported"}</b>
                    <small>
                      {state.operator_paused
                        ? "Manual stop reported"
                        : current
                          ? "Detection event reported"
                          : "State received from backend"}
                    </small>
                  </div>
                  <Badge
                    tone={
                      state.state === "SCANNING"
                        ? "good"
                        : state.state === "SAFETY_STOP" ||
                            state.state === "EMERGENCY_STOP"
                          ? "bad"
                          : "neutral"
                    }
                  >
                    {state.state || "Unknown"}
                  </Badge>
                </div>
                <div className="detail-grid">
                  <DataRow
                    label="Mission ID"
                    value={state.mission_id || state.id || "Not reported"}
                  />
                  <DataRow
                    label="Objective"
                    value={state.objective || "Not reported"}
                  />
                  <DataRow
                    label="Started at"
                    value={
                      state.started_at
                        ? formatDate(state.started_at)
                        : "Not reported"
                    }
                  />
                  <DataRow
                    label="Mission duration"
                    value="Not reported by backend"
                  />
                </div>
              </>
            ) : (
              <Empty
                icon={Command}
                title={
                  c.physicalDataWithheld
                    ? withheldTitle(c, "Mission state")
                    : c.missionStateWithheld
                      ? visionWithheldTitle(c, "Person-detection mission state")
                      : "Mission state unavailable"
                }
              >
                {c.physicalDataWithheld || c.missionStateWithheld
                  ? c.missionStateWithheld
                    ? visionWithheldMessage(c)
                    : withheldMessage(c)
                  : c.errors.mission ||
                    "Waiting for an authoritative mission response."}
              </Empty>
            )}
          </Panel>
          <Panel
            title="Current person event"
            subtitle="Acknowledgement is bound to the exact active event ID"
          >
            {current ? (
              <>
                <DetectionSummary event={current} c={c} />
                {!current.acknowledged && (
                  <div className="inline-callout warning">
                    <ShieldAlert size={16} />
                    <span>
                      Inspect the actual camera evidence before acknowledging.
                      Resume remains a separate explicit command and is
                      safety-gated.
                    </span>
                  </div>
                )}
                {current.acknowledged && (
                  <div className="inline-callout good">
                    <ShieldCheck size={16} />
                    <span>
                      Backend reports this event acknowledged. Search will not
                      resume automatically.
                    </span>
                  </div>
                )}
              </>
            ) : (
              <Empty
                icon={ScanEye}
                title={
                  c.physicalVisionWithheld
                    ? visionWithheldTitle(c, "Person events")
                    : c.errors.currentDetection
                      ? "Current detection unavailable"
                      : "No active person event"
                }
              >
                {c.physicalVisionWithheld
                  ? visionWithheldMessage(c)
                  : c.errors.currentDetection ||
                    "The backend has not reported an active person detection."}
              </Empty>
            )}
          </Panel>
        </div>
        <aside className="side-column">
          <Panel title="Safety interlocks">
            <div className="component-list">
              <ComponentStatus
                label="Rover link"
                value={
                  c.physicalLinkReported
                    ? "Physical link reported"
                    : "Not verified"
                }
                tone={c.physicalLinkReported ? "warn" : "neutral"}
              />
              <ComponentStatus
                label="Obstacle sensor"
                value={
                  c.physicalLinkReported
                    ? c.rover?.obstacle_sensor || "Not reported"
                    : "Not verified"
                }
                tone="neutral"
              />
              <ComponentStatus
                label="Cliff sensor"
                value={
                  c.physicalLinkReported
                    ? c.rover?.cliff_sensor || "Not reported"
                    : "Not verified"
                }
                tone="neutral"
              />
              <ComponentStatus
                label="Active faults"
                value={
                  c.physicalLinkReported &&
                  Array.isArray(c.rover?.active_safety_faults)
                    ? String(c.rover.active_safety_faults.length)
                    : "Not reported"
                }
                tone="neutral"
              />
              <ComponentStatus
                label="Hardware tested"
                value={
                  c.capabilities?.hardware_tested === true
                    ? "Yes"
                    : c.capabilities?.hardware_tested === false
                      ? "No"
                      : "Not reported"
                }
                tone="warn"
              />
            </div>
            <p className="muted-copy">
              {safetySummary(c)}. Start and resume remain unavailable unless all
              checks and backend hardware verification pass.
            </p>
          </Panel>
          <Panel title="Command support">
            <DataRow label="START" value="POST /api/mission/start" />
            <DataRow label="STOP" value="POST /api/mission/stop" />
            <DataRow label="RESUME" value="POST /api/mission/resume" />
            <DataRow label="TURN_AROUND" value="Integration pending" />
            <DataRow label="RETURN_TO_BASE" value="Integration pending" />
          </Panel>
          <Panel
            title="State timeline"
            action={
              <button className="text-button" onClick={() => c.go("analysis")}>
                Open analysis <ChevronRight size={14} />
              </button>
            }
          >
            <ActivityList
              events={allEvents(c).slice(0, 8)}
              errors={c.errors}
              physicalDataWithheld={c.physicalVisionWithheld}
            />
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function LiveCamera({ c }) {
  return (
    <div className="page-stack">
      <PageIntro
        kicker="LIVE CAMERA"
        title="Rover camera"
        subtitle="Actual backend MJPEG streams only. No demo image, laptop webcam, or video fallback is used."
        c={c}
      />
      <CameraPanel c={c} />
      <Panel
        title="Camera connection details"
        subtitle="Reported by /api/camera/status"
      >
        <div className="detail-grid">
          <DataRow
            label="Configured"
            value={
              c.data.camera?.configured == null
                ? "Not reported"
                : c.data.camera.configured
                  ? "Yes"
                  : "No"
            }
          />
          <DataRow
            label="Connected"
            value={
              c.data.camera?.connected == null
                ? "Not reported"
                : c.data.camera.connected
                  ? "Yes"
                  : "No"
            }
          />
          <DataRow
            label="Streaming"
            value={
              c.data.camera?.streaming == null
                ? "Not reported"
                : c.data.camera.streaming
                  ? "Yes"
                  : "No"
            }
          />
          <DataRow
            label="Latest frame"
            value={formatDate(c.data.camera?.latest_frame_timestamp)}
          />
          <DataRow
            label="Backend camera error"
            value={c.data.camera?.error || "None reported"}
          />
          <DataRow
            label="Configuration"
            value="CAMERA_STREAM_URL must point to the actual rover camera stream"
          />
        </div>
      </Panel>
    </div>
  );
}

function MissionAnalysis({ c }) {
  const events = allEvents(c);
  const records = [
    ...missionHistory(c),
    ...detectionHistory(c),
    ...obstacleHistory(c),
  ];
  const available =
    !c.errors.missionHistory ||
    !c.errors.detections ||
    !c.errors.obstacleHistory;
  const typeCounts = new Map();
  for (const event of missionHistory(c)) {
    const kind = event.event_type || "Unknown";
    typeCounts.set(kind, (typeCounts.get(kind) || 0) + 1);
  }
  const exportReport = () =>
    downloadText(
      "dristigati-mission-report.json",
      JSON.stringify(
        {
          exported_at: new Date().toISOString(),
          mission_status: c.currentMission,
          history: {
            mission: missionHistory(c),
            detections: detectionHistory(c),
            obstacles: obstacleHistory(c),
          },
          note: "Report contains only records returned by the supplied backend; it is not a rescue outcome report.",
        },
        null,
        2,
      ),
      "application/json",
    );
  return (
    <div className="page-stack">
      <PageIntro
        kicker="MISSION REVIEW"
        title="Mission analysis & reports"
        subtitle="Review only backend-recorded events. The current backend history is process-local and incomplete."
        c={c}
        action={
          <button
            className="button secondary"
            onClick={exportReport}
            disabled={!records.length}
          >
            <FileDown size={15} />
            Export report
          </button>
        }
      />
      <div className="summary-strip analysis-strip">
        <div className="summary-cell">
          <span>Mission state</span>
          <b>{missionState(c)}</b>
          <small>From authoritative status</small>
        </div>
        <div className="summary-cell">
          <span>Mission history records</span>
          <b>
            {c.data.missionHistory
              ? c.data.missionHistory.length
              : "Unavailable"}
          </b>
          <small>Actual returned records</small>
        </div>
        <div className="summary-cell">
          <span>Detection history</span>
          <b>{c.data.detections ? c.data.detections.length : "Unavailable"}</b>
          <small>Actual returned records</small>
        </div>
        <div className="summary-cell">
          <span>Obstacle warnings</span>
          <b>
            {c.data.obstacleHistory
              ? c.data.obstacleHistory.length
              : "Unavailable"}
          </b>
          <small>Actual returned records</small>
        </div>
      </div>
      <div className="two-column content-columns">
        <Panel
          title="Recorded mission state transitions"
          subtitle="Bars are counts of records received—not progress or success metrics"
        >
          {typeCounts.size ? (
            <div className="chart-list">
              {[...typeCounts.entries()].map(([label, count]) => (
                <div className="chart-row" key={label}>
                  <span>{readable(label)}</span>
                  <div>
                    <i
                      style={{
                        width: `${Math.max(6, (count / Math.max(...typeCounts.values())) * 100)}%`,
                      }}
                    />
                  </div>
                  <b>{count}</b>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              icon={Activity}
              title={
                c.physicalVisionWithheld
                  ? visionWithheldTitle(c, "Mission history")
                  : c.errors.missionHistory
                    ? "Mission history unavailable"
                    : "No mission history records"
              }
            >
              {c.physicalVisionWithheld
                ? visionWithheldMessage(c)
                : c.errors.missionHistory ||
                  "No transition counts or charts are fabricated."}
            </Empty>
          )}
          <p className="muted-copy">
            The backend records only some transitions: manual stop and person
            detection. Start/resume timestamps, mission IDs, durations, and
            rescue outcomes are not currently supplied.
          </p>
        </Panel>
        <Panel
          title="Event timeline"
          action={<Badge>{events.length} records</Badge>}
        >
          <ActivityList
            events={events}
            errors={c.errors}
            physicalDataWithheld={c.physicalVisionWithheld}
          />
        </Panel>
      </div>
      <Panel title="Review limitations">
        <div className="two-column">
          <div>
            <SectionLabel>Not available from this backend</SectionLabel>
            <ul className="plain-list">
              <li>
                Mission IDs, objectives, start/end timestamps, and duration
              </li>
              <li>Stable persistent event storage across process restarts</li>
              <li>
                Complete mission state transitions or confirmed rescue outcomes
              </li>
              <li>Position, route, distance, and sensor stop history</li>
            </ul>
          </div>
          <div>
            <SectionLabel>Interpretation</SectionLabel>
            <p className="muted-copy">
              A vision detection is not a confirmed rescue outcome. A visual
              obstacle warning is not a physical safety stop. Manual operator
              stop, person event, and independent hardware interlocks must be
              reviewed separately.
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function SavedScreenshots({ c }) {
  const [active, setActive] = useState(null);
  const [query, setQuery] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const items = c.evidence.filter((item) =>
    `${item.title} ${item.notes} ${item.objectClass} ${item.eventId}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const activeUrl = useBlobUrl(active?.blob);
  useEffect(() => {
    if (!c.openEvidenceId) return;
    const item = c.evidence.find((record) => record.id === c.openEvidenceId);
    if (item) setActive(item);
    c.clearEvidenceOpen();
  }, [c.openEvidenceId, c.evidence, c.clearEvidenceOpen]);
  const remove = async () => {
    if (!confirmDelete) return;
    const ok = await c.removeScreenshot(confirmDelete.id);
    if (ok) {
      if (active?.id === confirmDelete.id) setActive(null);
      setConfirmDelete(null);
    }
  };
  return (
    <div className="page-stack">
      <PageIntro
        kicker="LOCAL EVIDENCE"
        title="Saved screenshots"
        subtitle="Images captured from the actual backend camera snapshot endpoint and saved in this browser's IndexedDB."
        c={c}
      />
      <div className="filter-row">
        <label className="search-box">
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, notes, class, event ID"
          />
        </label>
        <span className="muted-copy">{c.evidence.length} saved locally</span>
      </div>
      {items.length ? (
        <div className="evidence-grid">
          {items.map((item) => (
            <EvidenceCard
              key={item.id}
              item={item}
              onOpen={() => setActive(item)}
            />
          ))}
        </div>
      ) : (
        <Panel title="Evidence library">
          <Empty
            icon={Image}
            title={
              c.evidence.length
                ? "No matching screenshots"
                : "No saved screenshots"
            }
          >
            {c.evidence.length
              ? "Try another search term."
              : "Capture evidence from an available live rover camera. Placeholder images are never saved."}
          </Empty>
        </Panel>
      )}
      {active && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal-card image-viewer"
            role="dialog"
            aria-modal="true"
            aria-label={active.title}
          >
            <header className="modal-header">
              <div>
                <span className="eyebrow">BROWSER-LOCAL EVIDENCE</span>
                <h2>{active.title}</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close viewer"
                onClick={() => setActive(null)}
              >
                <X size={18} />
              </button>
            </header>
            {activeUrl && (
              <img
                className="viewer-image"
                src={activeUrl}
                alt={active.title}
              />
            )}
            <div className="detail-grid">
              <DataRow label="Captured" value={formatDate(active.capturedAt)} />
              <DataRow
                label="Mission"
                value={
                  active.missionId || active.missionState || "Not reported"
                }
              />
              <DataRow
                label="Detection"
                value={active.objectClass || "Not associated"}
              />
              <DataRow
                label="Confidence"
                value={
                  active.confidence == null
                    ? "Not associated"
                    : formatConfidence(active.confidence)
                }
              />
              <DataRow
                label="Event ID"
                value={active.eventId || "Not associated"}
              />
            </div>
            {active.notes && <p className="muted-copy">{active.notes}</p>}
            <div className="modal-actions">
              <a
                className="button secondary"
                href={activeUrl}
                download={`${safeFilename(active.title)}.jpg`}
              >
                <Download size={15} />
                Download
              </a>
              <button
                className="button danger-outline"
                onClick={() => setConfirmDelete(active)}
              >
                <Trash2 size={15} />
                Delete
              </button>
              <button
                className="button primary"
                onClick={() => setActive(null)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDelete && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal-card confirm-modal"
            role="alertdialog"
            aria-modal="true"
          >
            <h2>Delete this screenshot?</h2>
            <p>
              This permanently removes the image and metadata from this browser.
              No server copy exists.
            </p>
            <div className="modal-actions">
              <button
                className="button secondary"
                onClick={() => setConfirmDelete(null)}
              >
                Cancel
              </button>
              <button className="button danger" onClick={remove}>
                Delete locally
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function EvidenceCard({ item, onOpen }) {
  const url = useBlobUrl(item.blob);
  return (
    <button className="evidence-card" onClick={onOpen}>
      <div className="evidence-thumb">
        {url ? (
          <img src={url} alt="" />
        ) : (
          <span>
            <Image size={20} />
          </span>
        )}
        <small>
          <ExternalLink size={12} />
          Open
        </small>
      </div>
      <div className="evidence-card-body">
        <b>{item.title}</b>
        <span>{formatDate(item.capturedAt)}</span>
        <small>
          {item.objectClass
            ? `${item.objectClass} · ${formatConfidence(item.confidence)}`
            : "No detection association"}
        </small>
      </div>
    </button>
  );
}

function RobotInformation({ c }) {
  const r = c.rover;
  const cam = c.data.camera || c.data.system?.camera;
  const cap = c.capabilities;
  return (
    <div className="page-stack">
      <PageIntro
        kicker="ROBOT DIAGNOSTICS"
        title="Robot information"
        subtitle="Backend-reported configuration and connection state; hardware details remain unverified until confirmed by the controller."
        c={c}
      />
      <div className="robot-hero">
        <div className="robot-emblem">
          <Command size={22} />
        </div>
        <div>
          <span className="eyebrow">ROBOT PLATFORM</span>
          <h2>DristiGati</h2>
          <p>Vision-based autonomous search and rescue rover</p>
        </div>
        <Badge tone={c.physicalLinkReported ? "warn" : "neutral"}>
          {roverModeLabel(c)}
        </Badge>
      </div>
      <Panel
        title="Developer-reported hardware details"
        subtitle="Reported by the hardware developer; not independently verified by the backend or a physical connection."
      >
        <div className="detail-grid">
          <DataRow label="Wi-Fi SSID" value="RescueRover-Control" />
          <DataRow
            label="Rover web interface"
            value={
              <a href="http://192.168.4.1" target="_blank" rel="noreferrer">
                http://192.168.4.1
              </a>
            }
          />
          <DataRow
            label="Reported firmware controls"
            value="STOP ROVER · RESUME SEARCH"
          />
          <DataRow
            label="Front obstacle stop"
            value="Reported by developer; controller status not verified"
          />
          <DataRow
            label="Cliff stop threshold"
            value="15 cm, reported by developer; sensor test not verified"
          />
        </div>
        <p className="muted-copy">
          Connecting a laptop to the rover's Wi-Fi may interrupt normal Internet
          access. The dashboard does not store or expose a Wi-Fi password and
          does not connect directly to this interface.
        </p>
      </Panel>
      <div className="two-column content-columns">
        <Panel title="Backend capabilities">
          <DataRow
            label="Rover mode"
            value={
              cap?.simulated_rover == null
                ? "Not reported"
                : cap.simulated_rover
                  ? "SIMULATED (values withheld)"
                  : "Physical mode configured"
            }
          />
          <DataRow
            label="Physical hardware tested"
            value={
              cap?.hardware_tested == null
                ? "Not reported"
                : cap.hardware_tested
                  ? "Yes"
                  : "No"
            }
          />
          <DataRow
            label="Camera configured"
            value={
              cap?.camera_configured == null
                ? "Not reported"
                : cap.camera_configured
                  ? "Yes"
                  : "No"
            }
          />
          <DataRow
            label="YOLO available"
            value={
              cap?.yolo_available == null
                ? "Not reported"
                : cap.yolo_available
                  ? "Available flag only"
                  : "Unavailable"
            }
          />
          <DataRow label="Controller/firmware version" value="Not reported" />
          <DataRow label="Robot ID" value="Not reported" />
        </Panel>
        <Panel title="Rover status fields">
          <DataRow
            label="Mode"
            value={
              c.physicalLinkReported
                ? r?.mode || "Not reported"
                : "Physical data not verified"
            }
          />
          <DataRow
            label="Connection"
            value={
              c.physicalLinkReported
                ? r?.connected == null
                  ? "Not reported"
                  : r.connected
                    ? "Connected (backend report)"
                    : "Disconnected"
                : "Not verified"
            }
          />
          <DataRow
            label="Motor state"
            value={
              c.physicalLinkReported
                ? r?.motor_state || "Not reported"
                : "Withheld: not verified physical data"
            }
          />
          <DataRow
            label="Last heartbeat"
            value={
              c.physicalLinkReported
                ? formatDate(r?.last_heartbeat)
                : "Not verified"
            }
          />
          <DataRow
            label="Confirmed controller state"
            value={
              c.physicalLinkReported
                ? r?.last_confirmed_controller_state || "Not reported"
                : "Not verified"
            }
          />
          <DataRow
            label="Active safety faults"
            value={
              c.physicalLinkReported && Array.isArray(r?.active_safety_faults)
                ? r.active_safety_faults.length
                  ? r.active_safety_faults.join(", ")
                  : "None reported"
                : "Not verified"
            }
          />
        </Panel>
        <Panel title="Sensors & safety">
          <DataRow
            label="Obstacle sensor"
            value={
              c.physicalLinkReported
                ? r?.obstacle_sensor || "Not reported"
                : "Physical data not verified"
            }
          />
          <DataRow
            label="Cliff sensor"
            value={
              c.physicalLinkReported
                ? r?.cliff_sensor || "Not reported"
                : "Physical data not verified"
            }
          />
          <DataRow
            label="Independent hardware stop"
            value="Not reported by dashboard API"
          />
          <DataRow
            label="Controller watchdog"
            value="Required by integration contract; not verified"
          />
          <DataRow
            label="Battery, speed, temperature, signal"
            value="Not reported"
          />
          <p className="muted-copy">
            Frontend does not change, bypass, or disable any physical sensor or
            controller safety mechanism.
          </p>
        </Panel>
        <Panel title="Camera & processing">
          <DataRow label="Camera connection" value={cameraStatusLabel(c)} />
          <DataRow
            label="Camera dimensions"
            value={
              cam?.frame_dimensions
                ? `${cam.frame_dimensions.width} × ${cam.frame_dimensions.height}`
                : "Not reported"
            }
          />
          <DataRow
            label="Camera stream URL"
            value="Not exposed to frontend; configure on backend"
          />
          <DataRow
            label="Vision model"
            value={c.data.detectionConfig?.model || "Not reported"}
          />
          <DataRow
            label="Detection weights"
            value={
              c.data.detectionConfig?.weights_available == null
                ? "Not reported"
                : c.data.detectionConfig.weights_available
                  ? "Present (inference not verified)"
                  : "Unavailable"
            }
          />
        </Panel>
      </div>
      <div className="inline-callout warning">
        <ShieldAlert size={16} />
        <span>
          The supplied README says the backend has not been tested against
          physical hardware. No firmware version, battery, speed, coordinates,
          or motor details are invented here.
        </span>
      </div>
    </div>
  );
}

function Settings({ c }) {
  const [base, setBase] = useState(getStoredBase());
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [appearance, setAppearance] = useState(c.theme);
  const [density, setDensity] = useState(
    localStorage.getItem("dristigati.density") || "comfortable",
  );
  useEffect(() => setAppearance(c.theme), [c.theme]);
  const testConnection = async () => {
    setBusy(true);
    setResult(null);
    try {
      const out = await api.health();
      setResult({
        ok: true,
        text: `${out.data?.service || "Backend"} responded · ${out.timestamp || "timestamp not reported"}`,
      });
      await c.refresh();
    } catch (e) {
      setResult({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };
  const saveBase = () => {
    try {
      const normalized = setApiBaseUrl(base);
      setBase(normalized);
      setSaved("API base URL saved. Reloading backend connections…");
      setError("");
      window.location.reload();
    } catch {
      setError(
        "Enter a valid http:// or https:// backend base URL without a trailing path.",
      );
      setSaved("");
    }
  };
  return (
    <div className="page-stack">
      <PageIntro
        kicker="PREFERENCES & DIAGNOSTICS"
        title="Settings"
        subtitle="Preferences are stored locally. Backend configuration is not changed by this dashboard."
        c={c}
      />
      <div className="settings-grid">
        <Panel title="Appearance">
          <div className="setting-row">
            <div>
              <b>Theme</b>
              <span>Choose a complete interface color theme.</span>
            </div>
            <select
              value={appearance}
              onChange={(e) => {
                setAppearance(e.target.value);
                c.setTheme(e.target.value);
              }}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System preference</option>
            </select>
          </div>
          <div className="setting-row">
            <div>
              <b>Dashboard density</b>
              <span>Spacing preference for operational panels.</span>
            </div>
            <select
              value={density}
              onChange={(e) => {
                setDensity(e.target.value);
                localStorage.setItem("dristigati.density", e.target.value);
                document.documentElement.dataset.density = e.target.value;
              }}
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </div>
          <div className="setting-row">
            <div>
              <b>Reduced motion</b>
              <span>Reduce nonessential transitions.</span>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={c.reducedMotion}
                onChange={(e) => c.setReducedMotion(e.target.checked)}
              />
              <span />
            </label>
          </div>
        </Panel>
        <Panel
          title="Backend connection"
          subtitle="Configure the REST and Socket.IO origin"
        >
          <label className="field-label">
            API base URL
            <input
              value={base}
              onChange={(e) => setBase(e.target.value)}
              placeholder="http://127.0.0.1:5000"
              spellCheck="false"
            />
          </label>
          <p className="muted-copy">
            Default: VITE_API_BASE_URL or http://127.0.0.1:5000. No credentials
            should be embedded in this value.
          </p>
          <div className="button-row">
            <button className="button primary" onClick={saveBase}>
              Save URL & reconnect
            </button>
            <button
              className="button secondary"
              onClick={testConnection}
              disabled={busy}
            >
              <RefreshCw size={15} />
              {busy ? "Testing…" : "Test health"}
            </button>
          </div>
          {saved && <p className="success-copy">{saved}</p>}
          {error && <p className="inline-error">{error}</p>}
          {result && (
            <div className={`inline-callout ${result.ok ? "good" : "warning"}`}>
              <span>{result.text}</span>
            </div>
          )}
          <div className="connection-card">
            <DataRow label="Backend" value={backendStatus(c)} />
            <DataRow
              label="Socket.IO"
              value={c.socketConnected ? "Connected" : "Disconnected"}
            />
            <DataRow
              label="Last status success"
              value={c.lastSuccess ? formatDate(c.lastSuccess) : "Never"}
            />
            <DataRow label="Current rover mode" value={roverModeLabel(c)} />
            <DataRow label="Camera status" value={cameraStatusLabel(c)} />
          </div>
        </Panel>
        <Panel
          title="Detection configuration"
          subtitle="Read-only: POST route does not apply runtime changes"
        >
          <DataRow
            label="Model"
            value={c.data.detectionConfig?.model || "Not reported"}
          />
          <DataRow
            label="Confidence threshold"
            value={
              c.data.detectionConfig?.confidence == null
                ? "Not reported"
                : formatConfidence(c.data.detectionConfig.confidence)
            }
          />
          <DataRow
            label="Image size"
            value={c.data.detectionConfig?.image_size ?? "Not reported"}
          />
          <DataRow
            label="Runtime config writes"
            value="Not supported by supplied implementation"
          />
          <p className="muted-copy">
            Model path changes require a backend restart. This settings screen
            makes no detection/obstacle POST requests because the supplied
            handlers do not apply configuration.
          </p>
        </Panel>
        <Panel title="Safety diagnostics">
          <DataRow
            label="Physical link"
            value={
              c.physicalLinkReported
                ? "Reported by backend; hardware unverified"
                : "Not verified"
            }
          />
          <DataRow
            label="Movement controls"
            value={
              c.movementVerified
                ? "Safety checks reported, pending backend response"
                : "Locked · hardware test/safety check unavailable"
            }
          />
          <DataRow label="Safety state" value={safetySummary(c)} />
          <DataRow
            label="Active faults"
            value={
              c.physicalLinkReported &&
              Array.isArray(c.rover?.active_safety_faults)
                ? c.rover.active_safety_faults.join(", ") || "None reported"
                : "Not verified"
            }
          />
          <DataRow
            label="Command timeouts"
            value={
              c.commandState.error
                ? c.commandState.message
                : "None recorded in this session"
            }
          />
        </Panel>
        <Panel title="Local browser data">
          <p className="muted-copy">
            Screenshots are stored in IndexedDB on this browser. Appearance, API
            URL, and operator label are browser-local. Action and safety
            messages appear briefly and are not saved as a notification history.
            None are uploaded or shared between devices.
          </p>
          <DataRow
            label="Saved screenshots"
            value={String(c.evidence.length)}
          />
        </Panel>
      </div>
    </div>
  );
}
function getStoredBase() {
  try {
    return (
      localStorage.getItem("dristigati.apiBaseUrl") ||
      import.meta.env.VITE_API_BASE_URL ||
      "http://127.0.0.1:5000"
    );
  } catch {
    return "http://127.0.0.1:5000";
  }
}

function PageIntro({ kicker, title, subtitle, c, action }) {
  return (
    <div className="page-intro">
      <div>
        <div className="eyebrow">{kicker}</div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <div className="page-intro-actions">
        {action}
        <button
          className="button secondary"
          onClick={c.refresh}
          disabled={c.refreshing}
        >
          <RefreshCw size={14} />
          {c.refreshing ? "Refreshing" : "Refresh"}
        </button>
      </div>
    </div>
  );
}

function downloadText(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
function csv(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}
function safeFilename(value) {
  return (
    String(value || "dristigati-evidence")
      .replace(/[^a-z0-9-_]+/gi, "-")
      .replace(/-+/g, "-")
      .slice(0, 80) || "dristigati-evidence"
  );
}

export const Views = {
  overview: Overview,
  mission: MissionControl,
  camera: LiveCamera,
  analysis: MissionAnalysis,
  screenshots: SavedScreenshots,
  robot: RobotInformation,
  settings: Settings,
};
