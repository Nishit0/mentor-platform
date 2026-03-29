"use client";

import { useEffect, useRef, useState } from "react";
import { readMediaPreferences, writeMediaPreferences } from "@/lib/mediaPreferences";
import { socket } from "@/lib/socket";

const rtcConfig: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export default function VideoCall({ roomId }: { roomId: string }) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream>(new MediaStream());
  const roleRef = useRef<"initiator" | "receiver">("receiver");
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState("Preparing devices");
  const [error, setError] = useState<string | null>(null);

  const persistPreferences = (audioEnabled: boolean, videoEnabled: boolean) => {
    writeMediaPreferences({ audioEnabled, videoEnabled });
  };

  const syncLocalPreview = () => {
    if (!localVideoRef.current) {
      return;
    }

    const videoTracks = localStreamRef.current.getVideoTracks();
    const audioTracks = localStreamRef.current.getAudioTracks();
    if (videoTracks.length === 0) {
      localVideoRef.current.srcObject = null;
      return;
    }

    localVideoRef.current.srcObject = new MediaStream([...videoTracks, ...audioTracks]);
  };

  const createPeer = () => {
    const peer = new RTCPeerConnection(rtcConfig);

    peer.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("ice-candidate", { roomId, candidate: event.candidate });
      }
    };

    peer.onconnectionstatechange = () => {
      const state = peer.connectionState;
      if (state === "connected") {
        setConnectionStatus("Connected");
      } else if (state === "connecting") {
        setConnectionStatus("Connecting");
      } else if (state === "disconnected" || state === "failed") {
        setConnectionStatus("Interrupted");
      }
    };

    return peer;
  };

  const ensurePeer = () => {
    if (peerRef.current) {
      return peerRef.current;
    }

    const peer = createPeer();
    peerRef.current = peer;
    localStreamRef.current.getTracks().forEach((track) => {
      peer.addTrack(track, localStreamRef.current);
    });
    return peer;
  };

  const renegotiate = async () => {
    const oldPeer = peerRef.current;
    if (oldPeer) {
      oldPeer.ontrack = null;
      oldPeer.onicecandidate = null;
      oldPeer.onconnectionstatechange = null;
      oldPeer.close();
      peerRef.current = null;
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    const peer = ensurePeer();
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    socket.emit("offer", { roomId, offer });
    setConnectionStatus("Updating");
  };

  useEffect(() => {
    const localStream = localStreamRef.current;
    const localVideo = localVideoRef.current;
    const remoteVideo = remoteVideoRef.current;

    const handleRole = (role: "initiator" | "receiver") => {
      roleRef.current = role;
      setConnectionStatus(role === "initiator" ? "Waiting" : "Joining");
    };

    const handlePeerReady = async () => {
      if (roleRef.current !== "initiator") {
        return;
      }

      const peer = ensurePeer();
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      socket.emit("offer", { roomId, offer });
      setConnectionStatus("Calling");
    };

    const handleOffer = async (offer: RTCSessionDescriptionInit) => {
      const peer = ensurePeer();
      await peer.setRemoteDescription(offer);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socket.emit("answer", { roomId, answer });
      setConnectionStatus("Answering");
    };

    const handleAnswer = async (answer: RTCSessionDescriptionInit) => {
      const peer = ensurePeer();
      await peer.setRemoteDescription(answer);
    };

    const handleIceCandidate = async (candidate: RTCIceCandidateInit) => {
      const peer = ensurePeer();
      try {
        await peer.addIceCandidate(candidate);
      } catch {
        setConnectionStatus("Reconnecting");
      }
    };

    const handlePeerLeft = () => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
      setConnectionStatus("Waiting");
    };

    const initializeMedia = async () => {
      const preferences = readMediaPreferences();
      setIsAudioEnabled(preferences.audioEnabled);
      setIsVideoEnabled(preferences.videoEnabled);

      if (!preferences.audioEnabled && !preferences.videoEnabled) {
        ensurePeer();
        setConnectionStatus("Waiting");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: preferences.audioEnabled,
          video: preferences.videoEnabled,
        });

        stream.getTracks().forEach((track) => {
          localStream.addTrack(track);
        });

        syncLocalPreview();
        ensurePeer();
        setConnectionStatus("Waiting");
      } catch {
        setError("Camera or microphone access was denied.");
        setConnectionStatus("Media blocked");
        setIsAudioEnabled(false);
        setIsVideoEnabled(false);
        persistPreferences(false, false);
      }
    };

    socket.on("role", handleRole);
    socket.on("peer-ready", handlePeerReady);
    socket.on("offer", handleOffer);
    socket.on("answer", handleAnswer);
    socket.on("ice-candidate", handleIceCandidate);
    socket.on("peer-left", handlePeerLeft);

    initializeMedia();

    return () => {
      socket.off("role", handleRole);
      socket.off("peer-ready", handlePeerReady);
      socket.off("offer", handleOffer);
      socket.off("answer", handleAnswer);
      socket.off("ice-candidate", handleIceCandidate);
      socket.off("peer-left", handlePeerLeft);
      localStream.getTracks().forEach((track) => track.stop());
      if (localVideo) {
        localVideo.srcObject = null;
      }
      if (remoteVideo) {
        remoteVideo.srcObject = null;
      }
      peerRef.current?.close();
      peerRef.current = null;
    };
  }, [roomId]);

  const toggleAudio = async () => {
    try {
      if (isAudioEnabled) {
        localStreamRef.current.getAudioTracks().forEach((track) => {
          localStreamRef.current.removeTrack(track);
          track.stop();
        });
        setIsAudioEnabled(false);
        persistPreferences(false, isVideoEnabled);
        setError(null);
        await renegotiate();
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const nextTrack = stream.getAudioTracks()[0];
      if (!nextTrack) {
        return;
      }

      localStreamRef.current.addTrack(nextTrack);
      setIsAudioEnabled(true);
      persistPreferences(true, isVideoEnabled);
      setError(null);
      syncLocalPreview();
      await renegotiate();
    } catch {
      setError("Microphone could not be turned on.");
    }
  };

  const toggleVideo = async () => {
    try {
      if (isVideoEnabled) {
        localStreamRef.current.getVideoTracks().forEach((track) => {
          localStreamRef.current.removeTrack(track);
          track.stop();
        });
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = null;
        }
        setIsVideoEnabled(false);
        persistPreferences(isAudioEnabled, false);
        setError(null);
        await renegotiate();
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const nextTrack = stream.getVideoTracks()[0];
      if (!nextTrack) {
        return;
      }

      localStreamRef.current.addTrack(nextTrack);
      setIsVideoEnabled(true);
      persistPreferences(isAudioEnabled, true);
      setError(null);
      syncLocalPreview();
      await renegotiate();
    } catch {
      setError("Camera could not be turned on.");
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[1.45rem] border border-slate-800 bg-[#091221] shadow-xl">
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-3 py-2">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-slate-100">Call</h2>
          <p className="mt-0.5 text-[11px] text-slate-400">{connectionStatus}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleAudio} className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-100 transition hover:border-slate-500">
            {isAudioEnabled ? "Mic off" : "Mic on"}
          </button>
          <button onClick={toggleVideo} className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-100 transition hover:border-slate-500">
            {isVideoEnabled ? "Camera off" : "Camera on"}
          </button>
        </div>
      </div>

      {error ? <p className="px-3 pt-2 text-xs text-rose-300">{error}</p> : null}

      <div className="grid min-h-0 gap-3 p-3 lg:grid-cols-2">
        <div className="min-h-0 overflow-hidden rounded-[1.25rem] border border-slate-800 bg-black/80">
          <div className="border-b border-slate-800 px-3 py-2 text-xs text-slate-400">You</div>
          <div className="flex aspect-video items-center justify-center bg-black">
            <video ref={localVideoRef} autoPlay muted playsInline className="h-full w-full object-contain" />
          </div>
        </div>
        <div className="min-h-0 overflow-hidden rounded-[1.25rem] border border-slate-800 bg-black/80">
          <div className="border-b border-slate-800 px-3 py-2 text-xs text-slate-400">Participant</div>
          <div className="flex aspect-video items-center justify-center bg-black">
            <video ref={remoteVideoRef} autoPlay playsInline className="h-full w-full object-contain" />
          </div>
        </div>
      </div>
    </section>
  );
}
