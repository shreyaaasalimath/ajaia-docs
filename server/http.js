// Small HTTP helpers shared by every route module.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Wrap async handlers so thrown errors reach the error middleware.
export const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
