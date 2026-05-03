/**
 * Smart link providers entry-point.
 *
 * Import this module (side-effect) to ensure all built-in providers are
 * registered in the registry before detection runs.
 *
 * This must be a separate file from registry.ts to break the circular
 * dependency (providers import `registerProvider` from registry).
 */

import "@/lib/smart-links/providers/github";
import "@/lib/smart-links/providers/linear";
