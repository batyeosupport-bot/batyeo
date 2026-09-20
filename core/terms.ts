/**
 * The version a customer's acceptance is recorded against. It used to be `demo-2026-09-v1`, which
 * would have made every real acceptance point at a document labelled "démonstration". Bumping this
 * string is what makes a change of terms auditable: past rentals keep the version they accepted.
 */
export const TERMS_VERSION=typeof process!=='undefined'&&process.env.TERMS_VERSION?process.env.TERMS_VERSION:'2026-09-v1';
export const TERMS_VERSION_LABEL=`CONDITIONS · VERSION ${TERMS_VERSION}`;
