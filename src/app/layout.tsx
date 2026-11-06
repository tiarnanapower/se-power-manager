import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { BigDesignProvider } from "@/components/ui/big-design-provider";
import { StyledComponentsRegistry } from "@/components/ui/styled-components-registry";
import { ActionAlertsManager } from "@/components/ui/action-alerts";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SE Power Manager",
  description: "Import, manage and restore demo catalogs on your BigCommerce store.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
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
