const apiBaseUrl = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:5000";

export function getApiBaseUrl() {
  return apiBaseUrl.replace(/\/$/, "");
}
