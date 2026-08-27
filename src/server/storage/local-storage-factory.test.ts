import { describe, expect, test } from "vitest";

import { createPrivateStorage } from "./local-storage";

describe("local-only private storage factory", () => {
  test("uses LOCAL_STORAGE_PATH without a storage driver", () => {
    expect(createPrivateStorage({ NODE_ENV: "development", LOCAL_STORAGE_PATH: "C:/tmp/private" }).constructor.name)
      .toBe("LocalPrivateStorage");
  });

  test("allows production only for an explicitly local runtime", () => {
    expect(() => createPrivateStorage({ NODE_ENV: "production", LOCAL_STORAGE_PATH: "C:/tmp/private" }))
      .toThrow("LOCAL_STORAGE_FORBIDDEN_IN_PRODUCTION");
    expect(() => createPrivateStorage({
      NODE_ENV: "production",
      LOCAL_RUNTIME_MODE: "1",
      APP_URL: "https://creator.example",
      LOCAL_STORAGE_PATH: "C:/tmp/private",
    })).toThrow("LOCAL_STORAGE_FORBIDDEN_IN_PRODUCTION");
    expect(createPrivateStorage({
      NODE_ENV: "production",
      LOCAL_RUNTIME_MODE: "1",
      APP_URL: "http://127.0.0.1:3000",
      LOCAL_STORAGE_PATH: "C:/tmp/private",
    }).constructor.name).toBe("LocalPrivateStorage");
  });
});
