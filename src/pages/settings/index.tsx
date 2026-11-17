import { useServer } from "@/store/server";
import { KnowledgeSection } from "./Knowledge";
import { SecretsSection } from "./Secrets";
import { ServerSection } from "./Server";

export function SettingsPage() {
  const connected = useServer((s) => s.status === "connected");
  return (
    <div className="h-full overflow-y-auto p-3 md:p-6">
      <div className="mx-auto max-w-4xl space-y-3">
        <ServerSection />
        {connected && <SecretsSection />}
        {connected && <KnowledgeSection />}
      </div>
    </div>
  );
}
