import { Header } from "@/components/aurelius/header";
import { ChatClient } from "./chat-client";

export default function ChatPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <ChatClient />
    </div>
  );
}
