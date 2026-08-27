import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { PwaRegister } from "./pwa-register";

describe("PWA registration", () => {
  afterEach(() => vi.restoreAllMocks());

  test("registers the same-origin service worker after mount", async () => {
    const register = vi.fn(async () => ({}));
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register } });
    render(<PwaRegister />);
    await waitFor(() => expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" }));
  });
});
