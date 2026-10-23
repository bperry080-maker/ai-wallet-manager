import { ChatInterface } from '@/components/chat/chat-interface';
import { WalletPanel } from '@/components/wallet/wallet-panel';

export default function Home() {
  return (
    <main className="min-h-screen bg-white dark:bg-gray-950">
      <WalletPanel />
      <div className="border-t border-gray-200 dark:border-gray-800">
        <div className="mx-auto max-w-5xl px-4 pt-8">
          <h2 className="text-xl font-semibold text-gray-950 dark:text-white">Wallet assistant</h2>
          <p className="mt-1 text-sm text-gray-500">The existing chat interface remains available below the wallet controls.</p>
        </div>
        <ChatInterface className="min-h-[70vh]" />
      </div>
    </main>
  );
}
