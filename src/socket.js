import { io } from "socket.io-client";
import { getApiBaseUrl } from "./api.js";

// Verified in the supplied backend's EventService call sites. The additional event names
// in FRONTEND_INTEGRATION.md are not emitted by this backend version.
export const IMPLEMENTED_EVENTS = [
  "mission_state_changed",
  "person_detected",
  "person_event_acknowledged",
  "person_cooldown_started",
  "obstacle_candidate",
  "obstacle_warning_verified",
];

export function connectSocket(onEvent, onConnection) {
  const socket = io(getApiBaseUrl(), {
    transports: ["polling", "websocket"],
    reconnection: true,
    timeout: 7000,
  });
  socket.on("connect", () => onConnection?.(true));
  socket.on("disconnect", () => onConnection?.(false));
  socket.on("connect_error", () => onConnection?.(false));
  for (const name of IMPLEMENTED_EVENTS)
    socket.on(name, (payload) => onEvent?.(name, payload));
  return () => {
    for (const name of IMPLEMENTED_EVENTS) socket.off(name);
    socket.off("connect");
    socket.off("disconnect");
    socket.off("connect_error");
    socket.disconnect();
  };
}
