// Speech input for speaking cards (FRONTEND.md, Speech input). The platform
// picks the path: on iOS every browser is WebKit, whose Web Speech is
// unreliable, so the clip goes to POST /transcribe. Elsewhere Web Speech
// (fr-FR) gives a live transcript for free; if it fails, cloud takes over.
// Either way the learner sees the text and can fix it before sending.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, unwrap } from "./api.ts";

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

// Web Speech isn't in every DOM typing; just what's used here.
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Once Web Speech fails here, this device uses cloud transcription for the rest of the visit. */
let webSpeechBroken = false;

export type SpeechPath = "cloud" | "webspeech" | "none";

export function speechPath(): SpeechPath {
  const canRecord = typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  if (isIOS()) return canRecord ? "cloud" : "none";
  if (recognitionCtor() && !webSpeechBroken) return "webspeech";
  return canRecord ? "cloud" : "none";
}

const RECORD_TYPES = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
const MAX_SECONDS = 30;
const BARS = 11;

export type SpeechState = "idle" | "listening" | "transcribing" | "done" | "error";

export function useSpeech() {
  const [state, setState] = useState<SpeechState>("idle");
  const [interim, setInterim] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0));
  const [path, setPath] = useState<SpeechPath>(() => speechPath());

  const recognition = useRef<Recognition | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const frame = useRef<number | null>(null);
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null);

  const release = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (limit.current) clearTimeout(limit.current);
    limit.current = null;
    recorder.current?.stream.getTracks().forEach((t) => t.stop());
    recorder.current = null;
    void audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;
    setLevels(Array(BARS).fill(0));
  }, []);

  useEffect(
    () => () => {
      recognition.current?.abort();
      release();
    },
    [release],
  );

  const fail = useCallback((message: string) => {
    setError(message);
    setState("error");
  }, []);

  /** The level meter: loudness over the last moments, from the live stream. */
  const meter = useCallback((stream: MediaStream) => {
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      audioCtx.current = ctx;
      const data = new Uint8Array(analyser.fftSize);
      let last = 0;
      const tick = (now: number) => {
        frame.current = requestAnimationFrame(tick);
        if (now - last < 70) return;
        last = now;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        const rms = Math.min(1, Math.sqrt(sum / data.length) * 4);
        setLevels((l) => [...l.slice(1), rms]);
      };
      frame.current = requestAnimationFrame(tick);
    } catch {
      // No meter is fine; the recording still works.
    }
  }, []);

  const startCloud = useCallback(async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return fail("Carnet needs the microphone to hear you. Allow it in your settings, or type it instead.");
    }
    const type = RECORD_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = async () => {
      const blob = new Blob(chunks, { type: rec.mimeType || type || "audio/webm" });
      release();
      if (blob.size === 0) return setState("idle");
      setState("transcribing");
      try {
        const ext = blob.type.includes("mp4") ? "m4a" : "webm";
        const file = new File([blob], `answer.${ext}`, { type: blob.type });
        const { text: heard } = await unwrap(api.transcribe.$post({ form: { audio: file } }));
        if (!heard.trim()) return fail("Didn't catch anything. Try again, a little closer.");
        setText(heard.trim());
        setState("done");
      } catch (err) {
        fail(err instanceof ApiError ? err.message : "Couldn't hear that just now. Try again, or type it instead.");
      }
    };
    recorder.current = rec;
    rec.start();
    meter(stream);
    setState("listening");
    limit.current = setTimeout(() => rec.state === "recording" && rec.stop(), MAX_SECONDS * 1000);
  }, [fail, meter, release]);

  const startWebSpeech = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "fr-FR";
    rec.interimResults = true;
    rec.continuous = false;
    let final = "";
    let failed = false;
    rec.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const said = result?.[0]?.transcript ?? "";
        if (result?.isFinal) final += said;
        else live += said;
      }
      setInterim((final + live).trim());
    };
    rec.onerror = (e) => {
      failed = true;
      if (e.error === "no-speech" || e.error === "aborted") return fail("Didn't catch anything. Try again.");
      if (e.error === "not-allowed") return fail("Carnet needs the microphone to hear you. Allow it in your settings, or type it instead.");
      // The recognition service itself failed: use cloud transcription from now on.
      webSpeechBroken = true;
      setPath(speechPath());
      fail("Speech recognition isn't working in this browser. Try again: Carnet will listen another way.");
    };
    rec.onend = () => {
      recognition.current = null;
      if (failed) return;
      const heard = final.trim();
      if (!heard) return fail("Didn't catch anything. Try again.");
      setText(heard);
      setState("done");
    };
    recognition.current = rec;
    rec.start();
    setState("listening");
  }, [fail]);

  const start = useCallback(() => {
    setError(null);
    setInterim("");
    setText("");
    if (path === "webspeech") startWebSpeech();
    else if (path === "cloud") void startCloud();
  }, [path, startCloud, startWebSpeech]);

  const stop = useCallback(() => {
    if (recognition.current) recognition.current.stop();
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  const reset = useCallback(() => {
    recognition.current?.abort();
    release();
    setState("idle");
    setInterim("");
    setText("");
    setError(null);
  }, [release]);

  return { path, state, interim, text, error, levels, start, stop, reset };
}
