import axios from "axios";

interface TwitchAuthResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

// Basic IGDB Game interface for search results
export interface IGDBGame {
  id: number;
  name: string;
  cover?: {
    image_id: string;
  };
  summary?: string;
  first_release_date?: number; // Unix timestamp
  total_rating?: number;
  url?: string;
  platforms?: { id: number }[];
}

// Detailed IGDB Game interface
export interface IGDBGameDetails extends IGDBGame {
  slug: string;
  genres?: { id: number; name: string }[];
  artworks?: { image_id: string }[];
  videos?: { video_id: string; name?: string }[];
  themes?: { id: number; name: string }[];
  game_modes?: { id: number; name: string }[];
  player_perspectives?: { id: number; name: string }[];
  franchises?: { id: number; name: string }[];
  game_engines?: { id: number; name: string }[];
  collection?: { id: number; name: string }; // Series
  parent_game?: { id: number; name: string }; // Spin-off/DLC parent
  involved_companies?: {
    company: { id: number; name: string };
    developer: boolean;
    publisher: boolean;
  }[];
  platforms?: {
    id: number;
    name: string;
    platform_logo?: { image_id: string };
    websites?: { category: number; url: string }[];
  }[];
  release_dates?: {
    platform: { id: number; name: string };
    region: number; // 1: Europe, 2: North America, 3: Australia, 4: New Zealand, 5: Japan, 6: China, 7: Asia, 8: Worldwide
    date: number; // Unix timestamp
    y: number;
    m: number;
    category?: number;
  }[];
}

export interface IGDBPlatform {
  id: number;
  name: string;
  abbreviation?: string;
  slug?: string;
  checksum?: string;
  updated_at?: number;
}

export const IGDB_SEARCH_LIMIT = 500;

export interface IGameSearchResult {
  results: IGDBGame[];
  raw: any;
  total?: number;
}

class IgdbService {
  private accessToken: string | null = null;
  private tokenExpiry: number = 0; // Unix timestamp

  constructor() {
    // Config is read lazily via getters to allow dotenv to populate env before use
    if (!process.env.IGDB_CLIENT_ID || !process.env.IGDB_CLIENT_SECRET) {
      console.error("IGDB_CLIENT_ID or IGDB_CLIENT_SECRET not set in environment variables.");
    }
  }

  private get clientId(): string {
    return process.env.IGDB_CLIENT_ID || "";
  }

  private get clientSecret(): string {
    return process.env.IGDB_CLIENT_SECRET || "";
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      const response = await axios.post<TwitchAuthResponse>(
        `https://id.twitch.tv/oauth2/token?client_id=${this.clientId}` +
        `&client_secret=${this.clientSecret}&grant_type=client_credentials`,
      );

      this.accessToken = response.data.access_token;
      this.tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000;
      console.log("IGDB: Fetched new Twitch access token.");
      return this.accessToken;
    } catch (error) {
      console.error("IGDB: Failed to fetch Twitch access token:", error);
      throw new Error("IGDB service unavailable: Could not authenticate with Twitch.");
    }
  }

  async searchGames(
    query: string,
    limit: number = IGDB_SEARCH_LIMIT,
    includeRaw: boolean = false,
  ): Promise<IGameSearchResult> {
    if (!this.clientId) {
      throw new Error("IGDB service not configured.");
    }
    const token = await this.getAccessToken();

    const sanitizedQuery = query.replace(/"/g, '\\"');
    const cappedLimit = Math.min(limit ?? IGDB_SEARCH_LIMIT, IGDB_SEARCH_LIMIT);
    const buildBody = (): string =>
      [
        "fields name, cover.image_id, summary, first_release_date, total_rating, url, platforms.id;",
        `search "${sanitizedQuery}";`,
        `limit ${cappedLimit};`,
      ].join(" ");

    try {
      const response = await axios.post<IGDBGame[]>(
        "https://api.igdb.com/v4/games",
        buildBody(),
        {
          headers: {
            "Client-ID": this.clientId,
            "Authorization": `Bearer ${token}`,
            "Content-Type": "text/plain",
          },
        },
      );

      return {
        results: response.data,
        raw: includeRaw ? response.data : null,
        total: parseInt(response.headers?.["x-count"] as string, 10) || response.data.length,
      };
    } catch (error: any) {
      console.error("IGDB: Failed to search games:", error);
      throw new Error(`IGDB service unavailable: Could not search for games. Error: ${error.message}`);
    }
  }

  private async fetchReleaseDates(
    igdbId: number,
    token: string,
  ): Promise<NonNullable<IGDBGameDetails["release_dates"]>> {
    const body = [
      "fields date, y, m, region, category, platform.id, platform.name;",
      `where game = ${igdbId};`,
      "sort date asc;",
      "limit 500;",
    ].join(" ");

    const response = await axios.post<
      {
        date: number;
        y: number;
        m: number;
        region: number;
        category?: number;
        platform?: { id: number; name: string };
      }[]
    >(
      "https://api.igdb.com/v4/release_dates",
      body,
      {
        headers: {
          "Client-ID": this.clientId,
          "Authorization": `Bearer ${token}`,
          "Content-Type": "text/plain",
        },
      },
    );

    return (response.data ?? []).map((r) => ({
      platform: r.platform ?? { id: 0, name: "Unknown Platform" },
      region: r.region,
      date: r.date,
      y: r.y,
      m: r.m,
      category: r.category,
    }));
  }

  async getGameDetailsBySearch(query: string): Promise<IGDBGameDetails | null> {
    const search = await this.searchGames(query, 1);
    const first = search.results[0];
    if (!first) return null;
    return this.getGameDetails(first.id);
  }

  async getGameDetails(igdbId: number): Promise<IGDBGameDetails | null> {
    if (!this.clientId) {
      throw new Error("IGDB service not configured.");
    }
    const token = await this.getAccessToken();

    const fields = [
      "name",
      "slug",
      "summary",
      "first_release_date",
      "cover.image_id",
      "artworks.image_id",
      "genres.name",
      "platforms.id",
      "platforms.name",
      "platforms.platform_logo.image_id",
      "release_dates.platform",
      "release_dates.platform.name",
      "release_dates.region",
      "release_dates.date",
      "release_dates.y",
      "release_dates.m",
      "release_dates.category",
      "themes.name",
      "game_modes.name",
      "player_perspectives.name",
      "franchises.name",
      "collection.name",
      "game_engines.name",
      "parent_game.name",
      "involved_companies.company.name",
      "involved_companies.developer",
      "involved_companies.publisher",
      "videos.video_id",
      "total_rating",
      "url",
    ].join(", ");

    const body = `fields ${fields}; where id = ${igdbId};`;

    try {
      const response = await axios.post<IGDBGameDetails[]>(
        "https://api.igdb.com/v4/games",
        body,
        {
          headers: {
            "Client-ID": this.clientId,
            "Authorization": `Bearer ${token}`,
            "Content-Type": "text/plain",
          },
        },
      );

      const details = response.data[0] || null;
      if (!details) return null;

      if (!details.release_dates || details.release_dates.length === 0) {
        try {
          const releases = await this.fetchReleaseDates(igdbId, token);
          details.release_dates = releases;
        } catch (err) {
          console.warn("IGDB: Failed to fetch release_dates via fallback endpoint:", err);
        }
      }

      return details;
    } catch (error: any) {
      console.error("IGDB: Failed to get game details:", error);
      throw new Error(`IGDB service unavailable: Could not retrieve game details. Error: ${error.message}`);
    }
  }

  async getPlatformsPage(
    limit: number,
    offset: number,
  ): Promise<IGDBPlatform[]> {
    if (!this.clientId) {
      throw new Error("IGDB service not configured.");
    }
    const token: string = await this.getAccessToken();
    const cappedLimit: number = Math.min(Math.max(limit, 1), 500);
    const body: string = [
      "fields id, name, abbreviation, slug, checksum, updated_at;",
      `limit ${cappedLimit};`,
      `offset ${offset};`,
      "sort id asc;",
    ].join(" ");

    try {
      const response = await axios.post<IGDBPlatform[]>(
        "https://api.igdb.com/v4/platforms",
        body,
        {
          headers: {
            "Client-ID": this.clientId,
            "Authorization": `Bearer ${token}`,
            "Content-Type": "text/plain",
          },
        },
      );

      return response.data ?? [];
    } catch (error: any) {
      console.error("IGDB: Failed to fetch platforms:", error);
      throw new Error(
        `IGDB service unavailable: Could not fetch platforms. Error: ${error.message}`,
      );
    }
  }

  // Helper to get image URL from image_id
  static getCoverImageUrl(imageId: string, size: string = "cover_big"): string {
    return `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg`;
  }
}

export const igdbService = new IgdbService();
