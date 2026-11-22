import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DumpView } from "../../shared/types.ts";
import { api, unwrap } from "./api.ts";

const dumpsKey = ["dumps"] as const;

/** The inbox. Polls every 2s only while something is still being looked up. */
export function useDumps() {
  return useQuery({
    queryKey: dumpsKey,
    queryFn: async () => (await unwrap(api.dumps.$get())).dumps,
    refetchInterval: (query) => (query.state.data?.some((d) => d.status === "extracting") ? 2000 : false),
  });
}

export function useAddDump() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (text: string) =>
      (await unwrap(api.dumps.$post({ json: { text } }, { headers: { "idempotency-key": crypto.randomUUID() } }))).dump,
    onSuccess: (dump) => {
      qc.setQueryData<DumpView[]>(dumpsKey, (current) => [dump, ...(current ?? [])]);
      // A new word may join today's session if it hasn't started yet.
      void qc.invalidateQueries({ queryKey: ["session", "today"] });
    },
  });
}
