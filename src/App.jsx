import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertOctagon,
  Bot,
  Camera,
  ChevronDown,
  CircleHelp,
  Command,
  Gauge,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { api, getApiBaseUrl, setApiBaseUrl } from "./api.js";
import { deleteEvidence, listEvidence, saveEvidence } from "./evidence.js";
import { useBackend } from "./useBackend.js";
import {
  formatDate,
  formatConfidence,
  eventId,
  isEventTime,
  isPhysicalCameraVerified,
  isPhysicalRoverVerified,
  readable,
} from "./utils.js";
import { Views } from "./views.jsx";

const NAV = [
  ["overview", "Overview", LayoutDashboard],
  ["mission", "Mission Control", Command],
  ["camera", "Live Camera", Camera],
  ["analysis", "Mission Analysis", Activity],
  ["screenshots", "Saved Screenshots", Camera],
  ["robot", "Robot Information", Bot],
  ["settings", "Settings", Settings],
];
const OPERATOR_KEY = "dristigati.operator.v1";
const themeInit = () => localStorage.getItem("dristigati.theme") || "dark";
const operatorInit = () => {
  try {
    return JSON.parse(
      localStorage.getItem(OPERATOR_KEY) ||
        sessionStorage.getItem(OPERATOR_KEY) ||
        "null",
    );
  } catch {
    return null;
  }
};
const verifiedSafety = (rover) => {
  if (!rover) return null;
  const faults = Array.isArray(rover.active_safety_faults)
    ? rover.active_safety_faults.join("|")
    : "faults-unknown";
  return `${rover.obstacle_sensor || "obstacle-unknown"}|${rover.cliff_sensor || "cliff-unknown"}|${faults}`;
};

function App() {
  const [theme, setTheme] = useState(themeInit);
  const [operator, setOperator] = useState(operatorInit);
  const [view, setView] = useState(() => {
    const initial = location.hash.slice(1);
    return NAV.some(([id]) => id === initial) ? initial : "overview";
  });
  const [mobileNav, setMobileNav] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [evidence, setEvidence] = useState([]);
  const [captureDraft, setCaptureDraft] = useState(null);
  const [openEvidenceId, setOpenEvidenceId] = useState(null);
  const [captureError, setCaptureError] = useState("");
  const [commandState, setCommandState] = useState({
    busy: false,
    message: "",
    error: false,
  });
  const [toast, setToast] = useState(null);
  const [reducedMotion, setReducedMotion] = useState(
    () => localStorage.getItem("dristigati.reducedMotion") === "true",
  );
  const previousSignals = useRef(null);
  const physicalTelemetryRef = useRef(false);
  const physicalVisionRef = useRef(false);

  const showToast = useCallback((item) => {
    setToast(item);
    window.setTimeout(() => setToast(null), 5200);
  }, []);

  const onLiveEvent = useCallback(
    (name, payload) => {
      if (!physicalTelemetryRef.current) return;
      if (
        [
          "person_detected",
          "person_event_acknowledged",
          "person_cooldown_started",
          "obstacle_candidate",
          "obstacle_warning_verified",
        ].includes(name) &&
        !physicalVisionRef.current
      )
        return;
      if (name === "mission_state_changed") return;
      const id = payload?.event_id || payload?.timestamp || crypto.randomUUID();
      const severity =
        name === "person_detected" || name === "obstacle_warning_verified"
          ? "critical"
          : name === "obstacle_candidate"
            ? "warning"
            : "info";
      const title =
        {
          person_detected: "Person detected",
          person_event_acknowledged: "Detection acknowledged",
          person_cooldown_started: "Detection cooldown started",
          obstacle_candidate: "Obstacle candidate",
          obstacle_warning_verified: "Obstacle warning verified",
        }[name] || readable(name);
      showToast({
        key: `${name}:${id}`,
        title,
        body: `${payload?.object_class ? `${payload.object_class} · ` : ""}${payload?.confidence != null ? `${formatConfidence(payload.confidence)} · ` : ""}${payload?.warning || payload?.verification_reason || ""}`.trim(),
        severity,
        source: "backend event",
        eventId: payload?.event_id || null,
        payload,
      });
    },
    [showToast],
  );

  const backend = useBackend(onLiveEvent);
  const { data, refresh, reconcile } = backend;
  const capabilities = data.capabilities || null;
  const simulationActive = capabilities?.simulated_rover === true;
  const reportedRover =
    data.rover || data.system?.rover || data.mission?.rover || null;
  const physicalDataVerified = isPhysicalRoverVerified(
    capabilities,
    reportedRover,
    { connection: backend.connection, errors: backend.errors },
  );
  const rawMission = data.mission || data.system?.mission || null;
  const rawCamera = data.camera || data.system?.camera || null;
  const physicalVisionVerified = isPhysicalCameraVerified(
    rawCamera,
    physicalDataVerified,
    !!backend.errors.camera,
  );
  physicalTelemetryRef.current = physicalDataVerified;
  physicalVisionRef.current = physicalVisionVerified;

  useEffect(() => {
    if (!backend.lastSuccess) return;
    const camera = rawCamera;
    const rover = reportedRover;
    const physicalSource = physicalDataVerified;
    const signals = {
      connection: backend.connection,
      camera:
        physicalVisionVerified && camera?.configured
          ? camera.connected && !camera.stale
            ? "connected"
            : "disconnected"
          : "not-verified",
      rover:
        capabilities?.simulated_rover === true
          ? "simulated"
          : rover?.mode === "PHYSICAL"
            ? rover.connected
              ? "connected"
              : "disconnected"
            : "unknown",
      mission:
        physicalSource &&
        (rawMission?.state !== "PERSON_DETECTED" || physicalVisionVerified)
          ? rawMission?.state || null
          : null,
      safety: physicalSource ? verifiedSafety(rover) : null,
      model:
        (data.detectionConfig || data.system?.detection)?.weights_available ==
        null
          ? null
          : (data.detectionConfig || data.system?.detection).weights_available
            ? "available"
            : "unavailable",
    };
    const previous = previousSignals.current;
    if (previous) {
      if (
        previous.connection === "connected" &&
        signals.connection === "disconnected"
      )
        showToast({
          key: `backend-down:${Date.now()}`,
          title: "Backend disconnected",
          body: "REST status requests are failing; retained values may be stale.",
          severity: "critical",
          source: "connection status",
        });
      if (
        previous.connection === "disconnected" &&
        signals.connection === "connected"
      )
        showToast({
          key: `backend-up:${Date.now()}`,
          title: "Backend reconnected",
          body: "Backend is reachable again; status was reconciled.",
          severity: "info",
          source: "connection status",
        });
      if (previous.camera === "connected" && signals.camera === "disconnected")
        showToast({
          key: `camera-down:${Date.now()}`,
          title: "Camera disconnected or stale",
          body: "Backend no longer reports a current rover camera frame.",
          severity: "warning",
          source: "camera status",
        });
      if (previous.rover === "connected" && signals.rover === "disconnected")
        showToast({
          key: `rover-down:${Date.now()}`,
          title: "Physical rover disconnected",
          body: "The physical rover link is no longer reported as connected.",
          severity: "critical",
          source: "rover status",
        });
      if (
        previous.mission &&
        signals.mission &&
        previous.mission !== signals.mission
      )
        showToast({
          key: `mission-state:${previous.mission}:${signals.mission}:${Date.now()}`,
          title: "Mission state changed",
          body: `${previous.mission} → ${signals.mission} (backend status)`,
          severity:
            signals.mission === "SAFETY_STOP" ||
            signals.mission === "EMERGENCY_STOP"
              ? "critical"
              : "info",
          source: "mission status",
        });
      if (signals.safety && previous.safety !== signals.safety)
        showToast({
          key: `safety:${signals.safety}:${Date.now()}`,
          title: "Rover safety status changed",
          body: signals.safety,
          severity: "critical",
          source: "rover status",
        });
      if (previous.model === "available" && signals.model === "unavailable")
        showToast({
          key: `model-down:${Date.now()}`,
          title: "Vision model unavailable",
          body: "Backend reports that model weights are unavailable.",
          severity: "warning",
          source: "detection config",
        });
    }
    previousSignals.current = signals;
  }, [
    showToast,
    backend.connection,
    backend.lastSuccess,
    capabilities?.simulated_rover,
    data.camera,
    data.detectionConfig,
    data.mission,
    data.rover,
    data.system,
    physicalDataVerified,
    physicalVisionVerified,
    previousSignals,
    rawCamera,
    rawMission,
    reportedRover,
  ]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("dristigati.theme", theme);
  }, [theme]);
  useEffect(() => {
    try {
      localStorage.removeItem("dristigati.notifications.v1");
    } catch {
      // Storage may be unavailable; notification history is no longer read.
    }
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("reduce-motion", reducedMotion);
    localStorage.setItem("dristigati.reducedMotion", String(reducedMotion));
  }, [reducedMotion]);
  useEffect(() => {
    let active = true;
    listEvidence()
      .then((items) => {
        if (active) setEvidence(items);
      })
      .catch(() => {
        if (active) setEvidence([]);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const onHash = () => {
      const next = location.hash.slice(1);
      if (NAV.some(([id]) => id === next)) setView(next);
      else {
        setView("overview");
        history.replaceState(null, "", location.pathname + location.search);
      }
    };
    window.addEventListener("hashchange", onHash);
    onHash();
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const activeTitle = NAV.find((item) => item[0] === view)?.[1] || "Overview";
  const missionStateWithheld =
    physicalDataVerified &&
    rawMission?.state === "PERSON_DETECTED" &&
    !physicalVisionVerified;
  const currentMission =
    physicalDataVerified && rawMission && !missionStateWithheld
      ? {
          ...rawMission,
          current_detection: physicalVisionVerified
            ? rawMission.current_detection || data.currentDetection || null
            : null,
        }
      : null;
  const currentDetection = physicalVisionVerified
    ? rawMission?.current_detection || data.currentDetection || null
    : null;
  const rover = physicalDataVerified ? reportedRover : null;
  const displayData = {
    ...data,
    mission: currentMission,
    camera: physicalDataVerified ? rawCamera : null,
    missionHistory: physicalVisionVerified ? data.missionHistory : null,
    detections: physicalVisionVerified ? data.detections : null,
    currentDetection,
    obstacles: physicalVisionVerified ? data.obstacles : null,
    obstacleHistory: physicalVisionVerified ? data.obstacleHistory : null,
    rover,
    system: data.system
      ? {
          ...data.system,
          mission: currentMission,
          camera: physicalDataVerified ? rawCamera : null,
          rover,
        }
      : null,
  };
  const physicalLinkReported = physicalDataVerified;
  const sensorsSafe =
    rover?.obstacle_sensor === "SAFE" &&
    rover?.cliff_sensor === "SAFE" &&
    Array.isArray(rover?.active_safety_faults) &&
    rover.active_safety_faults.length === 0;
  const movementVerified =
    physicalLinkReported &&
    physicalVisionVerified &&
    capabilities?.hardware_tested === true &&
    sensorsSafe &&
    backend.connection === "connected";
  const heldByBackend =
    physicalDataVerified &&
    (rawMission?.operator_paused === true ||
      (rawMission?.state === "PERSON_DETECTED" &&
        !!(rawMission.current_detection || data.currentDetection)) ||
      ["SAFETY_STOP", "EMERGENCY_STOP"].includes(rawMission?.state));
  const canStop =
    physicalLinkReported &&
    backend.connection === "connected" &&
    !commandState.busy &&
    !heldByBackend;
  const canStart =
    movementVerified && currentMission?.state === "IDLE" && !currentDetection;
  const canResume =
    movementVerified &&
    (!!currentDetection?.acknowledged ||
      currentMission?.operator_paused === true) &&
    currentMission?.state !== "SCANNING";

  const go = useCallback((id) => {
    if (!NAV.some((item) => item[0] === id)) return;
    if (
      id !== "mission" &&
      document.fullscreenElement?.classList.contains("main-shell")
    )
      document.exitFullscreen().catch(() => {});
    setView(id);
    location.hash = id;
    setMobileNav(false);
    setProfileOpen(false);
  }, []);

  const runCommand = useCallback(
    async (action) => {
      const allowed =
        action === "start"
          ? canStart
          : action === "stop"
            ? canStop
            : action === "resume"
              ? canResume
              : false;
      if (!allowed) {
        setCommandState({
          busy: false,
          message: `Command ${String(action).toUpperCase()} was not sent: unsupported action or current backend/safety state does not permit it.`,
          error: true,
        });
        return;
      }
      const method =
        action === "start"
          ? api.start
          : action === "stop"
            ? api.stop
            : api.resume;
      setCommandState({ busy: true, message: "", error: false });
      try {
        const result = await method();
        const reconciliation = await reconcile();
        const state = result.data?.state;
        const reported =
          result.data?.rover?.last_confirmed_controller_state ||
          result.data?.rover?.motor_state;
        const statusFailed = ["mission", "rover", "capabilities"].some(
          (key) => reconciliation?.errors?.[key],
        );
        const message = `Backend accepted ${action.toUpperCase()}${state ? ` · mission ${state}` : ""}${reported ? ` · controller reports ${reported}` : ""}. ${statusFailed ? "Follow-up status refresh incomplete; check the stale-data banner." : "Post-command status refreshed from backend."}`;
        setCommandState({ busy: false, message, error: false });
        showToast({
          key: `operator:${action}:${Date.now()}`,
          title: `${readable(action)} command accepted by backend`,
          body: message,
          severity: action === "stop" ? "warning" : "info",
          source: "operator command",
        });
      } catch (error) {
        await reconcile();
        const message = `${error.code ? `${error.code}: ` : ""}${error.message || "Command failed"}${error.code?.includes("TIMEOUT") ? " Command status unknown; check the backend and rover before retrying." : ""}`;
        setCommandState({ busy: false, message, error: true });
        showToast({
          key: `operator-error:${action}:${Date.now()}`,
          title: `${readable(action)} command not confirmed`,
          body: message,
          severity: "critical",
          source: "operator command",
        });
      }
    },
    [showToast, canResume, canStart, canStop, reconcile],
  );

  const acknowledgeEvent = useCallback(
    async (eventId) => {
      if (!eventId) return;
      setCommandState({ busy: true, message: "", error: false });
      try {
        const result = await api.acknowledge(eventId);
        await reconcile();
        const message = `Backend acknowledged event ${result.data?.event_id || eventId}. Resume remains a separate command.`;
        setCommandState({ busy: false, message, error: false });
        showToast({
          key: `acknowledged:${eventId}`,
          title: "Detection event acknowledged",
          body: message,
          severity: "info",
          source: "operator action",
          eventId,
        });
      } catch (error) {
        await reconcile();
        const message = `${error.code ? `${error.code}: ` : ""}${error.message || "Acknowledgement was not confirmed"}`;
        setCommandState({ busy: false, message, error: true });
        showToast({
          key: `acknowledge-error:${eventId}:${Date.now()}`,
          title: "Detection acknowledgement failed",
          body: message,
          severity: "critical",
          source: "operator action",
          eventId,
        });
      }
    },
    [showToast, reconcile],
  );

  const capture = useCallback(async () => {
    setCaptureError("");
    const camera = data.camera || data.system?.camera;
    const latestFrame = isEventTime(camera?.latest_frame_timestamp);
    if (
      !physicalVisionRef.current ||
      backend.errors.camera ||
      camera?.source_verified !== true ||
      !camera.connected ||
      camera.stale ||
      latestFrame == null ||
      Date.now() - latestFrame > 5000 ||
      Date.now() - latestFrame < -5000
    ) {
      setCaptureError(
        "Capture is locked until the backend confirms a fresh physical rover camera source. This backend does not currently provide that attestation.",
      );
      return;
    }
    try {
      const snapshot = await api.snapshot();
      const detection = currentDetection || null;
      setCaptureDraft({
        id: crypto.randomUUID(),
        blob: snapshot.blob,
        cameraSource: snapshot.source,
        capturedAt: snapshot.timestamp,
        missionState: currentMission?.state || null,
        missionId: currentMission?.mission_id || currentMission?.id || null,
        eventId: detection?.event_id || null,
        objectClass: detection?.object_class || null,
        confidence:
          typeof detection?.confidence === "number"
            ? detection.confidence
            : null,
        title: `Rover evidence · ${new Date().toLocaleString()}`,
        notes: "",
      });
    } catch (error) {
      setCaptureError(error.message || "Camera snapshot unavailable");
      showToast({
        key: `screenshot-failed:${Date.now()}`,
        title: "Screenshot capture failed",
        body: error.message || "Camera snapshot unavailable",
        severity: "warning",
        source: "camera",
      });
    }
  }, [
    showToast,
    backend.errors.camera,
    currentDetection,
    currentMission,
    data.camera,
    data.system,
  ]);

  const saveCapture = useCallback(async () => {
    if (!captureDraft) return;
    try {
      const record = {
        ...captureDraft,
        title: captureDraft.title.trim() || "Rover evidence",
        notes: captureDraft.notes.trim(),
      };
      await saveEvidence(record);
      setEvidence((items) => [
        record,
        ...items.filter((item) => item.id !== record.id),
      ]);
      setOpenEvidenceId(record.id);
      setCaptureDraft(null);
      showToast({
        key: `screenshot:${record.id}`,
        title: "Screenshot saved locally",
        body: `${record.title} · this browser only`,
        severity: "info",
        source: "camera",
        screenshotId: record.id,
      });
      setView("screenshots");
      location.hash = "screenshots";
    } catch (error) {
      setCaptureError(
        `${error.message || "Could not save screenshot"} Screenshots are stored only in this browser; check available storage.`,
      );
    }
  }, [showToast, captureDraft]);

  const removeScreenshot = useCallback(async (id) => {
    try {
      await deleteEvidence(id);
      setEvidence((items) => items.filter((item) => item.id !== id));
      return true;
    } catch {
      return false;
    }
  }, []);

  const context = {
    ...backend,
    data: displayData,
    currentMission,
    currentDetection,
    rover,
    capabilities,
    simulationActive,
    physicalDataWithheld: !physicalDataVerified,
    physicalVisionWithheld: !physicalVisionVerified,
    missionStateWithheld,
    physicalLinkReported,
    sensorsSafe,
    movementVerified,
    canStop,
    canStart,
    canResume,
    heldByBackend,
    commandState,
    runCommand,
    acknowledgeEvent,
    go,
    capture,
    captureError,
    evidence,
    removeScreenshot,
    operatorName: operator?.name,
    openEvidenceId,
    clearEvidenceOpen: () => setOpenEvidenceId(null),
    theme,
    setTheme,
    reducedMotion,
    setReducedMotion,
  };

  if (!operator)
    return (
      <Login
        onLogin={(user) => {
          localStorage.removeItem(OPERATOR_KEY);
          sessionStorage.removeItem(OPERATOR_KEY);
          const storage = user.remembered ? localStorage : sessionStorage;
          storage.setItem(OPERATOR_KEY, JSON.stringify(user));
          setOperator(user);
        }}
      />
    );

  const CurrentView = Views[view] || Views.overview;
  return (
    <div className="app-shell">
      {mobileNav && (
        <button
          className="drawer-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside
        className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}
        aria-label="Primary navigation"
      >
        <div className="brand-lockup">
          <div className="brand-wordmark">
            <span className="brand-name">DRISTIGATI</span>
            <span className="brand-tagline">AUTONOMY BEYOND THE MAP</span>
          </div>
          <button
            className="icon-button sidebar-close"
            aria-label="Close navigation"
            onClick={() => setMobileNav(false)}
          >
            <X size={18} />
          </button>
        </div>
        <div className="sidebar-caption">OPERATIONS</div>
        <nav className="nav-list">
          {NAV.map(([id, label, Icon]) => (
            <button
              key={id}
              className={`nav-item ${view === id ? "active" : ""}`}
              aria-current={view === id ? "page" : undefined}
              onClick={() => go(id)}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className={`sidebar-connection ${backend.connection}`}>
            <span className="status-dot" />
            <div>
              <b>
                {backend.connection === "connected"
                  ? "Backend reachable"
                  : backend.connection === "connecting"
                    ? "Connecting"
                    : "Backend disconnected"}
              </b>
              <small>
                {backend.socketConnected ? "Socket live" : "REST status only"}
              </small>
            </div>
          </div>
          <div className="sidebar-foot">DristiGati · Operator console</div>
        </div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            onClick={() => setMobileNav(true)}
          >
            <Menu size={19} />
          </button>
          <div className="page-heading">
            <div className="eyebrow">SEARCH & RESCUE OPERATIONS</div>
            <h1>{activeTitle}</h1>
          </div>
          <div className="topbar-spacer" />
          <div className="header-status">
            <span className={`status-pill ${backend.connection}`}>
              <span className="status-dot" />
              {backend.connection === "connected"
                ? "Backend online"
                : backend.connection === "connecting"
                  ? "Connecting"
                  : "Backend offline"}
            </span>
            <span
              className={`status-pill ${physicalLinkReported ? "warn" : "neutral"}`}
            >
              <span className="status-dot" />
              {physicalLinkReported
                ? "Physical link reported · unverified"
                : capabilities?.simulated_rover
                  ? "Simulated backend · telemetry withheld"
                  : "Physical rover unverified"}
            </span>
          </div>
          <div className="profile-wrap">
            <button
              className="profile-button"
              aria-expanded={profileOpen}
              onClick={() => setProfileOpen((v) => !v)}
            >
              <span className="avatar">
                {operator.name?.slice(0, 1)?.toUpperCase() || "O"}
              </span>
              <span className="profile-text">
                <b>{operator.name || "Operator"}</b>
                <small>{operator.role || "Local operator session"}</small>
              </span>
              <ChevronDown size={14} />
            </button>
            {profileOpen && (
              <div className="profile-menu">
                <div className="profile-menu-name">
                  {operator.email || operator.name}
                </div>
                <button onClick={() => go("settings")}>
                  <Settings size={15} />
                  Settings
                </button>
                <button
                  onClick={() => {
                    localStorage.removeItem(OPERATOR_KEY);
                    sessionStorage.removeItem(OPERATOR_KEY);
                    setOperator(null);
                  }}
                >
                  <LogOut size={15} />
                  Log out
                </button>
              </div>
            )}
          </div>
        </header>

        <div className="control-ribbon">
          <div className="ribbon-context">
            <ShieldAlert size={16} />
            <span>
              {heldByBackend
                ? "Backend already reports the rover mission held; no duplicate STOP command will be sent."
                : !physicalLinkReported
                  ? "Physical rover connection is not verified. Movement commands are locked."
                  : !physicalVisionVerified
                    ? "Physical camera source or frame freshness is not verified. Search and resume commands are locked."
                    : !movementVerified
                      ? "Hardware test or safety confirmation unavailable. Movement commands remain locked."
                      : "Physical rover link and safety state reported by backend."}
            </span>
          </div>
          <button
            className="stop-button"
            disabled={!canStop}
            title={
              canStop
                ? "Send supported manual STOP command to the backend"
                : heldByBackend
                  ? "Backend already reports an operator or person-event hold"
                  : "Available only when a physical rover link is reported and backend is reachable"
            }
            onClick={() => runCommand("stop")}
          >
            <AlertOctagon size={16} />
            {commandState.busy ? "SENDING…" : "STOP ROVER"}
          </button>
        </div>
        {!physicalDataVerified && (
          <div className="stale-banner simulation-banner" role="status">
            <ShieldAlert size={15} />
            <span>
              {simulationActive
                ? "Backend reports SIMULATED_ROVER=true. Simulation-derived rover, mission, safety, detection, obstacle, and camera values are withheld."
                : "Physical data is withheld until capabilities report simulated_rover=false and rover status confirms a connected PHYSICAL adapter. Camera imagery also requires explicit physical-source and fresh-frame attestation."}
            </span>
          </div>
        )}
        {physicalDataVerified && !physicalVisionVerified && (
          <div className="stale-banner simulation-banner" role="status">
            <ShieldAlert size={15} />
            <span>
              Physical rover link is reported, but the camera source/freshness
              is not attested. Camera imagery, screenshot evidence, person and
              obstacle events, and their histories are withheld.
            </span>
          </div>
        )}
        {Object.keys(backend.errors).length > 0 && (
          <div className="stale-banner" role="status">
            <ShieldAlert size={15} />
            <span>
              One or more status endpoints failed. Any retained values from
              those endpoints may be stale:{" "}
              {Object.keys(backend.errors).join(", ")}.
            </span>
          </div>
        )}

        <section className="workspace" aria-label={activeTitle}>
          <CurrentView c={context} />
        </section>
        <footer className="global-footer">
          <span>
            Real backend data only · unavailable values remain unfilled
          </span>
          <span>
            Last successful status:{" "}
            {backend.lastSuccess
              ? backend.lastSuccess.toLocaleTimeString()
              : "Never"}
          </span>
          <button
            className="footer-refresh"
            onClick={refresh}
            disabled={backend.refreshing}
          >
            {backend.refreshing ? "Refreshing…" : "Refresh status"}
          </button>
        </footer>
      </main>

      {captureDraft && (
        <CaptureModal
          draft={captureDraft}
          setDraft={setCaptureDraft}
          error={captureError}
          onCancel={() => {
            setCaptureDraft(null);
            setCaptureError("");
          }}
          onSave={saveCapture}
        />
      )}
      {toast && (
        <div className={`toast ${toast.severity || "info"}`} role="status">
          <span className="toast-mark">
            {toast.severity === "critical" ? (
              <AlertOctagon size={16} />
            ) : toast.severity === "warning" ? (
              <ShieldAlert size={16} />
            ) : (
              <ShieldCheck size={16} />
            )}
          </span>
          <div>
            <b>{toast.title}</b>
            <small>{toast.body || "Backend event received"}</small>
          </div>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function Login({ onLogin }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const submit = (event) => {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError("Enter an operator email and password to continue.");
      return;
    }
    // This is only a local UI gate: no auth endpoint exists. Never persist the password.
    const displayName = name.trim() || email.split("@")[0] || "Operator";
    onLogin({
      name: displayName,
      email: email.trim(),
      role: "Local operator session",
      remembered: remember,
    });
  };
  return (
    <div className="login-screen">
      <div className="login-grid" />
      <div className="login-panel">
        <div className="brand-lockup login-brand">
          <div className="brand-wordmark">
            <span className="brand-name">DRISTIGATI</span>
            <span className="brand-tagline">AUTONOMY BEYOND THE MAP</span>
          </div>
        </div>
        <div className="login-kicker">
          <span className="live-indicator" />
          ROBOTICS OPERATIONS CONSOLE
        </div>
        <h1>Operator sign in</h1>
        <p className="login-copy">
          Access the mission workspace for vision-based search and rescue
          operations.
        </p>
        <form onSubmit={submit} className="login-form">
          <label>
            Operator name <span>Optional</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="Your name"
            />
          </label>
          <label>
            Email or username
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
              placeholder="operator@example.org"
            />
          </label>
          <label>
            Password
            <div className="password-field">
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type={show ? "text" : "password"}
                autoComplete="current-password"
                required
                placeholder="Enter password"
              />
              <button type="button" onClick={() => setShow((v) => !v)}>
                {show ? "Hide" : "Show"}
              </button>
            </div>
          </label>
          <label className="remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            Remember this operator on this browser
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="login-submit" type="submit">
            Open local console
          </button>
        </form>
        <div className="auth-warning">
          <CircleHelp size={16} />
          <div>
            <b>Local development access only</b>
            <span>
              The supplied backend has no authentication API. This screen does
              not verify credentials or secure rover commands. Passwords are
              never saved; the operator name and email stay in this browser's
              session, or across sessions when Remember is selected.
            </span>
          </div>
        </div>
        <div className="login-foot">
          PHYSICAL ROVER DATA IS SHOWN ONLY WHEN VERIFIED BY THE BACKEND
        </div>
      </div>
    </div>
  );
}

function CaptureModal({ draft, setDraft, error, onCancel, onSave }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    const url = URL.createObjectURL(draft.blob);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [draft.blob]);
  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal-card capture-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="capture-title"
      >
        <header className="modal-header">
          <div>
            <span className="eyebrow">LOCAL EVIDENCE</span>
            <h2 id="capture-title">Review camera snapshot</h2>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onCancel}>
            <X size={18} />
          </button>
        </header>
        <div className="capture-preview">
          {src && (
            <img src={src} alt="Snapshot captured from the rover camera" />
          )}
        </div>
        <p className="modal-note">
          Captured from the backend snapshot endpoint at{" "}
          {formatDate(draft.capturedAt)}. Stored only in this browser after
          saving.
        </p>
        <div className="form-grid">
          <label>
            Title
            <input
              value={draft.title}
              onChange={(e) =>
                setDraft((d) => ({ ...d, title: e.target.value }))
              }
              maxLength={120}
            />
          </label>
          <label>
            Notes
            <textarea
              value={draft.notes}
              onChange={(e) =>
                setDraft((d) => ({ ...d, notes: e.target.value }))
              }
              rows={3}
              maxLength={1000}
              placeholder="Optional operator notes"
            />
          </label>
        </div>
        <div className="capture-association">
          <span>Mission state: {draft.missionState || "Not reported"}</span>
          <span>Mission ID: {draft.missionId || "Not reported"}</span>
          <span>Event: {draft.eventId || "Not associated"}</span>
        </div>
        {error && <p className="form-error">{error}</p>}
        <footer className="modal-actions">
          <button className="button secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="button primary" onClick={onSave}>
            Save screenshot locally
          </button>
        </footer>
      </div>
    </div>
  );
}

export default App;
