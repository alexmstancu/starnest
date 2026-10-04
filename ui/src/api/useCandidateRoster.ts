/**
 * Re-exported so a screen asking for the roster does not import a module named for names.
 *
 * `useCandidateNames` owns the shared fetch; both shapes come out of the one request. This
 * file exists because `import { useCandidateRoster } from "./useCandidateNames"` reads as a
 * mistake at every call site, and a reader should not have to know which of the two was
 * written first.
 */
export { useCandidateRoster } from "./useCandidateNames";
