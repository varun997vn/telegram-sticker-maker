/** Thrown when a byte stream does not match the format it claims to be. */
export class FormatParseError extends Error {
  override readonly name = 'FormatParseError';

  constructor(message: string) {
    super(message);
  }
}
