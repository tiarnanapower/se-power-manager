"use client";

import { GlobalStyles } from "@bigcommerce/big-design";
import { theme as lightTheme } from "@bigcommerce/big-design-theme";
import { ThemeProvider } from "styled-components";

// BigDesign only ships a light theme, so its greys are flipped to the dark
// Commerce palette in globals.css. Text, borders and surfaces all follow.
const FONT = 'var(--font-sans), "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const theme = {
  ...lightTheme,
  typography: { ...lightTheme.typography, fontFamily: FONT },
  colors: {
    ...lightTheme.colors,
    white: "#170245",
    secondary10: "#0c0128",
    secondary20: "#1f0b5c",
    secondary30: "#2d2d83",
    secondary40: "#4a46b0",
    secondary50: "#aaa8da",
    secondary60: "#cfcdf2",
    secondary70: "#f5f3f2",
    brand: "#6058ff",
    primary: "#6058ff",
    primary10: "rgba(96, 88, 255, 0.14)",
    primary20: "rgba(96, 88, 255, 0.24)",
    primary30: "#8f86ff",
    primary40: "#6058ff",
    primary50: "#8f86ff",
    primary60: "#bfbfff",
    primary70: "#d4d0ff",
    danger10: "rgba(240, 84, 91, 0.14)",
    danger20: "rgba(240, 84, 91, 0.24)",
    warning10: "rgba(240, 160, 32, 0.14)",
    warning20: "rgba(240, 160, 32, 0.24)",
    success10: "rgba(46, 212, 122, 0.14)",
    success20: "rgba(46, 212, 122, 0.24)",
  },
};

export function BigDesignProvider({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <GlobalStyles />
      {children}
    </ThemeProvider>
  );
}
