"use client";

import { createContext, useContext } from "react";

export interface CopilotApi {
  // Opens the copilot and sends this prompt (or just prefills it when `send` is false).
  ask(prompt: string, options?: { send?: boolean }): void;
}

export const CopilotContext = createContext<CopilotApi>({ ask: () => {} });

export function useCopilot(): CopilotApi {
  return useContext(CopilotContext);
}
