/**
 * Route target for the Options Workspace. Wraps the shell in the live-data provider so
 * every panel shares a single broker feed. Mounted at /options (see App.tsx).
 */

import { OptionsDataProvider } from "./state/OptionsDataProvider";
import { StrategyProvider } from "./state/StrategyProvider";
import { OptionsWorkspace } from "./OptionsWorkspace";

export function OptionsTerminal() {
  return (
    <OptionsDataProvider>
      <StrategyProvider>
        <OptionsWorkspace />
      </StrategyProvider>
    </OptionsDataProvider>
  );
}

export default OptionsTerminal;
