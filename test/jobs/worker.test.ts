import { expect } from "chai";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { waitForStableFile } from "../../src/jobs/worker";

describe("job worker helpers", () => {
  it("aborts manifest wait when training child exits", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pocu-worker-"));
    const filePath = join(dir, "manifest.json");
    let aborted = false;

    const waitPromise = waitForStableFile(filePath, 50, 5_000, 25, () => aborted).catch(
      (err: Error) => err.message
    );

    await new Promise((r) => setTimeout(r, 100));
    aborted = true;

    const result = await waitPromise;
    expect(result).to.include("Aborted waiting for manifest");
  });

  it("detects a stable manifest file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pocu-worker-"));
    const filePath = join(dir, "manifest.json");
    writeFileSync(filePath, '{"ok":true}');

    await waitForStableFile(filePath, 50, 5_000, 25);
  });
});
