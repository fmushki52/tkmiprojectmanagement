import type { Metadata, Viewport } from "next";
import { Inconsolata, Poppins } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const poppins = Poppins({ variable: "--font-sans", subsets: ["latin"], weight: ["300", "400", "500", "600", "700"] });
const inconsolata = Inconsolata({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Project Tracker", template: "%s · Project Tracker" },
  description: "Plan projects, track milestones and tasks, monitor progress and export status reports.",
  icons: { icon: "/Kuwait_Logo.png" },
};

export const viewport: Viewport = { themeColor: "#0F6E56" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${poppins.variable} ${inconsolata.variable} h-full antialiased`}>
      <body className="min-h-full bg-background text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
