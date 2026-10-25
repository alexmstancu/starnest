import { Link } from "react-router-dom";
import { isApiError } from "../../api/ApiError";
import { presentError } from "../../api/errorPresentation";
import { remedyFor, remedyLink } from "../../shell/refusalRemedy";

/**
 * Where to go to lift a refused act, drawn inside its refusal (PL-120): an estimate with every
 * source switched off points at Source priority, one the refetch age emptied at that setting.
 * Nothing when going somewhere would not lift it.
 */
export function RemedyLink({ error }: { error: unknown }) {
  const remedy = remedyFor(
    presentError(error).code,
    isApiError(error) ? error.details : undefined,
  );
  if (remedy === null) return null;
  return (
    <Link className="button" to={remedyLink(remedy)}>
      {remedy.label}
    </Link>
  );
}
