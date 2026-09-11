/**
 * A minimal EBML writer, enough to emit WebM files the parser can be tested
 * against without shipping binary fixtures into the repository.
 */

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

/** Element ids are written verbatim: their length marker is part of the value. */
export function encodeId(id: number): Uint8Array {
  const length = id <= 0xff ? 1 : id <= 0xffff ? 2 : id <= 0xffffff ? 3 : 4;
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    out[length - 1 - i] = (id >>> (8 * i)) & 0xff;
  }
  return out;
}

/** Sizes are variable-length integers whose length marker is stripped from the value. */
export function encodeSize(value: number): Uint8Array {
  let length = 1;
  while (length <= 8 && value >= 2 ** (7 * length) - 1) {
    length += 1;
  }
  if (length > 8) throw new Error(`Value ${value} is too large for an EBML size`);

  const out = new Uint8Array(length);
  let remaining = value;
  for (let i = length - 1; i >= 0; i -= 1) {
    out[i] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  out[0] = (out[0] as number) | (0x80 >> (length - 1));
  return out;
}

export function element(id: number, payload: Uint8Array): Uint8Array {
  return concat([encodeId(id), encodeSize(payload.byteLength), payload]);
}

export function uintPayload(value: number): Uint8Array {
  const bytes: number[] = [];
  let remaining = value;
  do {
    bytes.unshift(remaining % 256);
    remaining = Math.floor(remaining / 256);
  } while (remaining > 0);
  return Uint8Array.from(bytes);
}

export function float64Payload(value: number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, value, false);
  return out;
}

export function asciiPayload(text: string): Uint8Array {
  return Uint8Array.from([...text].map((c) => c.charCodeAt(0)));
}

export function simpleBlock(trackNumber: number, relativeTimecodeMs: number, payloadBytes = 4): Uint8Array {
  const timecode = new Uint8Array(2);
  new DataView(timecode.buffer).setInt16(0, relativeTimecodeMs, false);
  return element(
    0xa3,
    concat([encodeSize(trackNumber), timecode, Uint8Array.from([0x80]), new Uint8Array(payloadBytes)]),
  );
}

export interface WebMFixtureOptions {
  readonly width?: number;
  readonly height?: number;
  readonly codecId?: string;
  readonly durationMs?: number | null;
  readonly timecodeScaleNs?: number;
  readonly frameDurationNs?: number | null;
  readonly frameTimecodesMs?: readonly number[];
  readonly withAudioTrack?: boolean;
}

export function buildWebM(options: WebMFixtureOptions = {}): Uint8Array {
  const {
    width = 512,
    height = 288,
    codecId = 'V_VP9',
    durationMs = 3000,
    timecodeScaleNs = 1_000_000,
    frameDurationNs = 33_333_333,
    frameTimecodesMs,
    withAudioTrack = false,
  } = options;

  const timecodes = frameTimecodesMs ?? [0, 33, 66];

  const header = element(
    0x1a45dfa3,
    concat([
      element(0x4286, uintPayload(1)), // EBMLVersion
      element(0x4282, asciiPayload('webm')), // DocType
    ]),
  );

  const infoChildren = [element(0x2ad7b1, uintPayload(timecodeScaleNs))];
  if (durationMs !== null) {
    infoChildren.push(element(0x4489, float64Payload(durationMs / (timecodeScaleNs / 1_000_000))));
  }
  const info = element(0x1549a966, concat(infoChildren));

  const videoTrackChildren = [
    element(0xd7, uintPayload(1)), // TrackNumber
    element(0x83, uintPayload(1)), // TrackType: video
    element(0x86, asciiPayload(codecId)),
  ];
  if (frameDurationNs !== null) {
    videoTrackChildren.push(element(0x23e383, uintPayload(frameDurationNs)));
  }
  videoTrackChildren.push(
    element(0xe0, concat([element(0xb0, uintPayload(width)), element(0xba, uintPayload(height))])),
  );

  const trackEntries = [element(0xae, concat(videoTrackChildren))];
  if (withAudioTrack) {
    trackEntries.push(
      element(
        0xae,
        concat([
          element(0xd7, uintPayload(2)),
          element(0x83, uintPayload(2)), // TrackType: audio
          element(0x86, asciiPayload('A_OPUS')),
        ]),
      ),
    );
  }

  const tracks = element(0x1654ae6b, concat(trackEntries));

  const cluster = element(
    0x1f43b675,
    concat([
      element(0xe7, uintPayload(0)), // cluster timecode
      ...timecodes.map((timecode) => simpleBlock(1, timecode)),
    ]),
  );

  return concat([header, element(0x18538067, concat([info, tracks, cluster]))]);
}
