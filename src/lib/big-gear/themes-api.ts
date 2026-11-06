import "server-only";
import { V3ListResponse } from "@/lib/bc-api-client/rest-client/types";
import { getBigGearRestClient } from "@/lib/big-gear/config";
import { Channel } from "@/lib/channels/types";

export interface ThemeVariation {
  uuid: string;
  name: string;
}

export interface Theme {
  uuid: string;
  name: string;
  is_private?: boolean;
  variations?: ThemeVariation[];
}

export interface BigGearChannel extends Channel {
  type?: string;
  platform?: string;
  status?: string;
}

// Read-only. Needs "Themes: read-only" (themes) and "Channel settings:
// read-only" (channels) on the Big Gear token.
export async function listBigGearThemes(): Promise<Theme[]> {
  const { data } = await getBigGearRestClient().get<{ data: Theme[] }>("/v3/themes");

  return data.data;
}

export async function listBigGearChannels(): Promise<BigGearChannel[]> {
  const { data } = await getBigGearRestClient().get<V3ListResponse<BigGearChannel>>("/v3/channels");

  return data.data;
}
