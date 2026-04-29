import sharp from "sharp";

export type VoteImageType = "GOTM" | "NR-GOTM";

export interface IVoteImageCover {
  gameId: number;
  title: string;
  imageData: Buffer;
}

export interface IComposeVoteImageParams {
  roundNumber: number;
  voteType: VoteImageType;
  covers: IVoteImageCover[];
}

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const OUTER_MARGIN = 5;
const TILE_GAP = 5;
const HEADER_FONT_SIZE_MIN = 96;
const HEADER_FONT_SIZE_MAX = 220;
const HEADER_TARGET_WIDTH_RATIO = 0.8;
const HEADER_SIDE_SAFE_PADDING = 100;
const HEADER_BOTTOM_SAFE_PADDING = 24;

type GridDimensions = {
  cols: number;
  rows: number;
};

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function resolveGridDimensions(count: number): GridDimensions {
  if (count <= 1) return { cols: 1, rows: 1 };
  if (count === 2) return { cols: 2, rows: 1 };
  if (count === 3) return { cols: 3, rows: 1 };
  if (count === 4) return { cols: 2, rows: 2 };

  const estimatedCols = Math.ceil(Math.sqrt((count * CANVAS_WIDTH) / CANVAS_HEIGHT));
  const cols = Math.max(2, estimatedCols);
  const rows = Math.ceil(count / cols);
  return { cols, rows };
}

function estimateHeaderFontSize(label: string): number {
  const safeLength = Math.max(1, label.length);
  const targetWidth =
    Math.min(CANVAS_WIDTH * HEADER_TARGET_WIDTH_RATIO, CANVAS_WIDTH - HEADER_SIDE_SAFE_PADDING * 2);
  const estimated = Math.floor(targetWidth / (safeLength * 0.58));
  return Math.max(HEADER_FONT_SIZE_MIN, Math.min(HEADER_FONT_SIZE_MAX, estimated));
}

function buildHeaderOverlaySvg(
  voteType: VoteImageType,
  roundNumber: number,
  singleRowLayout: boolean,
): Buffer {
  const plainLabel = `[${voteType}] Round ${roundNumber}`;
  const label = escapeXml(`[${voteType}] Round ${roundNumber}`);
  const subtitle = "Nominations";
  const dynamicFontSize = estimateHeaderFontSize(plainLabel);
  const subtitleFontSize = Math.max(24, Math.floor(dynamicFontSize * 0.6));
  const lineGap = Math.floor(dynamicFontSize * 0.475);
  const mainYDefault = singleRowLayout
    ? Math.floor(CANVAS_HEIGHT * 0.84)
    : Math.floor(CANVAS_HEIGHT * 0.48);
  const maxSubtitleY =
    CANVAS_HEIGHT - Math.floor(subtitleFontSize / 2) - HEADER_BOTTOM_SAFE_PADDING;
  const maxMainY = maxSubtitleY - lineGap;
  const minMainY = Math.floor(dynamicFontSize / 2) + HEADER_BOTTOM_SAFE_PADDING;
  const mainY = Math.max(minMainY, Math.min(mainYDefault, maxMainY));
  const subtitleY = Math.min(maxSubtitleY, mainY + lineGap);
  const svg = `<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="headerGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="6" result="blur"/>
      <feColorMatrix in="blur" type="matrix"
        values="0 0 0 0 0
                0 0 0 0 0
                0 0 0 0 0
                0 0 0 0.9 0" result="darkGlow"/>
      <feMerge>
        <feMergeNode in="darkGlow"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <text
    x="50%"
    y="${mainY}"
    text-anchor="middle"
    dominant-baseline="middle"
    font-family="Arial, Helvetica, sans-serif"
    font-size="${dynamicFontSize}"
    font-weight="900"
    fill="#FFFFFF"
    stroke="#000000"
    stroke-width="3"
    filter="url(#headerGlow)">${label}</text>
  <text
    x="50%"
    y="${subtitleY}"
    text-anchor="middle"
    dominant-baseline="middle"
    font-family="Arial, Helvetica, sans-serif"
    font-size="${subtitleFontSize}"
    font-weight="900"
    fill="#FFFFFF"
    stroke="#000000"
    stroke-width="2"
    filter="url(#headerGlow)">${subtitle}</text>
</svg>`;

  return Buffer.from(svg);
}

export async function composeVoteImage(params: IComposeVoteImageParams): Promise<Buffer> {
  if (!Number.isInteger(params.roundNumber) || params.roundNumber <= 0) {
    throw new Error("Invalid round number.");
  }
  if (!params.covers.length) {
    throw new Error("No covers were supplied for image generation.");
  }

  const orderedCovers = [...params.covers].sort((a, b) => a.title.localeCompare(b.title));
  const { cols, rows } = resolveGridDimensions(orderedCovers.length);

  const usableWidth = CANVAS_WIDTH - OUTER_MARGIN * 2;
  const usableHeight = CANVAS_HEIGHT - OUTER_MARGIN * 2;

  const tileWidth = Math.floor((usableWidth - TILE_GAP * (cols - 1)) / cols);
  const tileHeight = Math.floor((usableHeight - TILE_GAP * (rows - 1)) / rows);

  const composites: sharp.OverlayOptions[] = [];

  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    const rowStart = rowIndex * cols;
    const rowItems = orderedCovers.slice(rowStart, rowStart + cols);
    if (!rowItems.length) {
      continue;
    }

    const rowWidth = rowItems.length * tileWidth + (rowItems.length - 1) * TILE_GAP;
    const rowXOffset = OUTER_MARGIN + Math.floor((usableWidth - rowWidth) / 2);
    const top = OUTER_MARGIN + rowIndex * (tileHeight + TILE_GAP);

    for (let itemIndex = 0; itemIndex < rowItems.length; itemIndex += 1) {
      const cover = rowItems[itemIndex];
      const left = rowXOffset + itemIndex * (tileWidth + TILE_GAP);

      const resized = await sharp(cover.imageData)
        .resize(tileWidth, tileHeight, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png({ compressionLevel: 9, palette: true, quality: 90 })
        .toBuffer();

      composites.push({ input: resized, left, top });
    }
  }

  composites.push({
    input: buildHeaderOverlaySvg(params.voteType, params.roundNumber, rows === 1),
    left: 0,
    top: 0,
  });

  return sharp({
    create: {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toBuffer();
}
