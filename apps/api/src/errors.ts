export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code = "request_error",
  ) {
    super(message);
  }
}
export function requireRow<T>(row: T | undefined, message = "Not found"): T {
  if (!row) throw new ApiError(404, message, "not_found");
  return row;
}
