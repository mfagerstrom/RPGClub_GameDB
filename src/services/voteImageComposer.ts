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
const BASE_CANVAS_HEIGHT = 1080;
const OUTER_MARGIN_TOP = 0;
const OUTER_MARGIN_BOTTOM = 0;
const OUTER_MARGIN_SIDE = 0;
const TILE_GAP = 5;

type GridDimensions = {
  cols: number;
  rows: number;
};

function resolveGridDimensions(count: number): GridDimensions {
  if (count <= 1) return { cols: 1, rows: 1 };
  if (count === 2) return { cols: 2, rows: 1 };
  if (count === 3) return { cols: 3, rows: 1 };
  if (count === 4) return { cols: 2, rows: 2 };

  const estimatedCols = Math.ceil(Math.sqrt((count * CANVAS_WIDTH) / BASE_CANVAS_HEIGHT));
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
  const baseUsableHeight = BASE_CANVAS_HEIGHT - OUTER_MARGIN_TOP - OUTER_MARGIN_BOTTOM;
  const tileHeight = Math.floor((baseUsableHeight - TILE_GAP * (rows - 1)) / rows);
  const contentHeight = rows * tileHeight + (rows - 1) * TILE_GAP;
  const canvasHeight = OUTER_MARGIN_TOP + contentHeight + OUTER_MARGIN_BOTTOM;

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

  return sharp({
    create: {
      width: CANVAS_WIDTH,
      height: canvasHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toBuffer();
}
