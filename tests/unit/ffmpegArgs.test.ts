import { describe, expect, it } from 'vitest';
import {
  FRAME_PATTERN,
  buildEncodeAnimatedWebPArgs,
  buildExtractFramesArgs,
  formatRate,
  frameFileNames,
  seconds,
} from '@/core/ffmpeg/args.ts';
import { planFrames } from '@/core/framePlan.ts';
import { inputExtension } from '@/core/videoSource.ts';

const plan = planFrames({
  sourceDurationMs: 10_000,
  trimStartMs: 1500,
  trimEndMs: 4000,
  frameRate: 30,
  maxDurationMs: 3000,
  maxFrameRate: 30,
});

/** Read the value that follows a flag, so order-independent checks stay readable. */
function valueAfter(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

describe('seconds', () => {
  it.each([
    [0, '0.000'],
    [1500, '1.500'],
    [3000, '3.000'],
    [33.333, '0.033'],
  ])('%i ms -> %s', (input, expected) => {
    expect(seconds(input)).toBe(expected);
  });
});

describe('formatRate', () => {
  it('keeps whole rates whole', () => {
    expect(formatRate(30)).toBe('30');
    expect(formatRate(15)).toBe('15');
  });

  it('keeps precision for a derived fractional rate', () => {
    expect(formatRate(29.97)).toBe('29.970');
    expect(formatRate(120 / 3.5)).toBe('34.286');
  });
});

describe('frameFileNames', () => {
  it('numbers frames from one, zero padded to match the pattern', () => {
    expect(frameFileNames(3)).toEqual(['frame-0001.png', 'frame-0002.png', 'frame-0003.png']);
  });

  it('stays sortable past frame nine', () => {
    const names = frameFileNames(12);
    expect(names.at(-1)).toBe('frame-0012.png');
    expect([...names]).toEqual([...names].sort());
  });

  it('produces exactly the requested count', () => {
    expect(frameFileNames(90)).toHaveLength(90);
  });

  it.each([0, -1, 1.5])('rejects a frame count of %s', (count) => {
    expect(() => frameFileNames(count)).toThrow(RangeError);
  });
});

describe('buildExtractFramesArgs', () => {
  const size = { width: 512, height: 288 };

  it('seeks before the input so ffmpeg does not decode the whole lead-in', () => {
    const args = buildExtractFramesArgs({ plan, size });
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
  });

  it('passes the trim window from the plan', () => {
    const args = buildExtractFramesArgs({ plan, size });
    expect(valueAfter(args, '-ss')).toBe('1.500');
    expect(valueAfter(args, '-t')).toBe('2.500');
  });

  it('asks for exactly the planned number of frames', () => {
    const args = buildExtractFramesArgs({ plan, size });
    expect(valueAfter(args, '-frames:v')).toBe(String(plan.frameCount));
  });

  it('drops any audio stream', () => {
    expect(buildExtractFramesArgs({ plan, size })).toContain('-an');
  });

  it('writes the frame sequence the reader expects', () => {
    expect(buildExtractFramesArgs({ plan, size }).at(-1)).toBe(FRAME_PATTERN);
  });

  it('scales to the planned size', () => {
    const filters = valueAfter(buildExtractFramesArgs({ plan, size }), '-vf');
    expect(filters).toContain('scale=512:288');
  });

  it('sets the frame rate from the plan', () => {
    const filters = valueAfter(buildExtractFramesArgs({ plan, size }), '-vf');
    expect(filters).toContain('fps=30');
  });

  it('reads the whole selection and samples it sparsely when it is sped up', () => {
    // Twelve seconds compressed into three plays four times as fast, so a
    // thirty frame-per-second sticker samples the source at seven and a half.
    const long = planFrames({
      sourceDurationMs: 60_000,
      trimStartMs: 2000,
      trimEndMs: 14_000,
      frameRate: 30,
      maxDurationMs: 3000,
      maxFrameRate: 30,
    });
    const args = buildExtractFramesArgs({ plan: long, size });

    expect(valueAfter(args, '-ss')).toBe('2.000');
    expect(valueAfter(args, '-t')).toBe('12.000');
    expect(valueAfter(args, '-vf')).toContain('fps=7.500');
    expect(valueAfter(args, '-frames:v')).toBe('90');
  });

  it('reads only the selection when no speed-up is needed', () => {
    const args = buildExtractFramesArgs({ plan, size });
    expect(valueAfter(args, '-t')).toBe(seconds(plan.sourceSpanMs));
    expect(valueAfter(args, '-t')).toBe(seconds(plan.durationMs));
  });

  it('crops before scaling, so the crop is in source pixels', () => {
    const filters = valueAfter(
      buildExtractFramesArgs({ plan, size, crop: { x: 420, y: 0, width: 1080, height: 1080 } }),
      '-vf',
    );
    expect(filters).toBe('crop=1080:1080:420:0,fps=30,scale=512:288');
  });

  it('rounds a fractional crop, which ffmpeg will not accept', () => {
    const filters = valueAfter(
      buildExtractFramesArgs({
        plan,
        size,
        crop: { x: 419.5, y: 0.4, width: 1080.6, height: 1079.5 },
      }),
      '-vf',
    );
    expect(filters).toContain('crop=1081:1080:420:0');
  });

  it('pads rather than stretching when asked, keeping the padding transparent', () => {
    const filters = valueAfter(
      buildExtractFramesArgs({ plan, size: { width: 512, height: 512 }, pad: true }),
      '-vf',
    );
    expect(filters).toContain('force_original_aspect_ratio=decrease');
    expect(filters).toContain('pad=512:512:-1:-1:color=#00000000');
  });

  it('stretches to the exact size when padding is off', () => {
    const filters = valueAfter(buildExtractFramesArgs({ plan, size }), '-vf');
    expect(filters).not.toContain('pad=');
  });

  it('uses the input filename it is given', () => {
    expect(valueAfter(buildExtractFramesArgs({ plan, size, inputFile: 'input.mov' }), '-i')).toBe(
      'input.mov',
    );
  });

  it('produces a fully specified command line', () => {
    expect(buildExtractFramesArgs({ plan, size })).toEqual([
      '-ss', '1.500',
      '-t', '2.500',
      '-i', 'input',
      '-an',
      '-vf', 'fps=30,scale=512:288',
      '-frames:v', '75',
      '-f', 'image2',
      'frame-%04d.png',
    ]);
  });
});

describe('buildEncodeAnimatedWebPArgs', () => {
  it('puts every option before the output file', () => {
    // ffmpeg applies options to the output that follows them, so anything
    // after the filename is read as settings for a second, missing output.
    const args = buildEncodeAnimatedWebPArgs({ frameRate: 24, quality: 75, outputFile: 's.webp' });
    expect(args.at(-1)).toBe('s.webp');
    expect(args.filter((arg) => arg.startsWith('-')).every((flag) => args.indexOf(flag) < args.length - 1)).toBe(true);
  });

  it('uses the animated WebP encoder, not the still one', () => {
    expect(valueAfter(buildEncodeAnimatedWebPArgs({ frameRate: 24, quality: 75 }), '-c:v')).toBe(
      'libwebp_anim',
    );
  });

  it('encodes lossy, since lossless would never fit the budget', () => {
    expect(valueAfter(buildEncodeAnimatedWebPArgs({ frameRate: 24, quality: 75 }), '-lossless')).toBe('0');
  });

  it('passes the quality through', () => {
    expect(valueAfter(buildEncodeAnimatedWebPArgs({ frameRate: 24, quality: 55 }), '-quality')).toBe('55');
  });

  it('loops forever and carries no audio', () => {
    const args = buildEncodeAnimatedWebPArgs({ frameRate: 24, quality: 75 });
    expect(valueAfter(args, '-loop')).toBe('0');
    expect(args).toContain('-an');
  });

  it('keeps the alpha channel', () => {
    expect(valueAfter(buildEncodeAnimatedWebPArgs({ frameRate: 24, quality: 75 }), '-pix_fmt')).toBe(
      'yuva420p',
    );
  });
});

describe('inputExtension', () => {
  it.each([
    ['clip.mp4', '.mp4'],
    ['CLIP.MOV', '.mov'],
    ['recording.webm', '.webm'],
    ['no-extension', '.bin'],
    ['archive.tar.gz', '.gz'],
  ])('%s -> %s', (input, expected) => {
    expect(inputExtension(input)).toBe(expected);
  });
});
