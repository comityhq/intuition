export class GatewayError extends Error {
  constructor(public readonly status: number, message = `gateway error ${status}`) {
    super(message);
    this.name = "GatewayError";
  }
}
