"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { editor as MonacoEditor } from "monaco-editor";
import { socket } from "@/lib/socket";

const Editor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
});

type CursorPayload = {
  socketId: string;
  userName: string;
  position: {
    lineNumber: number;
    column: number;
  };
};

const starterSnippet = {
  javascript: `function solve(input) {
  return input
    .trim()
    .split("\n")
    .map((line) => line.toUpperCase());
}

console.log(solve("mentor\nstudent"));
`,
  python: `def solve(text: str):
    return [line.upper() for line in text.strip().splitlines()]

print(solve("mentor\nstudent"))
`,
};

export default function CodeEditor({ roomId }: { roomId: string }) {
  const [code, setCode] = useState(starterSnippet.javascript);
  const [language, setLanguage] = useState<"javascript" | "python">("javascript");
  const [remoteCursors, setRemoteCursors] = useState<Record<string, CursorPayload>>({});
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null);
  const decorationIdsRef = useRef<string[]>([]);
  const codeRef = useRef(code);

  useEffect(() => {
    codeRef.current = code;
  }, [code]);

  useEffect(() => {
    const handleCodeState = (payload: { code: string; language: "javascript" | "python" }) => {
      setLanguage(payload.language);
      setCode(payload.code);
    };

    const handleCodeUpdate = (nextCode: string) => {
      setCode(nextCode);
    };

    const handleLanguageUpdate = (nextLanguage: "javascript" | "python") => {
      setLanguage(nextLanguage);
      setCode((current) => {
        if (current.trim().length > 0) {
          return current;
        }

        return starterSnippet[nextLanguage];
      });
    };

    const handleCursorUpdate = (payload: CursorPayload) => {
      setRemoteCursors((current) => ({
        ...current,
        [payload.socketId]: payload,
      }));
    };

    const handleCursorRemove = (socketId: string) => {
      setRemoteCursors((current) => {
        const next = { ...current };
        delete next[socketId];
        return next;
      });
    };

    socket.on("code-state", handleCodeState);
    socket.on("code-update", handleCodeUpdate);
    socket.on("language-update", handleLanguageUpdate);
    socket.on("cursor-update", handleCursorUpdate);
    socket.on("cursor-remove", handleCursorRemove);

    return () => {
      socket.off("code-state", handleCodeState);
      socket.off("code-update", handleCodeUpdate);
      socket.off("language-update", handleLanguageUpdate);
      socket.off("cursor-update", handleCursorUpdate);
      socket.off("cursor-remove", handleCursorRemove);
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) {
      return;
    }

    const decorations = Object.values(remoteCursors).map((cursor) => ({
      range: new monaco.Range(
        cursor.position.lineNumber,
        cursor.position.column,
        cursor.position.lineNumber,
        cursor.position.column + 1,
      ),
      options: {
        className: "remote-cursor",
        after: {
          content: ` ${cursor.userName}`,
          inlineClassName: "remote-cursor-label",
        },
      },
    }));

    decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, decorations);
  }, [remoteCursors]);

  const handleEditorChange = (value: string | undefined) => {
    const nextCode = value ?? "";
    if (nextCode === codeRef.current) {
      return;
    }

    setCode(nextCode);
    socket.emit("code-change", { roomId, code: nextCode });
  };

  const handleLanguageChange = (nextLanguage: "javascript" | "python") => {
    setLanguage(nextLanguage);
    const nextCode = code.trim().length > 0 ? code : starterSnippet[nextLanguage];
    setCode(nextCode);
    socket.emit("language-change", { roomId, language: nextLanguage, code: nextCode });
  };

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[1.45rem] border border-slate-800 bg-[#091221] shadow-xl">
      <div className="flex flex-col gap-2 border-b border-slate-800 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-medium text-slate-100">Editor</p>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <span>Language</span>
          <select
            value={language}
            onChange={(event) => handleLanguageChange(event.target.value as "javascript" | "python")}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-slate-100 outline-none transition focus:border-slate-500"
          >
            <option className="bg-slate-900 text-slate-100" value="javascript">JavaScript</option>
            <option className="bg-slate-900 text-slate-100" value="python">Python</option>
          </select>
        </label>
      </div>
      <div className="h-[18rem] xl:min-h-0 xl:flex-1">
        <Editor
          height="100%"
          language={language}
          value={code}
          onChange={handleEditorChange}
          onMount={(editor, monaco) => {
            editorRef.current = editor;
            monacoRef.current = monaco;

            editor.onDidChangeCursorPosition((event) => {
              socket.emit("cursor-change", {
                roomId,
                position: {
                  lineNumber: event.position.lineNumber,
                  column: event.position.column,
                },
              });
            });
          }}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            padding: { top: 10 },
            smoothScrolling: true,
          }}
        />
      </div>
    </section>
  );
}
