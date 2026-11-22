import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Me } from "../../shared/types.ts";
import { api, ApiError, unwrap } from "./api.ts";

const meKey = ["me"] as const;

/** The signed-in user, or `null` when there is no session. */
export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: async (): Promise<Me | null> => {
      try {
        return (await unwrap(api.me.$get())).user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

type Credentials = { email: string; password: string };

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (json: Credentials) => unwrap(api.auth.login.$post({ json })),
    onSuccess: ({ user }) => qc.setQueryData(meKey, user),
  });
}

export function useSignup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (json: Credentials) =>
      unwrap(
        api.auth.signup.$post({
          json: { ...json, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        }),
      ),
    onSuccess: ({ user }) => qc.setQueryData(meKey, user),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await api.auth.logout.$post();
      if (!res.ok) throw new ApiError(res.status, "internal", "Couldn't sign out. Try again.");
    },
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(meKey, null);
    },
  });
}
