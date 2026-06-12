import type { CreateLocalTuiClientApp } from "./local-tui-app.js";
import { createLocalTuiClientApp } from "./local-tui-app.js";

export function parseOpenTuiEnabledValue(
  rawValue: string | undefined,
): boolean {
  const configuredValue = rawValue?.trim().toLowerCase();
  return configuredValue !== "0" && configuredValue !== "false";
}

export function isOpenTuiEnabledInCurrentBuild(): boolean {
  return true;
}

export async function loadOpenTuiClientAppFactoryAtRuntime(): Promise<CreateLocalTuiClientApp> {
  return createLocalTuiClientApp;
}
