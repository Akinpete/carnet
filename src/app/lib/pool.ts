import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { DumpDetail, DumpView } from "../../shared/types.ts";
import { api, ApiError, unwrap } from "./api.ts";
import { shrinkForUpload } from "./image.ts";

const dumpsKey = ["dumps"] as const;
const dumpKey = (id: string) => ["dump", id] as const;
const key = () => ({ headers: { "idempotency-key": crypto.randomUUID() } });

/** The inbox. Polls every 2s only while something is still being looked up. */
export function useDumps() {
  return useQuery({
    queryKey: dumpsKey,
    queryFn: async () => (await unwrap(api.dumps.$get())).dumps,
    refetchInterval: (query) => (query.state.data?.some((d) => d.status === "extracting") ? 2000 : false),
  });
}

/** One dump with what extraction found. Polls while it's being looked up. */
export function useDump(id: string) {
  return useQuery({
    queryKey: dumpKey(id),
    queryFn: async () => (await unwrap(api.dumps[":id"].$get({ param: { id } }))).dump,
    refetchInterval: (query) => (query.state.data?.status === "extracting" ? 2000 : false),
  });
}

/** After a dump changes: the inbox and today's session may both have moved. */
function refresh(qc: QueryClient, dump?: DumpDetail) {
  if (dump) qc.setQueryData(dumpKey(dump.id), dump);
  void qc.invalidateQueries({ queryKey: dumpsKey });
  void qc.invalidateQueries({ queryKey: ["session", "today"] });
}

export function useAddDump() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (text: string) => (await unwrap(api.dumps.$post({ json: { text } }, key()))).dump,
    onSuccess: (dump) => {
      qc.setQueryData<DumpView[]>(dumpsKey, (current) => [dump, ...(current ?? [])]);
      // A new word may join today's session if it hasn't started yet.
      void qc.invalidateQueries({ queryKey: ["session", "today"] });
    },
  });
}

/** A screenshot: shrunk in the browser, then uploaded. The server reads it. */
export function useAddImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (image: Blob) => {
      let file: File;
      try {
        file = await shrinkForUpload(image);
      } catch (err) {
        throw new ApiError(400, "invalid_input", err instanceof Error ? err.message : "Carnet can't read that image.");
      }
      return (await unwrap(api.dumps.image.$post({ form: { image: file } }, key()))).dump;
    },
    onSuccess: (dump) => {
      qc.setQueryData<DumpView[]>(dumpsKey, (current) => [dump, ...(current ?? [])]);
    },
  });
}

/** A voice note: uploaded as recorded; the server transcribes it and keeps only the text. */
export function useAddVoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (audio: Blob) => {
      const ext = audio.type.includes("mp4") ? "m4a" : audio.type.includes("ogg") ? "ogg" : "webm";
      const file = new File([audio], `voice-note.${ext}`, { type: audio.type });
      return (await unwrap(api.dumps.audio.$post({ form: { audio: file } }, key()))).dump;
    },
    onSuccess: (dump) => {
      qc.setQueryData<DumpView[]>(dumpsKey, (current) => [dump, ...(current ?? [])]);
    },
  });
}

/** Keep the ticked words: the only write to the pool from a reviewed dump. */
export function useCommitDump(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (wordIds: string[]) =>
      (await unwrap(api.dumps[":id"].commit.$post({ param: { id }, json: { wordIds } }, key()))).dump,
    onSuccess: (dump) => refresh(qc, dump),
  });
}

/** Swap a misread word for the right one. Resolves to the new word's id. */
export function useCorrectCandidate(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ wordId, text }: { wordId: string; text: string }) =>
      unwrap(api.dumps[":id"].candidates[":wordId"].$patch({ param: { id, wordId }, json: { text } }, key())),
    onSuccess: ({ dump }) => qc.setQueryData(dumpKey(dump.id), dump),
  });
}

export function useDiscardDump() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await unwrap(api.dumps[":id"].$delete({ param: { id } }, key()));
      return id;
    },
    onSuccess: (id) => {
      qc.removeQueries({ queryKey: dumpKey(id) });
      qc.setQueryData<DumpView[]>(dumpsKey, (current) => current?.filter((d) => d.id !== id));
      void qc.invalidateQueries({ queryKey: dumpsKey });
    },
  });
}
