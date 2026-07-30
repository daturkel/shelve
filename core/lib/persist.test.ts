// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { persistOrRevert } from "./persist";

describe("persistOrRevert", () => {
  afterEach(() => {
    document.querySelectorAll(".shelve-toast").forEach((el) => el.remove());
  });

  it("returns ok with no revert and doesn't touch reload/toast when save succeeds", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn().mockResolvedValue("reloaded");

    const result = await persistOrRevert(save, reload);

    expect(result).toEqual({ ok: true });
    expect(reload).not.toHaveBeenCalled();
    expect(document.querySelector(".shelve-toast")).toBeNull();
  });

  it("reloads and shows a toast when save rejects", async () => {
    const save = vi.fn().mockRejectedValue(new Error("quota exceeded"));
    const reload = vi.fn().mockResolvedValue("last-good-state");

    const result = await persistOrRevert(save, reload);

    expect(result).toEqual({ ok: false, reverted: "last-good-state" });
    expect(reload).toHaveBeenCalledOnce();
    expect(document.querySelector(".shelve-toast")?.textContent).toContain("Couldn't save your change: quota exceeded");
  });

  it("stringifies non-Error rejections in the toast message", async () => {
    const save = vi.fn().mockRejectedValue("some string rejection");
    const reload = vi.fn().mockResolvedValue("last-good-state");

    await persistOrRevert(save, reload);

    expect(document.querySelector(".shelve-toast")?.textContent).toContain(
      "Couldn't save your change: some string rejection",
    );
  });

  it("still reports failure and shows the toast if reload itself also fails", async () => {
    const save = vi.fn().mockRejectedValue(new Error("quota exceeded"));
    const reload = vi.fn().mockRejectedValue(new Error("storage totally unavailable"));

    const result = await persistOrRevert(save, reload);

    expect(result).toEqual({ ok: false, reverted: undefined });
    expect(document.querySelector(".shelve-toast")?.textContent).toContain("Couldn't save your change: quota exceeded");
  });
});
