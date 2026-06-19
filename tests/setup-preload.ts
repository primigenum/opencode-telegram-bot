import { shim } from "./helpers/vitest-shim";

// Test files import from "#vitest" (subpath alias) so the shim is loaded
// directly without relying on bun's built-in vitest namespace. This preload
// stays as a forward-compat hook in case future test files want to access
// shared setup before any test module evaluates.
void shim;
