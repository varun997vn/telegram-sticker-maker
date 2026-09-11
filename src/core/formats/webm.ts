import { FormatParseError } from './errors.ts';

/**
 * A minimal EBML/Matroska reader for verifying exported video stickers.
 *
 * It walks only the elements Telegram's rules depend on — the video track's
 * codec and pixel dimensions, the duration, the frame count and whether an
 * audio track sneaked in — and skips everything else by its declared size.
 *
 * Format reference: https://www.matroska.org/technical/elements.html
 */

const ID = {
  ebmlHeader: 0x1a45dfa3,
  segment: 0x18538067,
  info: 0x1549a966,
  timecodeScale: 0x2ad7b1,
  duration: 0x4489,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  trackNumber: 0xd7,
  trackType: 0x83,
  codecId: 0x86,
  defaultDuration: 0x23e383,
  video: 0xe0,
  pixelWidth: 0xb0,
  pixelHeight: 0xba,
  cluster: 0x1f43b675,
  timecode: 0xe7,
  simpleBlock: 0xa3,
  blockGroup: 0xa0,
  block: 0xa1,
} as const;

const MASTER_IDS = new Set<number>([
  ID.segment,
  ID.info,
  ID.tracks,
  ID.trackEntry,
  ID.video,
  ID.cluster,
  ID.blockGroup,
]);

const TRACK_TYPE_VIDEO = 1;
const TRACK_TYPE_AUDIO = 2;

const DEFAULT_TIMECODE_SCALE_NS = 1_000_000;

export interface WebMVideoTrack {
  readonly trackNumber: number;
  readonly codecId: string;
  readonly width: number;
  readonly height: number;
  /** From DefaultDuration, when the muxer wrote one. */
  readonly frameDurationMs: number | null;
}

export interface WebMInfo {
  readonly byteLength: number;
  readonly timecodeScaleNs: number;
  /** From the Info element, or derived from block timestamps as a fallback. */
  readonly durationMs: number | null;
  readonly video: WebMVideoTrack | null;
  readonly hasAudio: boolean;
  readonly videoFrameCount: number;
  readonly frameRate: number | null;
}

interface Reader {
  readonly bytes: Uint8Array;
  readonly view: DataView;
}

interface VInt {
  readonly value: number;
  readonly length: number;
  readonly unknown: boolean;
}

function vintLength(firstByte: number): number {
  for (let length = 1; length <= 8; length += 1) {
    if ((firstByte & (0x80 >> (length - 1))) !== 0) return length;
  }
  throw new FormatParseError('Invalid EBML variable-size integer: no length marker');
}

/** Element IDs keep their length marker bits; sizes have theirs stripped. */
function readElementId(r: Reader, offset: number): VInt {
  const first = r.bytes[offset];
  if (first === undefined) throw new FormatParseError('Unexpected end of file reading element id');

  const length = vintLength(first);
  if (offset + length > r.bytes.byteLength) {
    throw new FormatParseError('Unexpected end of file reading element id');
  }

  let value = 0;
  for (let i = 0; i < length; i += 1) {
    value = value * 256 + (r.bytes[offset + i] as number);
  }
  return { value, length, unknown: false };
}

function readVintSize(r: Reader, offset: number): VInt {
  const first = r.bytes[offset];
  if (first === undefined) throw new FormatParseError('Unexpected end of file reading element size');

  const length = vintLength(first);
  if (offset + length > r.bytes.byteLength) {
    throw new FormatParseError('Unexpected end of file reading element size');
  }

  let value = first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i += 1) {
    const byte = r.bytes[offset + i] as number;
    value = value * 256 + byte;
    if (byte !== 0xff) allOnes = false;
  }

  return { value, length, unknown: allOnes };
}

function readUint(r: Reader, start: number, end: number): number {
  let value = 0;
  for (let i = start; i < end; i += 1) {
    value = value * 256 + (r.bytes[i] as number);
  }
  return value;
}

function readFloat(r: Reader, start: number, end: number): number {
  const length = end - start;
  if (length === 4) return r.view.getFloat32(start, false);
  if (length === 8) return r.view.getFloat64(start, false);
  throw new FormatParseError(`Unsupported EBML float width: ${length} bytes`);
}

function readAscii(r: Reader, start: number, end: number): string {
  let out = '';
  for (let i = start; i < end; i += 1) {
    const byte = r.bytes[i] as number;
    if (byte === 0) break; // strings are zero-padded
    out += String.fromCharCode(byte);
  }
  return out;
}

interface ParseState {
  timecodeScaleNs: number;
  durationTicks: number | null;
  hasAudio: boolean;
  videoFrameCount: number;
  maxBlockTimecode: number;
  clusterTimecode: number;
  videoTrackNumber: number | null;
  video: {
    trackNumber: number | null;
    codecId: string;
    width: number;
    height: number;
    defaultDurationNs: number | null;
  } | null;
  // Scratch for the TrackEntry currently being walked.
  track: {
    number: number | null;
    type: number | null;
    codecId: string;
    defaultDurationNs: number | null;
    width: number;
    height: number;
  } | null;
}

function readBlockHeader(r: Reader, start: number, end: number): { track: number; timecode: number } | null {
  if (start >= end) return null;
  const track = readVintSize(r, start);
  const timecodeAt = start + track.length;
  if (timecodeAt + 2 > end) return null;
  return { track: track.value, timecode: r.view.getInt16(timecodeAt, false) };
}

function walk(r: Reader, start: number, end: number, state: ParseState, depth: number): void {
  if (depth > 16) return; // structural guard against pathological nesting

  let offset = start;
  while (offset < end) {
    let id: VInt;
    let size: VInt;
    try {
      id = readElementId(r, offset);
      size = readVintSize(r, offset + id.length);
    } catch {
      return; // truncated tail: keep whatever was parsed so far
    }

    const contentStart = offset + id.length + size.length;
    // An unknown-size master element runs to the end of its parent. Its
    // siblings then appear as children, which is harmless here because every
    // element of interest is looked up by id rather than by position.
    const contentEnd = size.unknown ? end : Math.min(contentStart + size.value, end);
    if (contentEnd < contentStart) return;

    switch (id.value) {
      case ID.timecodeScale:
        state.timecodeScaleNs = readUint(r, contentStart, contentEnd);
        break;
      case ID.duration:
        state.durationTicks = readFloat(r, contentStart, contentEnd);
        break;
      case ID.trackNumber:
        if (state.track) state.track.number = readUint(r, contentStart, contentEnd);
        break;
      case ID.trackType: {
        const type = readUint(r, contentStart, contentEnd);
        if (state.track) state.track.type = type;
        if (type === TRACK_TYPE_AUDIO) state.hasAudio = true;
        break;
      }
      case ID.codecId:
        if (state.track) state.track.codecId = readAscii(r, contentStart, contentEnd);
        break;
      case ID.defaultDuration:
        if (state.track) state.track.defaultDurationNs = readUint(r, contentStart, contentEnd);
        break;
      case ID.pixelWidth:
        if (state.track) state.track.width = readUint(r, contentStart, contentEnd);
        break;
      case ID.pixelHeight:
        if (state.track) state.track.height = readUint(r, contentStart, contentEnd);
        break;
      case ID.timecode:
        state.clusterTimecode = readUint(r, contentStart, contentEnd);
        break;
      case ID.simpleBlock:
      case ID.block: {
        const header = readBlockHeader(r, contentStart, contentEnd);
        if (header && (state.videoTrackNumber === null || header.track === state.videoTrackNumber)) {
          state.videoFrameCount += 1;
          state.maxBlockTimecode = Math.max(
            state.maxBlockTimecode,
            state.clusterTimecode + header.timecode,
          );
        }
        break;
      }
      default:
        break;
    }

    if (MASTER_IDS.has(id.value)) {
      const enteringTrack = id.value === ID.trackEntry;
      if (enteringTrack) {
        state.track = { number: null, type: null, codecId: '', defaultDurationNs: null, width: 0, height: 0 };
      }

      walk(r, contentStart, contentEnd, state, depth + 1);

      if (enteringTrack && state.track) {
        const track = state.track;
        if (track.type === TRACK_TYPE_VIDEO && state.video === null) {
          state.video = {
            trackNumber: track.number,
            codecId: track.codecId,
            width: track.width,
            height: track.height,
            defaultDurationNs: track.defaultDurationNs,
          };
          state.videoTrackNumber = track.number;
        }
        state.track = null;
      }
    }

    const next = size.unknown ? contentEnd : contentStart + size.value;
    if (next <= offset) return; // zero-length or malformed element: stop rather than spin
    offset = next;
  }
}

export function isWebM(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  );
}

export function parseWebM(input: Uint8Array | ArrayBuffer): WebMInfo {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);

  if (!isWebM(bytes)) {
    throw new FormatParseError('Missing EBML header signature');
  }

  const r: Reader = {
    bytes,
    view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
  };

  const state: ParseState = {
    timecodeScaleNs: DEFAULT_TIMECODE_SCALE_NS,
    durationTicks: null,
    hasAudio: false,
    videoFrameCount: 0,
    maxBlockTimecode: 0,
    clusterTimecode: 0,
    videoTrackNumber: null,
    video: null,
    track: null,
  };

  walk(r, 0, bytes.byteLength, state, 0);

  const msPerTick = state.timecodeScaleNs / 1_000_000;
  const frameDurationMs =
    state.video?.defaultDurationNs != null ? state.video.defaultDurationNs / 1_000_000 : null;

  let durationMs: number | null = null;
  if (state.durationTicks !== null) {
    durationMs = state.durationTicks * msPerTick;
  } else if (state.videoFrameCount > 0) {
    // Live-muxed files often omit Duration; the last block plus one frame is
    // the best available answer.
    durationMs = state.maxBlockTimecode * msPerTick + (frameDurationMs ?? 0);
  }

  let frameRate: number | null = null;
  if (frameDurationMs !== null && frameDurationMs > 0) {
    frameRate = 1000 / frameDurationMs;
  } else if (durationMs !== null && durationMs > 0 && state.videoFrameCount > 0) {
    frameRate = state.videoFrameCount / (durationMs / 1000);
  }

  const video: WebMVideoTrack | null =
    state.video === null
      ? null
      : {
          trackNumber: state.video.trackNumber ?? 1,
          codecId: state.video.codecId,
          width: state.video.width,
          height: state.video.height,
          frameDurationMs,
        };

  return {
    byteLength: bytes.byteLength,
    timecodeScaleNs: state.timecodeScaleNs,
    durationMs,
    video,
    hasAudio: state.hasAudio,
    videoFrameCount: state.videoFrameCount,
    frameRate,
  };
}
