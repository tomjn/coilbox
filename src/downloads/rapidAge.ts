/** "refreshed 3 min ago" for a rapid index fetched `ageSecs` seconds ago. */
export function refreshedLabel(ageSecs: number): string {
  if (ageSecs < 60) return "refreshed just now";
  const mins = Math.floor(ageSecs / 60);
  if (mins < 60) return `refreshed ${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `refreshed ${hours} h ago`;
  return `refreshed ${Math.floor(hours / 24)} d ago`;
}
