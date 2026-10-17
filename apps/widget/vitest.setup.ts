import { cleanup } from "@testing-library/preact";
import { afterAll, afterEach } from "vitest";

afterEach(cleanup);

// Preact runs effects after paint on a short timer; let any still pending
// run before the file's jsdom is torn down, or they hit a missing `document`.
afterAll(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));
