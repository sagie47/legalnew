function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function normalizeChunkInput(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function maybeExtendTableBoundary(text, start, end, extraBufferChars = 400) {
  if (end >= text.length) return end;

  const windowStart = Math.max(start, end - 2400);
  const tableStart = text.lastIndexOf('Table:', end);
  if (tableStart < windowStart) return end;

  // If a blank-line boundary already exists after the table and before end,
  // the current position is likely outside table rows.
  const blankLineAfterTable = text.indexOf('\n\n', tableStart);
  if (blankLineAfterTable !== -1 && blankLineAfterTable <= end) {
    return end;
  }

  const lineStart = text.lastIndexOf('\n', end - 1) + 1;
  const nextLineBreak = text.indexOf('\n', end);
  if (nextLineBreak === -1) return end;

  const currentLine = text.slice(lineStart, nextLineBreak);
  const looksLikeTableLine = /\|/.test(currentLine) || /^\s*Table:/i.test(currentLine.trim());
  if (!looksLikeTableLine) return end;

  if (nextLineBreak - end <= extraBufferChars) {
    return nextLineBreak;
  }
  return end;
}

function findBoundary(text, start, targetEnd) {
  if (targetEnd >= text.length) return text.length;

  const minBoundary = start + Math.floor((targetEnd - start) * 0.6);
  const newlineIdx = text.lastIndexOf('\n', targetEnd);
  if (newlineIdx >= minBoundary) return newlineIdx;

  const spaceIdx = text.lastIndexOf(' ', targetEnd);
  if (spaceIdx >= minBoundary) return spaceIdx;

  return targetEnd;
}

export function chunkTextWithOverlap(text, options = {}) {
  const value = normalizeChunkInput(text);
  if (!value) return [];

  const maxChars = toPositiveInt(options.maxChars || process.env.PDI_CHUNK_MAX_CHARS, 3200);
  const minChars = Math.min(
    toPositiveInt(options.minChars || process.env.PDI_CHUNK_MIN_CHARS, 800),
    maxChars
  );
  const overlapChars = Math.min(
    toPositiveInt(options.overlapChars || process.env.PDI_CHUNK_OVERLAP_CHARS, 500),
    Math.floor(maxChars / 2)
  );
  const tableBoundaryBufferChars = toPositiveInt(options.tableBoundaryBufferChars || process.env.PDI_TABLE_BOUNDARY_BUFFER_CHARS, 400);

  const chunks = [];
  let start = 0;

  while (start < value.length) {
    const targetEnd = Math.min(value.length, start + maxChars);
    let end = findBoundary(value, start, targetEnd);
    end = maybeExtendTableBoundary(value, start, end, tableBoundaryBufferChars);

    const remainderChars = value.length - end;
    if (remainderChars > 0 && remainderChars < minChars && chunks.length > 0) {
      end = value.length;
    }

    const chunkText = value.slice(start, end).trim();
    if (chunkText) {
      chunks.push({
        text: chunkText,
        start,
        end,
      });
    }

    if (end >= value.length) break;

    let nextStart = Math.max(0, end - overlapChars);
    if (nextStart <= start) {
      nextStart = start + Math.max(1, maxChars - overlapChars);
    }
    start = nextStart;
  }

  return chunks;
}

export function chunkSections(sections, options = {}) {
  if (!Array.isArray(sections) || sections.length === 0) return [];

  const chunks = [];
  sections.forEach((section, sectionIndex) => {
    const sectionChunks = chunkTextWithOverlap(section.text, options);
    sectionChunks.forEach((chunk, chunkIndex) => {
      chunks.push({
        section_index: sectionIndex,
        chunk_index: chunkIndex,
        heading_path: Array.isArray(section.heading_path) ? section.heading_path : [],
        top_heading: section.top_heading || section.heading_path?.[0] || null,
        anchor: section.anchor || null,
        text: chunk.text,
        est_tokens: Math.ceil(chunk.text.length / 4),
        start_char: chunk.start,
        end_char: chunk.end,
      });
    });
  });

  return chunks;
}
