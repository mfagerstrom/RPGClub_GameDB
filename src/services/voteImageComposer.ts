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

type GridDimensions = {
  cols: number;
  rows: number;
};

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
  const { cols, rows } = resolveGridDimensions(orderedCovers.length);
  const usableWidth = CANVAS_WIDTH - OUTER_MARGIN_SIDE * 2;

  const tileWidth = Math.floor((usableWidth - TILE_GAP * (cols - 1)) / cols);
  const usableHeight = CANVAS_HEIGHT - OUTER_MARGIN_TOP - OUTER_MARGIN_BOTTOM;
  const tileHeight = Math.floor((usableHeight - TILE_GAP * (rows - 1)) / rows);

  const composites: sharp.OverlayOptions[] = [];

  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    const rowStart = rowIndex * cols;
    const rowItems = orderedCovers.slice(rowStart, rowStart + cols);
    if (!rowItems.length) {
      continue;
    }

    const rowWidth = rowItems.length * tileWidth + (rowItems.length - 1) * TILE_GAP;
    const rowXOffset = OUTER_MARGIN_SIDE + Math.floor((usableWidth - rowWidth) / 2);
    const top = OUTER_MARGIN_TOP + rowIndex * (tileHeight + TILE_GAP);

    for (let itemIndex = 0; itemIndex < rowItems.length; itemIndex += 1) {
      const cover = rowItems[itemIndex];
      const baseLeft = rowXOffset + itemIndex * (tileWidth + TILE_GAP);
      const targetTileWidth = tileWidth;
      const targetTileHeight = tileHeight;
      const metadata = await sharp(cover.imageData).metadata();
      const sourceWidth = metadata.width ?? targetTileWidth;
      const sourceHeight = metadata.height ?? targetTileHeight;
      const containScale = Math.min(targetTileWidth / sourceWidth, targetTileHeight / sourceHeight);
      const renderedWidth = Math.max(1, Math.floor(sourceWidth * containScale));
      const renderedHeight = Math.max(1, Math.floor(sourceHeight * containScale));
      const slackX = Math.max(0, targetTileWidth - renderedWidth);
      const slackY = Math.max(0, targetTileHeight - renderedHeight);
      const hasLargeSlack = slackX >= Math.floor(targetTileWidth * 0.16) ||
        slackY >= Math.floor(targetTileHeight * 0.16);
      const checkerShiftX = hasLargeSlack && ((rowIndex + itemIndex) % 2 === 0)
        ? Math.floor(Math.min(slackX, tileWidth * 0.08))
        : hasLargeSlack
          ? -Math.floor(Math.min(slackX, tileWidth * 0.08))
          : 0;
      const checkerShiftY = hasLargeSlack && ((rowIndex + itemIndex) % 2 === 0)
        ? Math.floor(Math.min(slackY, tileHeight * 0.08))
        : hasLargeSlack
          ? -Math.floor(Math.min(slackY, tileHeight * 0.08))
          : 0;
      const left = baseLeft +
        Math.floor((tileWidth - targetTileWidth) / 2) +
        checkerShiftX;
      const adjustedTop = top +
        Math.floor((tileHeight - targetTileHeight) / 2) +
        checkerShiftY;

      const resized = await sharp(cover.imageData)
        .resize(targetTileWidth, targetTileHeight, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png({ compressionLevel: 9, palette: true, quality: 90 })
        .toBuffer();

      composites.push({ input: resized, left, top: adjustedTop });
    }
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
