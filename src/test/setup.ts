// Vitest global setup. Referenced by vite.config.ts -> test.setupFiles.
// Adds jest-dom matchers (toBeInTheDocument, etc.) for any future component tests.
// Excluded from the production build via tsconfig.app.json "exclude".
import "@testing-library/jest-dom";
