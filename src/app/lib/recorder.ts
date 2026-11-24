// Voice notes: record with MediaRecorder, in whatever the browser does best
// (MP4/AAC on iPhone, WebM/Opus in Chrome). Whisper reads both.
import { useCallback, useEffect, useRef, useState } from "react";

/** A voice note is something you just heard, not a lecture. */
export const MAX_SECONDS = 60;

const PREFERRED = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];

function pickType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return PREFERRED.find((t) => MediaRecorder.isTypeSupported(t));
}

export type RecorderState = "idle" | "recording" | "unsupported";

/** `start` asks for the microphone; `stop` resolves with the recording, or null if it was empty. */
export function useRecorder(onDone: (audio: Blob) => void) {
  const [state, setState] = useState<RecorderState>(() =>
    typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia ? "unsupported" : "idle",
  );
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  const cleanUp = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    recorder.current?.stream.getTracks().forEach((t) => t.stop());
    recorder.current = null;
  }, []);

  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  const start = useCallback(async () => {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Carnet needs the microphone for voice notes. Allow it in your browser's settings and try again.");
      return;
    }
    const type = pickType();
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: rec.mimeType || type || "audio/webm" });
      cleanUp();
      setState("idle");
      setSeconds(0);
      if (blob.size > 0) done.current(blob);
    };
    recorder.current = rec;
    rec.start();
    setState("recording");
    const began = Date.now();
    timer.current = setInterval(() => {
      const s = Math.floor((Date.now() - began) / 1000);
      setSeconds(s);
      if (s >= MAX_SECONDS) stop();
    }, 250);
  }, [cleanUp, stop]);

  // Leaving the screen mid-recording releases the microphone.
  useEffect(() => () => cleanUp(), [cleanUp]);

  return { state, seconds, error, start, stop };
}
