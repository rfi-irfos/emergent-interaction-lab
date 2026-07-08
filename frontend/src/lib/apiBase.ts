// The admin panel is served from GitHub Pages, which has no backend of its
// own — relative fetch('/api/...') resolves to the Pages origin and 404s.
// This must point at the Fly-hosted backend when the frontend isn't served
// from that same origin (empty string keeps relative paths for local dev/
// the Fly-served copy, where frontend and backend already share an origin).
export const API_BASE = import.meta.env.VITE_API_BASE || ''
