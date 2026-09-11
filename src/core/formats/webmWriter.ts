/**
 * A minimal WebM muxer for VP9 video.
 *
 * ffmpeg.wasm cannot be used to produce Telegram's video stickers: the libvpx
 * in @ffmpeg/core 0.12.10 traps with "memory access out of bounds" on any
 * non-trivial input, at any quality setting. The browser's own VideoEncoder
 * encodes VP9 perfectly well, but hands back bare frames — so the container
 * has to be written here.
 *
 * Only what Telegram needs is emitted: one video track, no audio, a known
 * duration and clusters of frames. It is validated against the WebM parser in
 * `webm.ts`, and, end to end, by ffmpeg successfully decoding what it writes.
 */

const ID = {
  ebml: 0x1a45dfa3,
  ebmlVersion: 0x4286,
  ebmlReadVersion: 0x42f7,
  ebmlMaxIdLength: 0x42f2,
  ebmlMaxSizeLength: 0x42f3,
  docType: 0x4282,
  docTypeVersion: 0x4287,
  docTypeReadVersion: 0x4285,
  segment: 0x18538067,
  info: 0x1549a966,
  timecodeScale: 0x2ad7b1,
  muxingApp: 0x4d80,
  writingApp: 0x5741,
  duration: 0x4489,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  trackNumber: 0xd7,
  trackUid: 0x73c5,
  trackType: 0x83,
  flagLacing: 0x9c,
  codecId: 0x86,
  defaultDuration: 0x23e383,
  video: 0xe0,
  pixelWidth: 0xb0,
  pixelHeight: 0xba,
  cluster: 0x1f43b675,
  timecode: 0xe7,
  simpleBlock: 0xa3,
} as const;

const TRACK_NUMBER = 1;
const TIMECODE_SCALE_NS = 1_000_000; // one tick per millisecond

/** Start a new cluster at least this often; block timecodes are 16-bit signed. */
const CLUSTER_DURATION_MS = 1000;

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

/** Element ids are written verbatim; their length marker is part of the value. */
function encodeId(id: number): Uint8Array {
  const length = id <= 0xff ? 1 : id <= 0xffff ? 2 : id <= 0xffffff ? 3 : 4;
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    out[length - 1 - i] = (id >>> (8 * i)) & 0xff;
  }
  return out;
}

/** Sizes are variable-length integers with the length marker stripped out. */
export function encodeSize(value: number): Uint8Array {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`EBML size must be a non-negative number, got ${value}`);
  }

  let length = 1;
  // The all-ones pattern is reserved to mean "unknown", so a value that would
  // fill the field has to spill into another byte.
  while (length <= 8 && value >= 2 ** (7 * length) - 1) {
    length += 1;
  }
  if (length > 8) throw new RangeError(`Value ${value} is too large for an EBML size`);

  const out = new Uint8Array(length);
  let remaining = value;
  for (let i = length - 1; i >= 0; i -= 1) {
    out[i] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  out[0] = (out[0] as number) | (0x80 >> (length - 1));
  return out;
}

function element(id: number, payload: Uint8Array): Uint8Array {
  return concat([encodeId(id), encodeSize(payload.byteLength), payload]);
}

function uint(value: number): Uint8Array {
  const bytes: number[] = [];
  let remaining = Math.round(value);
  do {
    bytes.unshift(remaining % 256);
    remaining = Math.floor(remaining / 256);
  } while (remaining > 0);
  return Uint8Array.from(bytes);
}

function float64(value: number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, value, false);
  return out;
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from([...text].map((c) => c.charCodeAt(0)));
}

export interface WebMFrame {
  readonly data: Uint8Array;
  /** Presentation time in milliseconds from the start of the file. */
  readonly timestampMs: number;
  readonly isKeyFrame: boolean;
}

export interface WriteWebMOptions {
  readonly width: number;
  readonly height: number;
  readonly frames: readonly WebMFrame[];
  /** Total length in milliseconds; defaults to one frame past the last one. */
  readonly durationMs?: number;
  /** Nominal frame duration, written as DefaultDuration. */
  readonly frameDurationMs?: number;
  readonly codecId?: string;
  readonly writingApp?: string;
}

function simpleBlock(frame: WebMFrame, clusterTimecodeMs: number): Uint8Array {
  const relative = Math.round(frame.timestampMs - clusterTimecodeMs);
  if (relative < -32_768 || relative > 32_767) {
    throw new RangeError(`Block timecode ${relative}ms does not fit in a SimpleBlock`);
  }

  const header = new Uint8Array(3);
  new DataView(header.buffer).setInt16(0, relative, false);
  // Bit 7 marks a keyframe; the rest of the flags stay clear.
  header[2] = frame.isKeyFrame ? 0x80 : 0x00;

  return element(ID.simpleBlock, concat([encodeSize(TRACK_NUMBER), header, frame.data]));
}

export function writeWebM(options: WriteWebMOptions): Uint8Array {
  const {
    width,
    height,
    frames,
    frameDurationMs,
    codecId = 'V_VP9',
    writingApp = 'sticker-maker',
  } = options;

  if (frames.length === 0) {
    throw new RangeError('A WebM file needs at least one frame');
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`Invalid video dimensions ${width}x${height}`);
  }
  if (!frames[0]?.isKeyFrame) {
    throw new RangeError('The first frame of a WebM file must be a keyframe');
  }

  const header = element(
    ID.ebml,
    concat([
      element(ID.ebmlVersion, uint(1)),
      element(ID.ebmlReadVersion, uint(1)),
      element(ID.ebmlMaxIdLength, uint(4)),
      element(ID.ebmlMaxSizeLength, uint(8)),
      element(ID.docType, ascii('webm')),
      element(ID.docTypeVersion, uint(2)),
      element(ID.docTypeReadVersion, uint(2)),
    ]),
  );

  const lastTimestamp = frames.at(-1)?.timestampMs ?? 0;
  const durationMs = options.durationMs ?? lastTimestamp + (frameDurationMs ?? 0);

  const info = element(
    ID.info,
    concat([
      element(ID.timecodeScale, uint(TIMECODE_SCALE_NS)),
      element(ID.muxingApp, ascii(writingApp)),
      element(ID.writingApp, ascii(writingApp)),
      // Duration is in timecode-scale units, which here is milliseconds.
      element(ID.duration, float64(durationMs)),
    ]),
  );

  const videoChildren = [
    element(ID.trackNumber, uint(TRACK_NUMBER)),
    element(ID.trackUid, uint(TRACK_NUMBER)),
    element(ID.trackType, uint(1)), // video
    element(ID.flagLacing, uint(0)),
    element(ID.codecId, ascii(codecId)),
  ];

  if (frameDurationMs !== undefined && frameDurationMs > 0) {
    videoChildren.push(element(ID.defaultDuration, uint(frameDurationMs * 1_000_000)));
  }

  videoChildren.push(
    element(ID.video, concat([element(ID.pixelWidth, uint(width)), element(ID.pixelHeight, uint(height))])),
  );

  const tracks = element(ID.tracks, element(ID.trackEntry, concat(videoChildren)));

  // Clusters are capped in length because a block's timecode is a signed
  // 16-bit offset from its cluster, and a keyframe starts a new one cleanly.
  const clusters: Uint8Array[] = [];
  let current: Uint8Array[] = [];
  let clusterTimecodeMs = 0;

  const flush = () => {
    if (current.length === 0) return;
    clusters.push(
      element(ID.cluster, concat([element(ID.timecode, uint(clusterTimecodeMs)), ...current])),
    );
    current = [];
  };

  for (const frame of frames) {
    const startsCluster =
      current.length === 0 ||
      (frame.isKeyFrame && frame.timestampMs - clusterTimecodeMs >= CLUSTER_DURATION_MS);

    if (startsCluster && current.length > 0) flush();
    if (current.length === 0) clusterTimecodeMs = Math.round(frame.timestampMs);

    current.push(simpleBlock(frame, clusterTimecodeMs));
  }
  flush();

  return concat([header, element(ID.segment, concat([info, tracks, ...clusters]))]);
}
