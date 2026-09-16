/** Hosted vendor endpoints only: never forward tenant credentials to redirects/private hosts. */
export function validateSourceUrl(value: string, vendor: "JIRA" | "SERVICENOW"): string {
  const url = new URL(value);
  const suffix = vendor === "JIRA" ? ".atlassian.net" : ".service-now.com";
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(suffix) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.port ||
    !["", "/"].includes(url.pathname)
  ) {
    throw new Error(
      `Use your hosted ${vendor === "JIRA" ? "Jira Cloud (*.atlassian.net)" : "ServiceNow (*.service-now.com)"} HTTPS site URL`,
    );
  }
  return url.origin;
}
