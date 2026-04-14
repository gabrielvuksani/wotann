/**
 * Video Processor — extract frames, analyze content, and transcribe audio
 * from video files.
 *
 * Uses ffmpeg for frame extraction and audio isolation, with configurable
 * intervals. Frame analysis returns text descriptions suitable for LLM
 * context. Audio transcription uses Whisper CLI when available.
 *
 * Security: All paths are validated before use. Uses execFile (not shell)
 * to prevent injection.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const runFile = promisify(execFile);

// ── Public Types ──────────────────────────────────────

export interface VideoMetadata {
  readonly duration: number;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly codec: string;
  readonly hasAudio: boolean;
}

export interface FrameInfo {
  readonly path: string;
  readonly timestampMs: number;
  readonly index: number;
}

export interface FrameAnalysis {
  readonly framePath: string;
  readonly description: string;
  readonly timestampMs: number;
}

export interface TranscriptionSegment {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}

export interface TranscriptionResult {
  readonly fullText: string;
  readonly segments: readonly TranscriptionSegment[];
  readonly language: string;
}

// ── Constants ─────────────────────────────────────────

const FFMPEG_BIN = "ffmpeg";
const FFPROBE_BIN = "ffprobe";
const WHISPER_BIN = "whisper";
const DEFAULT_FRAME_INTERVAL_MS = 5_000;
const MAX_FRAMES = 200;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_BUFFER = 50 * 1024 * 1024; // 50 MB for video processing

const SUPPORTED_EXTENSIONS = new Set([
  ".mp4", ".mkv", ".avi", ".mov", ".webm", ".flv", ".wmv", ".m4v",
]);

// ── VideoProcessor ────────────────────────────────────

export class VideoProcessor {
  private readonly workDir: string;

  constructor(workDir?: string) {
    this.workDir = workDir ?? join(tmpdir(), `wotann-video-${randomUUID().slice(0, 8)}`);
    if (!existsSync(this.workDir)) {
      mkdirSync(this.workDir, { recursive: true });
    }
  }

  /**
   * Check whether ffmpeg is available on the system.
   */
  async isAvailable(): Promise<boolean> {
    try {
      await runFile(FFMPEG_BIN, ["-version"], { timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get metadata about a video file.
   */
  async getMetadata(videoPath: string): Promise<VideoMetadata> {
    validateVideoPath(videoPath);

    const args = [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      videoPath,
    ];

    const { stdout } = await runFile(FFPROBE_BIN, args, {
      timeout: DEFAULT_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    });

    return parseMetadata(stdout);
  }

  /**
   * Extract frames from a video at the specified interval.
   * Returns an array of file paths to the extracted frame images.
   */
  async extractFrames(
    videoPath: string,
    intervalMs: number = DEFAULT_FRAME_INTERVAL_MS,
  ): Promise<string[]> {
    validateVideoPath(videoPath);

    const outputDir = join(this.workDir, `frames-${randomUUID().slice(0, 8)}`);
    mkdirSync(outputDir, { recursive: true });

    const fps = 1000 / Math.max(100, intervalMs); // Convert ms interval to fps
    const outputPattern = join(outputDir, "frame-%04d.png");

    const args = [
      "-i", videoPath,
      "-vf", `fps=${fps}`,
      "-frames:v", String(MAX_FRAMES),
      "-q:v", "2", // High quality JPEG-equivalent for PNG
      outputPattern,
      "-y", // Overwrite existing
    ];

    await runFile(FFMPEG_BIN, args, {
      timeout: DEFAULT_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    });

    // Collect extracted frame paths
    return collectFramePaths(outputDir);
  }

  /**
   * Analyze a single frame image and return a text description.
   * This performs a basic analysis based on file properties.
   * For full vision analysis, pass the frame to an LLM with vision capability.
   */
  async analyzeFrame(framePath: string): Promise<string> {
    if (!existsSync(framePath)) {
      throw new VideoProcessorError(`Frame file not found: ${framePath}`);
    }

    // Extract basic image metadata using ffprobe
    try {
      const args = [
        "-v", "quiet",
        "-print_format", "json",
        "-show_streams",
        framePath,
      ];

      const { stdout } = await runFile(FFPROBE_BIN, args, {
        timeout: 10_000,
        maxBuffer: MAX_BUFFER,
      });

      const info = parseImageInfo(stdout);
      const fileName = basename(framePath);
      const frameIndex = extractFrameIndex(fileName);

      return [
        `Frame ${frameIndex}: ${info.width}x${info.height} ${info.format}`,
        `Color space: ${info.colorSpace}`,
        `File: ${fileName}`,
        "Note: For detailed visual analysis, send this frame to a vision-capable LLM.",
      ].join("\n");
    } catch {
      return `Frame at ${basename(framePath)} — metadata extraction failed. Send to vision LLM for analysis.`;
    }
  }

  /**
   * Extract and transcribe audio from a video file.
   * Requires Whisper CLI (openai-whisper) to be installed.
   */
  async transcribeAudio(videoPath: string): Promise<string> {
    validateVideoPath(videoPath);

    // Step 1: Extract audio to WAV
    const audioPath = join(this.workDir, `audio-${randomUUID().slice(0, 8)}.wav`);

    const extractArgs = [
      "-i", videoPath,
      "-vn", // No video
      "-acodec", "pcm_s16le",
      "-ar", "16000", // 16kHz sample rate (Whisper default)
      "-ac", "1", // Mono
      audioPath,
      "-y",
    ];

    try {
      await runFile(FFMPEG_BIN, extractArgs, {
        timeout: DEFAULT_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
      });
    } catch (error: unknown) {
      throw new VideoProcessorError(
        `Audio extraction failed: ${String(error)}. Ensure the video has an audio track.`,
      );
    }

    // Step 2: Transcribe with Whisper
    try {
      const whisperArgs = [
        audioPath,
        "--model", "base",
        "--output_format", "txt",
        "--output_dir", this.workDir,
      ];

      await runFile(WHISPER_BIN, whisperArgs, {
        timeout: 300_000, // 5 minutes for transcription
        maxBuffer: MAX_BUFFER,
      });

      // Read the transcription output
      const txtPath = audioPath.replace(/\.wav$/, ".txt");
      if (existsSync(txtPath)) {
        return readFileSync(txtPath, "utf-8").trim();
      }

      // Whisper may output with original filename
      const altPath = join(this.workDir, basename(audioPath, ".wav") + ".txt");
      if (existsSync(altPath)) {
        return readFileSync(altPath, "utf-8").trim();
      }

      return "[Transcription completed but output file not found]";
    } catch (error: unknown) {
      throw new VideoProcessorError(
        `Transcription failed: ${String(error)}. Install Whisper: pip install openai-whisper`,
      );
    }
  }

  /**
   * Get the working directory used for temporary files.
   */
  getWorkDir(): string {
    return this.workDir;
  }
}

// ── Metadata Parsing ──────────────────────────────────

function parseMetadata(ffprobeJson: string): VideoMetadata {
  try {
    const data = JSON.parse(ffprobeJson) as {
      format?: { duration?: string };
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        width?: number;
        height?: number;
        r_frame_rate?: string;
      }>;
    };

    const videoStream = data.streams?.find((s) => s.codec_type === "video");
    const audioStream = data.streams?.find((s) => s.codec_type === "audio");

    const fpsStr = videoStream?.r_frame_rate ?? "30/1";
    const fpsParts = fpsStr.split("/");
    const fps = fpsParts.length === 2
      ? parseInt(fpsParts[0]!, 10) / Math.max(1, parseInt(fpsParts[1]!, 10))
      : parseFloat(fpsStr);

    return {
      duration: parseFloat(data.format?.duration ?? "0"),
      width: videoStream?.width ?? 0,
      height: videoStream?.height ?? 0,
      fps: Math.round(fps * 100) / 100,
      codec: videoStream?.codec_name ?? "unknown",
      hasAudio: audioStream !== undefined,
    };
  } catch {
    return {
      duration: 0,
      width: 0,
      height: 0,
      fps: 0,
      codec: "unknown",
      hasAudio: false,
    };
  }
}

function parseImageInfo(ffprobeJson: string): {
  width: number;
  height: number;
  format: string;
  colorSpace: string;
} {
  try {
    const data = JSON.parse(ffprobeJson) as {
      streams?: Array<{
        width?: number;
        height?: number;
        codec_name?: string;
        pix_fmt?: string;
      }>;
    };

    const stream = data.streams?.[0];
    return {
      width: stream?.width ?? 0,
      height: stream?.height ?? 0,
      format: stream?.codec_name ?? "unknown",
      colorSpace: stream?.pix_fmt ?? "unknown",
    };
  } catch {
    return { width: 0, height: 0, format: "unknown", colorSpace: "unknown" };
  }
}

// ── Helpers ───────────────────────────────────────────

function validateVideoPath(videoPath: string): void {
  if (!existsSync(videoPath)) {
    throw new VideoProcessorError(`Video file not found: ${videoPath}`);
  }

  const ext = extname(videoPath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new VideoProcessorError(
      `Unsupported video format: ${ext}. Supported: ${[...SUPPORTED_EXTENSIONS].join(", ")}`,
    );
  }
}

function collectFramePaths(outputDir: string): string[] {
  try {
    return readdirSync(outputDir)
      .filter((f) => f.startsWith("frame-") && f.endsWith(".png"))
      .sort()
      .map((f) => join(outputDir, f));
  } catch {
    return [];
  }
}

function extractFrameIndex(fileName: string): number {
  const match = fileName.match(/frame-(\d+)/);
  return match ? parseInt(match[1]!, 10) : 0;
}

// ── Error Type ────────────────────────────────────────

export class VideoProcessorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoProcessorError";
  }
}
