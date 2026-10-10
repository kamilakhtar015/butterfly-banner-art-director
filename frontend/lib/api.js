// In dev (next dev on :3000) the backend is on :8000; in the static build FastAPI
// serves this app, so same-origin.
export function apiBase() {
  if (typeof window === "undefined") return "";
  return window.location.port === "3000" ? "http://localhost:8000" : window.location.origin;
}

export async function post(path, body) {
  const r = await fetch(apiBase() + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(path + " " + r.status);
  return r.json();
}
