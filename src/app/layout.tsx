import type { Metadata } from "next";
import { inter, playfair, jetbrains } from "@/lib/fonts";
import { Toaster } from "@/components/ui/sonner";
import { ChatProvider } from "@/components/aurelius/chat-provider";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aurelius",
  description: "Personal AI Command Center",
  icons: {
    icon: "/avatars/agent.png",
    apple: "/avatars/agent.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${playfair.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <ChatProvider>
            {children}
          </ChatProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
