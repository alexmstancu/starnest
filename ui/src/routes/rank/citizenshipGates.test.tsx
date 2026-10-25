import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { replaceHousehold, setMatchRuleEnforcement } from "../../api/endpoints";
import { HOUSEHOLD } from "../../mocks/fixtures";
import { renderShell } from "../../testing/renderShell";

/**
 * PL-164 (Q239). **A gate the household's citizenships decide reads no answer**: the reason
 * names the citizenships it read, by the roster's names, and never claims an answer was
 * recorded. The mock decides it as `rules.py` does: Netherlands is where it asks free movement.
 */
const FREE_MOVEMENT = "country.eu_free_movement";

async function reasonFor(name: string): Promise<HTMLElement> {
  const table = await screen.findByRole("table", { name: /ranked candidates/i });
  const heading = within(table)
    .getAllByRole("rowheader")
    .find((cell) => cell.textContent?.trim() === name);
  expect(heading, `no row for ${name}`).toBeDefined();
  return heading!.closest("tr")!.querySelector<HTMLElement>(".reason-cell")!;
}

describe("a gate decided by citizenship, on Rank", () => {
  it("names the household citizenships it read, never an id, and claims no answer", async () => {
    await replaceHousehold({ ...HOUSEHOLD, citizenships: ["country.united_kingdom"] });
    await setMatchRuleEnforcement("default", FREE_MOVEMENT, true);
    renderShell("/rank");

    const reason = await reasonFor("Netherlands");

    expect(
      await within(reason).findByText(
        "Free movement applies: no citizenship the household holds (United Kingdom) clears it. Cleared only where yours does: United Kingdom (in Ireland). Decided by citizenship alone; no answer was recorded or read.",
      ),
    ).toBeInTheDocument();
    expect(reason).not.toHaveTextContent(/country\.|united_kingdom/);
  });

  it("says where a held citizenship clears it instead, as the Common Travel Area does", async () => {
    await replaceHousehold({ ...HOUSEHOLD, citizenships: ["country.united_kingdom"] });
    await setMatchRuleEnforcement("default", FREE_MOVEMENT, true);
    renderShell("/rank");

    const reason = await reasonFor("Netherlands");

    // 0526: a British passport clears free movement in Ireland alone, which the verdict names.
    expect(
      await within(reason).findByText(
        /^Free movement applies: no citizenship the household holds \(United Kingdom\) clears it\. Cleared only where yours does: United Kingdom \(in Ireland\)\./,
      ),
    ).toBeInTheDocument();
  });

  it("says it as a warning where the set holds the gate as one", async () => {
    await replaceHousehold({ ...HOUSEHOLD, citizenships: ["country.united_kingdom"] });
    await setMatchRuleEnforcement("default", FREE_MOVEMENT, true, "warning");
    renderShell("/rank");

    const reason = await reasonFor("Netherlands");

    const warned = await within(reason).findByText(/no citizenship the household holds/);
    expect(warned).toHaveTextContent(
      "warningFree movement applies: no citizenship the household holds (United Kingdom) clears it.",
    );
  });

  it("rules nothing out where a held citizenship clears the gate", async () => {
    await setMatchRuleEnforcement("default", FREE_MOVEMENT, true);
    renderShell("/rank");

    // The mock household holds Romania's, which carries free movement.
    expect(await reasonFor("Netherlands")).not.toHaveTextContent(/free movement/i);
  });

  it("names every citizenship it read, together", async () => {
    await replaceHousehold({
      ...HOUSEHOLD,
      citizenships: ["country.united_kingdom", "country.brazil"],
    });
    await setMatchRuleEnforcement("default", FREE_MOVEMENT, true);
    renderShell("/rank");

    // A citizenship the roster does not hold is named from its id made readable, never as one.
    expect(
      await within(await reasonFor("Netherlands")).findByText(
        /^Free movement applies: no citizenship the household holds \(Brazil and United Kingdom\) clears it/,
      ),
    ).toBeInTheDocument();
  });

  it("keeps it in a saved ranking, with the citizenships it read and no answer", async () => {
    await replaceHousehold({ ...HOUSEHOLD, citizenships: ["country.united_kingdom"] });
    await setMatchRuleEnforcement("default", FREE_MOVEMENT, true);
    renderShell("/rank");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /save this ranking/i }),
      ).not.toHaveAttribute("aria-disabled", "true"),
    );
    await userEvent.click(screen.getByRole("button", { name: /save this ranking/i }));
    await userEvent.click(await screen.findByRole("button", { name: /^save$/i }));
    const list = within(await screen.findByRole("region", { name: /saved rankings/i }));
    await userEvent.click((await list.findAllByRole("link"))[0]!);
    const opened = await screen.findByRole("region", { name: /a saved ranking/i });
    const frozen = await within(opened).findByRole("table", { name: /ranked candidates/i });
    await userEvent.click(within(frozen).getByRole("button", { name: "Netherlands" }));

    const evidence = within(
      await within(opened).findByRole("list", { name: /what the rules read/i }),
    );
    expect(
      evidence.getByText(/no citizenship the household holds \(United Kingdom\) clears it/),
    ).toBeInTheDocument();
    expect(evidence.queryByText(/gate answer/i)).toBeNull();
  });
});
