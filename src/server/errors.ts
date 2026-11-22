export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 500;

/** Thrown by handlers; `onError` maps it to the error envelope. */
export class AppError extends Error {
  readonly status: ErrorStatus;
  readonly code: string;
  readonly field: string | undefined;

  constructor(status: ErrorStatus, code: string, message: string, field?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}
