import { registerIntegration } from "@/integrations/registry";
import { googleChatManifest } from "./manifest";

// Self-register when this module is imported (side-effect import in integrations-context.tsx)
registerIntegration(googleChatManifest);

export { googleChatManifest };
