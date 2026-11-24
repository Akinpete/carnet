import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AnswerResult } from "../../shared/types.ts";
import { api, ApiError, unwrap } from "./api.ts";

export const todayKey = ["session", "today"] as const;

/** Today's session state; also feeds the Review tab badge. */
export function useToday() {
  return useQuery({
    queryKey: todayKey,
    queryFn: () => unwrap(api.sessions.today.$get()),
    staleTime: 60 * 1000,
  });
}

/** Gets (or generates, once per day) today's cards. */
export function useStartSession() {
  return useMutation({
    mutationFn: async () =>
      (await unwrap(api.sessions[":slot"].start.$post({ param: { slot: "morning" } }))).session,
  });
}

export type AnswerInput = {
  sessionId: string;
  wordId: string;
  choice?: number;
  text?: string;
  dontKnow?: true;
  latencyMs: number;
  /** Same key on every retry, so a flaky network never records an answer twice. */
  idempotencyKey: string;
};

export function useAnswer() {
  return useMutation({
    mutationFn: ({ sessionId, idempotencyKey, ...json }: AnswerInput): Promise<AnswerResult> =>
      unwrap(
        api.sessions[":id"].answer.$post({ param: { id: sessionId }, json }, { headers: { "idempotency-key": idempotencyKey } }),
      ),
    // Retry a dropped connection or a server fault, not a refusal, and never a
    // failed grading call: the learner chooses to try that again.
    retry: (count, err) =>
      count < 3 && err instanceof ApiError && (err.status === 0 || (err.status >= 500 && err.code !== "grading_failed")),
  });
}

export function useCompleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => unwrap(api.sessions[":id"].complete.$post({ param: { id: sessionId } })),
    onSettled: () => qc.invalidateQueries({ queryKey: todayKey }),
  });
}
