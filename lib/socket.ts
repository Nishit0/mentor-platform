import { io } from "socket.io-client";

const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:5000";

export const socket = io(socketUrl, {
  autoConnect: false,
  transports: ["websocket"],
});

export function setSocketAccessToken(accessToken: string | null) {
  socket.auth = accessToken ? { accessToken } : {};
}
