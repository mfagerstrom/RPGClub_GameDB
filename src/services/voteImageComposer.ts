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
  sortByTitle?: boolean;
}

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const OUTER_MARGIN_TOP = 0;
const OUTER_MARGIN_BOTTOM = 0;
const OUTER_MARGIN_SIDE = 0;
const TILE_GAP = 5;
const EVEN_ROW_STAGGER_MAX = 36;

type GridDimensions = {
  cols: number;
  rows: number;
};

type Slot = {
  col: number;
  row: number;
};

function getCustomSlots(count: number): { cols: number; rows: number; slots: Slot[] } | null {
  if (count === 2) {
    return {
      cols: 2,
      rows: 1,
      slots: [{ col: 0, row: 0 }, { col: 1, row: 0 }],
    };
  }
  if (count === 3) {
    return {
      cols: 3,
      rows: 1,
      slots: [{ col: 0, row: 0 }, { col: 1, row: 0 }, { col: 2, row: 0 }],
    };
  }
  if (count === 4) {
    return {
      cols: 4,
      rows: 1,
      slots: [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 2, row: 0 },
        { col: 3, row: 0 },
      ],
    };
  }
  if (count === 5) {
    return {
      cols: 3,
      rows: 2,
      slots: [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 2, row: 0 },
        { col: 0.5, row: 1 },
        { col: 1.5, row: 1 },
      ],
    };
  }
  if (count === 6) {
    return {
      cols: 6,
      rows: 2,
      slots: [
        { col: 0, row: 0 },
        { col: 2, row: 0 },
        { col: 4, row: 0 },
        { col: 1, row: 1 },
        { col: 3, row: 1 },
        { col: 5, row: 1 },
      ],
    };
  }
  if (count === 7) {
    return {
      cols: 4,
      rows: 2,
      slots: [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 2, row: 0 },
        { col: 3, row: 0 },
        { col: 0.5, row: 1 },
        { col: 1.5, row: 1 },
        { col: 2.5, row: 1 },
      ],
    };
  }
  return null;
}

async function cropTransparentRowsKeepingWidth(imageBuffer: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(imageBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const alphaOffset = channels - 1;

  let top = 0;
  let bottom = height - 1;

  const rowHasOpaquePixel = (row: number): boolean => {
    const rowStart = row * width * channels;
    const rowEnd = rowStart + width * channels;
    for (let offset = rowStart + alphaOffset; offset < rowEnd; offset += channels) {
      if ((data[offset] ?? 0) > 0) {
        return true;
      }
    }
    return false;
  };

  while (top < height && !rowHasOpaquePixel(top)) {
    top += 1;
  }
  while (bottom >= top && !rowHasOpaquePixel(bottom)) {
    bottom -= 1;
  }

  if (top === 0 && bottom === height - 1) {
    return imageBuffer;
  }

  if (top > bottom) {
    return imageBuffer;
  }

  const croppedHeight = bottom - top + 1;
  return sharp(imageBuffer)
    .extract({
      left: 0,
      top,
      width,
      height: croppedHeight,
    })
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toBuffer();
}

function resolveGridDimensions(count: number): GridDimensions {
  if (count <= 1) return { cols: 1, rows: 1 };
  if (count === 2) return { cols: 2, rows: 1 };
  if (count === 3) return { cols: 3, rows: 1 };
  if (count === 4) return { cols: 2, rows: 2 };

  if (count % 2 === 0) {
    const targetRatio = CANVAS_WIDTH / CANVAS_HEIGHT;
    let best: GridDimensions | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let rows = 1; rows <= Math.floor(Math.sqrt(count)); rows += 1) {
      if (count % rows !== 0) {
        continue;
      }
      const cols = count / rows;
      const ratioScore = Math.abs((cols / rows) - targetRatio);
      if (ratioScore < bestScore) {
        best = { cols, rows };
        bestScore = ratioScore;
      }
    }

    if (best) {
      return best;
    }
  }

  const estimatedCols = Math.ceil(Math.sqrt((count * CANVAS_WIDTH) / CANVAS_HEIGHT));
  const cols = Math.max(2, estimatedCols);
  const rows = Math.ceil(count / cols);
  return { cols, rows };
}

export async function composeVoteImage(params: IComposeVoteImageParams): Promise<Buffer> {
  if (!Number.isInteger(params.roundNumber) || params.roundNumber <= 0) {
    throw new Error("Invalid round number.");
  }
  if (!params.covers.length) {
    throw new Error("No covers were supplied for image generation.");
  }

  const orderedCovers = params.sortByTitle === false
    ? [...params.covers]
    : [...params.covers].sort((a, b) => a.title.localeCompare(b.title));
  const custom = getCustomSlots(orderedCovers.length);
  const { cols, rows } = custom ?? resolveGridDimensions(orderedCovers.length);
  const shouldStaggerRows = !custom && orderedCovers.length % 2 === 0 && rows > 1;
  const usableWidth = CANVAS_WIDTH - OUTER_MARGIN_SIDE * 2;
  const rowStaggerAmount = shouldStaggerRows
    ? Math.min(EVEN_ROW_STAGGER_MAX, Math.max(10, Math.floor(usableWidth * 0.025)))
    : 0;
  const usableWidthForTiles = shouldStaggerRows
    ? Math.max(cols, usableWidth - rowStaggerAmount * 2)
    : usableWidth;

  const composites: sharp.OverlayOptions[] = [];
  const tileGap = TILE_GAP;
  const rowGap = orderedCovers.length === 6 ? 0 : tileGap;
  const tileWidth = custom?.cols === 2
    ? Math.floor((usableWidth - tileGap) / 2)
    : Math.floor((usableWidthForTiles - tileGap * (cols - 1)) / cols);
  const usableHeight = CANVAS_HEIGHT - OUTER_MARGIN_TOP - OUTER_MARGIN_BOTTOM;
  const tileHeight = Math.floor((usableHeight - rowGap * (rows - 1)) / rows);

  for (let i = 0; i < orderedCovers.length; i += 1) {
    const cover = orderedCovers[i];
    const slot = custom?.slots[i] ?? { col: i % cols, row: Math.floor(i / cols) };
    const rowShiftX = shouldStaggerRows
      ? ((slot.row % 2 === 0 ? -1 : 1) * rowStaggerAmount)
      : 0;
    const rawLeft = custom?.cols === 2 && slot.col === 1
      ? CANVAS_WIDTH - OUTER_MARGIN_SIDE - tileWidth
      : OUTER_MARGIN_SIDE + slot.col * (tileWidth + tileGap) + rowShiftX;
    const rawTop = OUTER_MARGIN_TOP + slot.row * (tileHeight + rowGap);
    const left = Math.round(rawLeft);
    const top = Math.round(rawTop);

    const resized = await sharp(cover.imageData)
      .resize(tileWidth, tileHeight, {
        fit: "contain",
        position: orderedCovers.length === 6
          ? (slot.row === 0 ? "south" : "north")
          : "centre",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png({ compressionLevel: 9, palette: true, quality: 90 })
      .toBuffer();

    composites.push({ input: resized, left, top });
  }

  const composed = await sharp({
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

  return cropTransparentRowsKeepingWidth(composed);
}
