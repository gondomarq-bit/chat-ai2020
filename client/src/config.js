// Centralized API/Socket URL configuration.
// Priority: VITE_API_URL env var -> same origin (production) -> localhost dev.

export const API_URL =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? "" : "http://localhost:5000");

// For Socket.io, empty string means "same origin" which is what we want in prod
// when the frontend is served by the backend.
export const SOCKET_URL = import.meta.env.VITE_API_URL || "";

export function apiUrl(path) {
  if (!path.startsWith("/")) path = "/" + path;
  if (API_URL) return API_URL + path;
  return path; // relative — uses same origin
}
