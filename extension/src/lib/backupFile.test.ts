// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { downloadJson, readFileAsJson, isRemoteState } from "./backupFile";

describe("downloadJson", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates an object URL, clicks a download link with it, then revokes it", () => {
    const createObjectURL = vi.fn(() => "blob:fake-url");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadJson("backup.json", { hello: "world" });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
  });
});

describe("readFileAsJson", () => {
  it("parses a File's text content as JSON", async () => {
    const file = new File([JSON.stringify({ a: 1 })], "data.json", { type: "application/json" });
    await expect(readFileAsJson(file)).resolves.toEqual({ a: 1 });
  });
});

describe("isRemoteState", () => {
  it("accepts a value with workspaces/folders/entries arrays", () => {
    expect(isRemoteState({ workspaces: [], folders: [], entries: [] })).toBe(true);
  });

  it("rejects null", () => {
    expect(isRemoteState(null)).toBe(false);
  });

  it("rejects a non-object", () => {
    expect(isRemoteState("nope")).toBe(false);
  });

  it("rejects an object missing one of the arrays", () => {
    expect(isRemoteState({ workspaces: [], folders: [] })).toBe(false);
  });

  it("rejects an object where a field isn't an array", () => {
    expect(isRemoteState({ workspaces: {}, folders: [], entries: [] })).toBe(false);
  });
});
