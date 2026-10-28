import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { connectSocket } from "./socket.js";

const EMPTY = {
  health: null,
  capabilities: null,
  system: null,
  mission: null,
  camera: null,
  detections: null,
  currentDetection: null,
  obstacles: null,
  obstacleHistory: null,
  missionHistory: null,
  detectionConfig: null,
  obstacleConfig: null,
  rover: null,
};

export function useBackend(onLiveEvent) {
  const [data, setData] = useState(EMPTY);
  const [connection, setConnection] = useState("connecting");
  const [socketConnected, setSocketConnected] = useState(false);
  const [errors, setErrors] = useState({});
  const [lastSuccess, setLastSuccess] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const eventHandler = useRef(onLiveEvent);
  const inFlight = useRef(null);

  useEffect(() => {
    eventHandler.current = onLiveEvent;
  }, [onLiveEvent]);

  const refresh = useCallback(() => {
    if (inFlight.current) return inFlight.current;

    setRefreshing(true);
    const operation = (async () => {
      const jobs = {
        health: api.health(),
        system: api.systemStatus(),
        capabilities: api.capabilities(),
        camera: api.cameraStatus(),
        mission: api.missionStatus(),
        missionHistory: api.missionHistory(),
        currentDetection: api.currentDetection(),
        detections: api.detectionHistory(),
        obstacles: api.currentObstacle(),
        obstacleHistory: api.obstacleHistory(),
        detectionConfig: api.detectionConfig(),
        obstacleConfig: api.obstacleConfig(),
        rover: api.roverStatus(),
      };
      const entries = Object.entries(jobs);
      const settled = await Promise.allSettled(
        entries.map(([, promise]) => promise),
      );
      const nextValues = {};
      const nextErrors = {};
      let backendAlive = false;

      settled.forEach((result, index) => {
        const key = entries[index][0];
        if (result.status === "fulfilled") {
          nextValues[key] = result.value.data;
          if (key === "health" || key === "system") backendAlive = true;
        } else {
          nextErrors[key] = result.reason?.message || "Request failed";
        }
      });

      if (backendAlive) {
        setConnection("connected");
        setLastSuccess(new Date());
      } else {
        setConnection("disconnected");
      }
      setErrors(nextErrors);
      setData((previous) => {
        const merged = { ...previous, ...nextValues };
        // Aggregate data is authoritative; use endpoint-specific status only when
        // the aggregate omits a field and the endpoint returned successfully.
        if (nextValues.system) {
          merged.mission = nextValues.system.mission ?? merged.mission;
          merged.camera = nextValues.system.camera ?? merged.camera;
        }
        merged.detections = Array.isArray(merged.detections)
          ? merged.detections
          : null;
        merged.missionHistory = Array.isArray(merged.missionHistory)
          ? merged.missionHistory
          : null;
        merged.obstacleHistory = Array.isArray(merged.obstacleHistory)
          ? merged.obstacleHistory
          : null;
        return merged;
      });
      return { alive: backendAlive, errors: nextErrors };
    })();

    let shared;
    shared = operation.finally(() => {
      if (inFlight.current === shared) {
        inFlight.current = null;
        setRefreshing(false);
      }
    });
    inFlight.current = shared;
    return shared;
  }, []);

  const reconcile = useCallback(async () => {
    // If a poll started before a transition or command completed, wait for it
    // and then start another poll for a post-transition authoritative read.
    const pending = inFlight.current;
    if (pending) await pending;
    return refresh();
  }, [refresh]);

  useEffect(() => {
    let active = true;
    const off = connectSocket(
      (name, payload) => {
        if (!active) return;
        eventHandler.current?.(name, payload);
        // Reconcile authoritative state after backend transitions; never infer it
        // from an operator click or a socket payload alone.
        if (
          name === "mission_state_changed" ||
          name === "person_detected" ||
          name === "person_event_acknowledged"
        )
          reconcile();
      },
      (connected) => {
        if (!active) return;
        setSocketConnected(connected);
        if (connected) reconcile();
      },
    );
    reconcile();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
      off();
    };
  }, [reconcile, refresh]);

  return {
    data,
    connection,
    socketConnected,
    errors,
    lastSuccess,
    refreshing,
    refresh,
    reconcile,
  };
}
