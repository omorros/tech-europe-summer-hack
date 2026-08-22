import { IncidentProvider } from "@/lib/incident-context";

/**
 * /console and /video share one run. This layout does not remount when you
 * move between them, so the incident survives the navigation.
 */
export default function IncidentLayout({ children }: { children: React.ReactNode }) {
  return <IncidentProvider>{children}</IncidentProvider>;
}
