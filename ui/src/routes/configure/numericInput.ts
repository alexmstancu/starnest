/**
 * What a reader may type into a field that holds a number.
 *
 * **Every one of these was a plain text box.** "about 2000" went into a monthly spend, "abc12x"
 * into the spend cap, and `Number()` turned each into `NaN` — which the form then rendered as
 * an empty field, so the figure vanished without a word. Filtering as it is typed means the box
 * can only ever hold something that parses.
 *
 * **Shared by Configure's household and its limits**, which is why it sits here rather than in
 * either panel: both ask the same question of a keystroke.
 *
 * **A minus sign is never kept.** Every field this guards is a cost, a count, a percentage or a
 * stated income, and each is floored at zero by the schema or by the domain. A negative rent is
 * not a thing to type.
 */
export function onlyNumberCharacters(
  typed: string,
  { whole = false }: { whole?: boolean } = {},
): string {
  let seenPoint = false;
  let kept = "";
  for (const each of typed) {
    if (each >= "0" && each <= "9") {
      kept += each;
      continue;
    }
    // **A comma becomes a point**, because half of Europe types one and the field is read with
    // `Number()`, which accepts only the point. Refusing the comma would teach the reader their
    // keyboard is wrong; accepting it and storing it would store something that parses to NaN.
    if (!whole && !seenPoint && (each === "." || each === ",")) {
      seenPoint = true;
      kept += ".";
      continue;
    }
    // **A separator this field cannot take ends the number; it does not vanish from the middle
    // of it.** Dropping it used to glue the digits across it: "5.5" in a field that counts
    // became fifty-five, and "1.2.3" became one-and-twenty-three hundredths. Both are
    // schema-valid, so nothing downstream objected -- a reader asking to refetch anything older
    // than 5.5 days would silently have asked for 55.
    //
    // It does not rescue every route to the same mistake: typing 5, then a point that is
    // dropped, then 5 appends to a box reading "5" and gives 55 anyway, because a filter sees
    // one keystroke at a time and not the intent behind it. It fixes the pasted value and the
    // value typed faster than the box redraws, which is where this actually bites.
    if (each === "." || each === ",") break;
  }
  return kept;
}
