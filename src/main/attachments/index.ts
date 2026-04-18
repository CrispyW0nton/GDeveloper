/**
 * Attachment Processing — Sprint 25
 *
 * Handles file attachments: drag-drop, clipboard paste, vision, document extraction.
 * Security: EXIF stripping, path traversal prevention, sensitive file warnings.
 * Storage: {userData}/attachments/{conv-id}/{timestamp}-{filename}
 */

import { app } from 'electron';
import { join, extname, basename, resolve, normalize } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync, statSync, rmSync } from 'fs';

// ─── Types ───

export interface AttachmentConfig {
  maxImageSizeMB: number;          // default 20
  maxDocSizeMB: number;            // default 10
  maxTotalSizeMB: number;          // default 50
  maxFilesPerMessage: number;      // default 10
  autoDownscaleMaxPx: number;      // default 2048
  stripExif: boolean;              // default true
  warnOnSensitiveFiles: boolean;   // default true
  enableDragDrop: boolean;         // default true
  enableClipboardPaste: boolean;   // default true
  enableVision: boolean;           // default true
  maxTextChars: number;            // default 100_000
}

export const DEFAULT_ATTACHMENT_CONFIG: AttachmentConfig = {
  maxImageSizeMB: 20,
  maxDocSizeMB: 10,
  maxTotalSizeMB: 50,
  maxFilesPerMessage: 10,
  autoDownscaleMaxPx: 2048,
  stripExif: true,
  warnOnSensitiveFiles: true,
  enableDragDrop: true,
  enableClipboardPaste: true,
  enableVision: true,
  maxTextChars: 100_000,
};

export type AttachmentType = 'image' | 'document' | 'code' | 'unknown';

export interface AttachmentMeta {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  type: AttachmentType;
  /** Base64 data URI for images (after processing) */
  dataUri?: string;
  /** Extracted text for documents */
  extractedText?: string;
  /** Thumbnail data URI for previews */
  thumbnailUri?: string;
  /** Vision token cost estimate */
  visionTokenEstimate?: number;
  /** Storage path on disk */
  storagePath?: string;
  /** Warnings (sensitive file, large, etc.) */
  warnings: string[];
  /** Whether EXIF was stripped */
  exifStripped: boolean;
  /** Dimensions if image */
  width?: number;
  height?: number;
  /** Was image downscaled */
  downscaled: boolean;
  /** Timestamp added */
  addedAt: number;
  /** Source: drag-drop, clipboard, file-picker */
  source: 'drag-drop' | 'clipboard' | 'file-picker' | 'workspace';
}

// ─── Allowed MIME types ───

const IMAGE_MIMES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp',
]);

const DOCUMENT_MIMES = new Set([
  'text/plain', 'text/markdown', 'text/csv', 'text/html', 'text/xml',
  'application/json', 'application/pdf',
  'application/xml', 'application/x-yaml',
]);

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h',
  '.hpp', '.cs', '.rb', '.php', '.swift', '.kt', '.scala', '.sh', '.bash', '.zsh',
  '.sql', '.r', '.m', '.mm', '.lua', '.dart', '.ex', '.exs', '.zig', '.v',
  '.toml', '.yaml', '.yml', '.ini', '.cfg', '.conf', '.env', '.dockerfile',
  '.makefile', '.cmake', '.gradle', '.xml', '.html', '.css', '.scss', '.less',
  '.vue', '.svelte', '.astro', '.mdx',
]);

const SENSITIVE_PATTERNS = [
  /\.env$/i, /\.env\.\w+$/i, /\.pem$/i, /\.key$/i, /\.crt$/i, /\.p12$/i,
  /id_rsa/i, /id_ed25519/i, /\.gpg$/i, /\.asc$/i,
  /credentials/i, /secrets?\./i, /tokens?\./i, /passwords?\./i,
  /api[_-]?key/i, /\.kdbx?$/i, /\.jks$/i,
];

// ─── Utilities ───

export function classifyFile(filename: string, mimeType: string): AttachmentType {
  if (IMAGE_MIMES.has(mimeType)) return 'image';
  if (DOCUMENT_MIMES.has(mimeType)) return 'document';
  const ext = extname(filename).toLowerCase();
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  if (mimeType.startsWith('text/')) return 'document';
  return 'unknown';
}

export function isSensitiveFile(filename: string): boolean {
  return SENSITIVE_PATTERNS.some(p => p.test(filename));
}

export function isAllowedMime(mimeType: string): boolean {
  return IMAGE_MIMES.has(mimeType) ||
    DOCUMENT_MIMES.has(mimeType) ||
    mimeType.startsWith('text/');
}

export function sanitizePath(input: string): string {
  // Prevent path traversal
  const cleaned = normalize(input).replace(/\.\.[/\\]/g, '');
  return basename(cleaned);
}

/**
 * Strip EXIF data from JPEG/PNG buffers.
 * For JPEG: remove APP1 (EXIF) segments.
 * For PNG: remove tEXt, iTXt, zTXt, eXIf chunks.
 * Simple implementation — removes known metadata markers.
 */
export function stripExifData(buffer: Buffer, mimeType: string): { buffer: Buffer; stripped: boolean } {
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
    return stripJpegExif(buffer);
  }
  if (mimeType === 'image/png') {
    return stripPngMetadata(buffer);
  }
  // Other formats: return as-is
  return { buffer, stripped: false };
}

function stripJpegExif(data: Buffer): { buffer: Buffer; stripped: boolean } {
  // JPEG starts with FF D8
  if (data[0] !== 0xFF || data[1] !== 0xD8) return { buffer: data, stripped: false };

  const chunks: Buffer[] = [Buffer.from([0xFF, 0xD8])];
  let i = 2;
  let stripped = false;

  while (i < data.length - 1) {
    if (data[i] !== 0xFF) { i++; continue; }

    const marker = data[i + 1];

    // APP1 (0xE1) contains EXIF — skip it
    if (marker === 0xE1) {
      if (i + 3 < data.length) {
        const segLen = data.readUInt16BE(i + 2);
        i += 2 + segLen;
        stripped = true;
        continue;
      }
    }

    // SOS (0xDA) — start of scan, rest is image data
    if (marker === 0xDA) {
      chunks.push(data.subarray(i));
      break;
    }

    // Other marker: keep it
    if (marker >= 0xC0 && i + 3 < data.length) {
      const segLen = data.readUInt16BE(i + 2);
      chunks.push(data.subarray(i, i + 2 + segLen));
      i += 2 + segLen;
    } else {
      chunks.push(data.subarray(i, i + 2));
      i += 2;
    }
  }

  return { buffer: stripped ? Buffer.concat(chunks) : data, stripped };
}

function stripPngMetadata(data: Buffer): { buffer: Buffer; stripped: boolean } {
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (data.length < 8 || data[0] !== 0x89 || data[1] !== 0x50) return { buffer: data, stripped: false };

  const METADATA_CHUNKS = new Set(['tEXt', 'iTXt', 'zTXt', 'eXIf']);
  const chunks: Buffer[] = [data.subarray(0, 8)]; // signature
  let i = 8;
  let stripped = false;

  while (i + 8 <= data.length) {
    const length = data.readUInt32BE(i);
    const chunkType = data.subarray(i + 4, i + 8).toString('ascii');
    const totalChunkLen = 12 + length; // length(4) + type(4) + data(length) + crc(4)

    if (i + totalChunkLen > data.length) break;

    if (METADATA_CHUNKS.has(chunkType)) {
      stripped = true;
    } else {
      chunks.push(data.subarray(i, i + totalChunkLen));
    }

    i += totalChunkLen;
  }

  return { buffer: stripped ? Buffer.concat(chunks) : data, stripped };
}

/**
 * Downscale image if dimensions exceed max.
 * Returns base64 data URI and new dimensions.
 * Since we don't have sharp/canvas in Electron main, we return the original
 * and let the renderer handle actual resize via canvas.
 * We estimate dimensions from the buffer header.
 */
export function getImageDimensions(buffer: Buffer, mimeType: string): { width: number; height: number } | null {
  try {
    if (mimeType === 'image/png' && buffer.length > 24) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { width, height };
    }
    if ((mimeType === 'image/jpeg' || mimeType === 'image/jpg') && buffer.length > 2) {
      // Scan for SOF markers
      let i = 2;
      while (i < buffer.length - 8) {
        if (buffer[i] !== 0xFF) { i++; continue; }
        const marker = buffer[i + 1];
        if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
          const height = buffer.readUInt16BE(i + 5);
          const width = buffer.readUInt16BE(i + 7);
          return { width, height };
        }
        if (i + 3 < buffer.length) {
          const segLen = buffer.readUInt16BE(i + 2);
          i += 2 + segLen;
        } else {
          i += 2;
        }
      }
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Estimate vision token cost for an image.
 * Based on Anthropic pricing: roughly (width * height) / 750 tokens.
 */
export function estimateVisionTokens(width: number, height: number): number {
  return Math.ceil((width * height) / 750);
}

/**
 * Extract text from a document buffer.
 * Supports: TXT, MD, JSON, code files.
 * PDF: extract raw text (basic — no OCR).
 */
export function extractDocumentText(buffer: Buffer, filename: string, mimeType: string, maxChars: number): string {
  const ext = extname(filename).toLowerCase();

  // Text-based files
  if (mimeType.startsWith('text/') || CODE_EXTENSIONS.has(ext) ||
      mimeType === 'application/json' || mimeType === 'application/xml' ||
      mimeType === 'application/x-yaml') {
    const text = buffer.toString('utf-8');
    if (text.length > maxChars) {
      return text.substring(0, maxChars) + `\n\n--- [Truncated: ${text.length.toLocaleString()} chars, showing first ${maxChars.toLocaleString()}] ---`;
    }
    return text;
  }

  // PDF: basic text extraction
  if (mimeType === 'application/pdf') {
    return extractPdfText(buffer, maxChars);
  }

  return `[Binary file: ${filename} (${(buffer.length / 1024).toFixed(1)} KB)]`;
}

/**
 * Very basic PDF text extraction — pulls text between stream/endstream.
 * For production, would use pdf-parse or similar.
 */
function extractPdfText(buffer: Buffer, maxChars: number): string {
  const raw = buffer.toString('latin1');
  const textParts: string[] = [];
  let totalChars = 0;

  // Find text between BT...ET (begin text / end text) operators
  const btRegex = /BT\s([\s\S]*?)ET/g;
  let match;
  while ((match = btRegex.exec(raw)) !== null) {
    // Extract string operands from Tj/TJ operators
    const tjRegex = /\(((?:[^\\)]|\\.)*)\)\s*Tj/g;
    let tjMatch;
    while ((tjMatch = tjRegex.exec(match[1])) !== null) {
      const text = tjMatch[1].replace(/\\([\\()])/g, '$1');
      if (totalChars + text.length > maxChars) break;
      textParts.push(text);
      totalChars += text.length;
    }
    if (totalChars >= maxChars) break;
  }

  if (textParts.length === 0) {
    return '[PDF document — text extraction produced no results. The PDF may contain scanned images or complex formatting.]';
  }

  const result = textParts.join(' ').trim();
  if (result.length > maxChars) {
    return result.substring(0, maxChars) + `\n\n--- [Truncated PDF text] ---`;
  }
  return result;
}

// ─── Storage ───

function getAttachmentsDir(conversationId: string): string {
  const userDataPath = app.getPath('userData');
  const dir = join(userDataPath, 'attachments', conversationId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Process and store a file attachment.
 * Returns the processed AttachmentMeta.
 */
export function processAttachment(
  fileBuffer: Buffer,
  originalName: string,
  mimeType: string,
  conversationId: string,
  source: AttachmentMeta['source'],
  config: AttachmentConfig = DEFAULT_ATTACHMENT_CONFIG,
): AttachmentMeta {
  const warnings: string[] = [];
  const safeName = sanitizePath(originalName);
  const fileType = classifyFile(safeName, mimeType);
  const fileSize = fileBuffer.length;

  // Size validation
  const sizeMB = fileSize / (1024 * 1024);
  if (fileType === 'image' && sizeMB > config.maxImageSizeMB) {
    throw new Error(`Image too large: ${sizeMB.toFixed(1)} MB (limit: ${config.maxImageSizeMB} MB)`);
  }
  if (fileType !== 'image' && sizeMB > config.maxDocSizeMB) {
    throw new Error(`Document too large: ${sizeMB.toFixed(1)} MB (limit: ${config.maxDocSizeMB} MB)`);
  }

  // Sensitive file warning
  if (config.warnOnSensitiveFiles && isSensitiveFile(safeName)) {
    warnings.push(`Sensitive file detected: "${safeName}" may contain credentials or private keys. Review before sending.`);
  }

  let processedBuffer = fileBuffer;
  let exifStripped = false;
  let width: number | undefined;
  let height: number | undefined;
  let downscaled = false;
  let dataUri: string | undefined;
  let extractedText: string | undefined;
  let thumbnailUri: string | undefined;
  let visionTokenEstimate: number | undefined;

  if (fileType === 'image') {
    // Strip EXIF
    if (config.stripExif) {
      const result = stripExifData(fileBuffer, mimeType);
      processedBuffer = result.buffer;
      exifStripped = result.stripped;
    }

    // Get dimensions
    const dims = getImageDimensions(processedBuffer, mimeType);
    if (dims) {
      width = dims.width;
      height = dims.height;

      // Check if downscale needed (flag for renderer to handle)
      if (width > config.autoDownscaleMaxPx || height > config.autoDownscaleMaxPx) {
        const scale = config.autoDownscaleMaxPx / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        downscaled = true;
        warnings.push(`Image will be downscaled to ${width}x${height} (max ${config.autoDownscaleMaxPx}px)`);
      }

      visionTokenEstimate = estimateVisionTokens(width, height);
    }

    // Create data URI
    const base64 = processedBuffer.toString('base64');
    dataUri = `data:${mimeType};base64,${base64}`;

    // Thumbnail: if image is large, we still use the same data URI (renderer can resize for display)
    thumbnailUri = dataUri;
  } else {
    // Document: extract text
    extractedText = extractDocumentText(processedBuffer, safeName, mimeType, config.maxTextChars);
  }

  // Generate ID and store
  const timestamp = Date.now();
  const id = `att-${timestamp}-${Math.random().toString(36).substr(2, 6)}`;
  const storedFilename = `${timestamp}-${safeName}`;

  // Store file to disk for persistence
  const dir = getAttachmentsDir(conversationId);
  const storagePath = join(dir, storedFilename);
  writeFileSync(storagePath, processedBuffer);

  return {
    id,
    filename: storedFilename,
    originalName: safeName,
    mimeType,
    size: fileSize,
    type: fileType,
    dataUri,
    extractedText,
    thumbnailUri,
    visionTokenEstimate,
    storagePath,
    warnings,
    exifStripped,
    width,
    height,
    downscaled,
    addedAt: timestamp,
    source,
  };
}

/**
 * Read a stored attachment from disk.
 */
export function loadAttachment(conversationId: string, filename: string): Buffer | null {
  const dir = getAttachmentsDir(conversationId);
  const filePath = join(dir, sanitizePath(filename));
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath);
}

/**
 * Delete all attachments for a conversation.
 */
export function deleteConversationAttachments(conversationId: string): void {
  const userDataPath = app.getPath('userData');
  const dir = join(userDataPath, 'attachments', conversationId);
  if (existsSync(dir)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch { /* ignore cleanup errors */ }
  }
}

/**
 * Get attachment config from settings, merging with defaults.
 */
let currentConfig: AttachmentConfig = { ...DEFAULT_ATTACHMENT_CONFIG };

export function getAttachmentConfig(): AttachmentConfig {
  return { ...currentConfig };
}

export function setAttachmentConfig(partial: Partial<AttachmentConfig>): AttachmentConfig {
  currentConfig = { ...currentConfig, ...partial };
  return { ...currentConfig };
}

/**
 * Process clipboard image data (from Electron's clipboard.readImage).
 * Expects a raw PNG buffer.
 */
export function processClipboardImage(
  pngBuffer: Buffer,
  conversationId: string,
  config: AttachmentConfig = DEFAULT_ATTACHMENT_CONFIG,
): AttachmentMeta {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const filename = `pasted-screenshot-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.png`;

  return processAttachment(pngBuffer, filename, 'image/png', conversationId, 'clipboard', config);
}

/**
 * Check if a model supports vision.
 */
export function modelSupportsVision(modelId: string): boolean {
  // All Claude 3+ models support vision
  if (modelId.includes('claude-3') || modelId.includes('claude-sonnet-4') || modelId.includes('claude-opus-4')) {
    return true;
  }
  // GPT-4 vision models
  if (modelId.includes('gpt-4') && (modelId.includes('vision') || modelId.includes('turbo') || modelId.includes('o'))) {
    return true;
  }
  return false;
}

/**
 * Build message content array for sending images to the API.
 * For Anthropic: uses base64 source type.
 * For OpenAI: uses image_url type.
 */
export function buildVisionContent(
  text: string,
  attachments: AttachmentMeta[],
  provider: 'claude' | 'openai' = 'claude',
): any[] {
  const content: any[] = [];

  // Add text first
  if (text) {
    content.push({ type: 'text', text });
  }

  for (const att of attachments) {
    if (att.type === 'image' && att.dataUri) {
      if (provider === 'claude') {
        // Anthropic format: base64 image source
        const base64Data = att.dataUri.split(',')[1] || '';
        const mediaType = att.mimeType || 'image/png';
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType,
            data: base64Data,
          },
        });
      } else {
        // OpenAI format: image_url
        content.push({
          type: 'image_url',
          image_url: {
            url: att.dataUri,
            detail: 'auto',
          },
        });
      }
    } else if (att.extractedText) {
      // Document attachment: include extracted text
      content.push({
        type: 'text',
        text: `\n\n--- Attached file: ${att.originalName} (${(att.size / 1024).toFixed(1)} KB) ---\n${att.extractedText}\n--- End of ${att.originalName} ---`,
      });
    }
  }

  return content;
}
