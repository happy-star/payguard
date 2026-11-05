export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Unexpected error.";
}
