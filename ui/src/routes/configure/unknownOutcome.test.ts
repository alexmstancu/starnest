import { describe, expect, it, vi } from "vitest";
import { ApiError, CLIENT_ERROR_CODES } from "../../api/ApiError";
import { settledUndo, UnconfirmedUndo } from "./unknownOutcome";

/**
 * P105. **An undo reads back what it did, as a write does.** What it found decides what the
 * history does with the change: undone, it goes; not undone, it stays; not yet known, it stays
 * listed unconfirmed -- and the read-back it carries answers whether the change is still in force.
 */

const LOST = new ApiError({ code: CLIENT_ERROR_CODES.unreachable, message: "no answer" });

describe("an undo sent back", () => {
  it("shows what it did when it is answered", async () => {
    const show = vi.fn();

    await settledUndo(() => Promise.resolve("back"), () => Promise.resolve(null), show);

    expect(show).toHaveBeenCalledWith("back");
  });

  it("shows what the read-back found when its answer was lost and it landed", async () => {
    const show = vi.fn();

    await settledUndo(() => Promise.reject(LOST), () => Promise.resolve("read"), show);

    expect(show).toHaveBeenCalledWith("read");
  });

  it("fails as it was refused when the read-back finds it did not land", async () => {
    const show = vi.fn();

    await expect(
      settledUndo(() => Promise.reject(LOST), () => Promise.resolve(null), show),
    ).rejects.toBe(LOST);
    expect(show).not.toHaveBeenCalled();
  });

  it("is unconfirmed, never failed, when nothing can say whether it landed", async () => {
    const failed = await settledUndo(
      () => Promise.reject(LOST),
      () => Promise.reject(LOST),
      vi.fn(),
    ).catch((error: unknown) => error);

    expect(failed).toBeInstanceOf(UnconfirmedUndo);
  });

  it("answers, checked again, whether the change is still in force", async () => {
    const reads = [Promise.reject(LOST), Promise.resolve(null), Promise.resolve("read")];
    reads[0]!.catch(() => undefined);
    const show = vi.fn();
    const failed = (await settledUndo(
      () => Promise.reject(LOST),
      () => reads.shift()!,
      show,
    ).catch((error: unknown) => error)) as UnconfirmedUndo;

    // Not undone yet: still in force, and nothing shown.
    expect(await failed.pending.unconfirmed()).toBe(true);
    expect(show).not.toHaveBeenCalled();
    // Undone now: no longer in force, and what it found is shown.
    expect(await failed.pending.unconfirmed()).toBe(false);
    expect(show).toHaveBeenCalledWith("read");
  });
});
