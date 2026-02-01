import type { Metadata } from "next";
import { inter, playfair, jetbrains } from "@/lib/fonts";
import { Toaster } from "@/components/ui/sonner";
import { ChatProvider } from "@/components/aurelius/chat-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aurelius",
  description: "Personal AI Command Center",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${playfair.variable} ${jetbrains.variable} dark`}
    >
      <body className="min-h-screen bg-background font-sans antialiased">
        <ChatProvider>
          {children}
        </ChatProvider>
        <Toaster />
      </body>
    </html>
  );
}
