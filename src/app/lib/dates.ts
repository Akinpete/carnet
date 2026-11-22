/** "SAMEDI 22 NOV": dates are shown in French, in the mono label style. */
export function frenchDayLabel(date: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month").replace(".", "")}`.toUpperCase();
}
