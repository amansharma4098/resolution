import { z } from "zod";

/** Which Datadog region/site this org's account lives in — defaults to the US1 site
 *  (`datadoghq.com`); orgs on the EU site or another region set this to override. */
export const DatadogConfigSchema = z.object({
  site: z.string().min(1).default("datadoghq.com"),
});
