export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
export const unavailable = () => new ApiError(503, 'configuration_unavailable');
export const unauthorized = () => new ApiError(401, 'authentication_required');
