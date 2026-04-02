"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { socket } from "@/lib/socket";

type ChatMessage = {
  id: string;
  senderName: string;
  senderRole?: "mentor" | "student";
  text: string;
  type: "text" | "snippet" | "system";
  createdAt: string;
};

export default function ChatBox({
  roomId,
  userName,
  userRole,
}: {
  roomId: string;
  userName: string;
  userRole: "mentor" | "student";
}) {
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"text" | "snippet">("text");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleHistory = (history: ChatMessage[]) => {
      setMessages(history);
    };

    const handleMessage = (incomingMessage: ChatMessage) => {
      setMessages((current) => [...current, incomingMessage]);
    };

    socket.on("chat-history", handleHistory);
    socket.on("receive-message", handleMessage);

    return () => {
      socket.off("chat-history", handleHistory);
      socket.off("receive-message", handleMessage);
    };
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const sendMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      return;
    }

    socket.emit("send-message", {
      roomId,
      senderName: userName,
      senderRole: userRole,
      text: trimmedMessage,
      type: messageType,
    });

    setMessage("");
    setMessageType("text");
  };

  return (
    <section className="flex h-full min-h-0 flex-col rounded-[1.25rem] border border-slate-800 bg-[#091221] shadow-xl xl:min-h-0">
      <div className="border-b border-slate-800 px-2.5 py-1.5">
        <h2 className="text-xs font-medium text-slate-100">Chat</h2>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2.5 py-2">
        {messages.map((entry) => {
          const isOwnMessage = entry.senderName === userName && entry.type !== "system";
          const bubbleClassName =
            entry.type === "system"
              ? "border border-amber-500/15 bg-amber-500/10 text-amber-100"
              : isOwnMessage
                ? "bg-slate-100 text-slate-950"
                : "border border-slate-700 bg-slate-900 text-slate-100";

          return (
            <div key={entry.id} className={entry.type === "system" ? "" : isOwnMessage ? "flex justify-end" : "flex justify-start"}>
              <div className={`max-w-[90%] rounded-xl px-2.5 py-2 ${bubbleClassName}`}>
                <div className="mb-1.5 flex items-center gap-2 text-[10px] opacity-80">
                  <span>{entry.senderName}</span>
                  {entry.senderRole ? <span>{entry.senderRole}</span> : null}
                  <span>{new Date(entry.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                {entry.type === "snippet" ? (
                  <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl bg-black/30 p-2.5 font-mono text-xs">
                    <code>{entry.text}</code>
                  </pre>
                ) : (
                  <p className="whitespace-pre-wrap text-[11px] leading-4.5">{entry.text}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <form onSubmit={sendMessage} className="border-t border-slate-800 px-2.5 py-2">
        <div className="mb-2 flex gap-2 text-xs">
          <button
            type="button"
            onClick={() => setMessageType("text")}
            className={`rounded-full px-2.5 py-1 ${messageType === "text" ? "bg-slate-100 text-slate-950" : "bg-slate-900 text-slate-300"}`}
          >
            Text
          </button>
          <button
            type="button"
            onClick={() => setMessageType("snippet")}
            className={`rounded-full px-2.5 py-1 ${messageType === "snippet" ? "bg-slate-100 text-slate-950" : "bg-slate-900 text-slate-300"}`}
          >
            Snippet
          </button>
        </div>
        <div className="flex gap-3">
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={1}
            placeholder={messageType === "snippet" ? "Paste code or command" : "Type a message"}
            className="min-h-12 flex-1 resize-none rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none transition focus:border-slate-500 xl:min-h-12"
          />
          <button
            type="submit"
            className="self-end rounded-xl bg-slate-100 px-3.5 py-2 text-xs font-medium text-slate-950 transition hover:bg-white"
          >
            Send
          </button>
        </div>
      </form>
    </section>
  );
}
