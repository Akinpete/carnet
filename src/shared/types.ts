// Imported by both the app and the server. Keep it free of runtime code
// that depends on either platform.

/** The single error envelope every API error uses. `code` is stable. */
export type ErrorBody = {
  error: { code: string; message: string; field?: string };
};

export type Me = {
  id: string;
  email: string;
  timezone: string;
  createdAt: number;
};
