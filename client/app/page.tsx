"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const [roomId, setRoomId] = useState("");
  const router = useRouter();

  return (
    <div className="h-screen flex flex-col items-center justify-center">
      <input
        className="border p-2"
        placeholder="Enter Room ID"
        value={roomId}
        onChange={(e) => setRoomId(e.target.value)}
      />
      <button
        className="mt-2 bg-black text-white px-4 py-2"
        onClick={() => router.push(`/session/${roomId}`)}
      >
        Join Session
      </button>
    </div>
  );
}