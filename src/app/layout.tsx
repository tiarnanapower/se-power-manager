import type { Metadata } from "next";
import { Source_Sans_3 } from "next/font/google";
import { BigDesignProvider } from "@/components/ui/big-design-provider";
import { StyledComponentsRegistry } from "@/components/ui/styled-components-registry";
import { ActionAlertsManager } from "@/components/ui/action-alerts";
import "./globals.css";

const sourceSans3 = Source_Sans_3({
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Power Promotions",
  description: "Plan, schedule and preview BigCommerce promotions with an AI copilot.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={sourceSans3.className}>
      <body>
        <StyledComponentsRegistry>
          <BigDesignProvider>
            {children}
            <ActionAlertsManager />
          </BigDesignProvider>
        </StyledComponentsRegistry>
      </body>
    </html>
  );
}
