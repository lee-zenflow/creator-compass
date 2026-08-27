import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const styles = readFileSync(resolve("src/app/globals.css"), "utf8");

describe("positioning screens keep the 1111.fig density", () => {
  test("uses compact record, candidate, and task heights without shadows or gradients", () => {
    expect(styles).toMatch(/\.positioning-record\s*\{[\s\S]*?min-height:\s*64px/);
    expect(styles).toMatch(/\.candidate-card\s*\{[^}]*height:\s*148px[^}]*overflow:\s*hidden/);
    expect(styles).toMatch(/\.positioning-task-card\s*\{[^}]*height:\s*84px[^}]*overflow:\s*hidden/);
    expect(styles).not.toMatch(/\.candidate-card\s*\{[^}]*(box-shadow|gradient)/);
  });

  test("styles processing as one compact truthful phase and candidates as coordinates", () => {
    expect(styles).toMatch(/\.position-run-state\[data-phase="processing"\]\s*\{[^}]*min-height:\s*48px/);
    expect(styles).toMatch(/\.candidate-card__coordinate\s*\{[^}]*position:\s*absolute/);
    expect(styles).toMatch(/\.candidate-card__coordinate\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
  });
});
