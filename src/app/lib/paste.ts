// Paste, anywhere (FRONTEND.md): Ctrl+V on any tab screen becomes a dump.
// No field to find, no button to press first. Pastes into a field are left
// alone, so the capture field, the fix field and answers behave normally.
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { useToast } from "../components/Toast.tsx";
import { readPaste } from "./clipboard.ts";
import { useAddDump, useAddImage } from "./pool.ts";

/** Typing somewhere: the paste belongs to that field. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest("input, textarea, select, [contenteditable]") !== null;
}

export function usePasteAnywhere() {
  const add = useAddDump();
  const addImage = useAddImage();
  const toast = useToast();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // The listener is registered once; it reads the latest of these through refs.
  const latest = useRef({ add, addImage, toast, navigate, pathname });
  latest.current = { add, addImage, toast, navigate, pathname };

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (isEditable(event.target) || !event.clipboardData) return;
      const pasted = readPaste(event.clipboardData);
      if (!pasted) return;
      event.preventDefault();
      const { add, addImage, toast, navigate, pathname } = latest.current;
      const done = {
        onSuccess: () => {
          toast("Added to your inbox.");
          if (pathname !== "/") navigate("/");
        },
        onError: (err: Error) => toast(err.message),
      };

      if (pasted.kind === "image") return addImage.mutate(pasted.file, done);
      // A link goes in as it is: the server fetches the page.
      if (!add.isPending) add.mutate(pasted.kind === "url" ? pasted.url : pasted.text, done);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);
}
