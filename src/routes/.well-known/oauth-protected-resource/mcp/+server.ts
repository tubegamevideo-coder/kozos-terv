import { getOAuthEndpoints } from '../../../../lib/server/auth';

/** RFC 9728: az erőforrás útvonalával kiegészített metaadat-cím (/mcp). */
export const GET = () => getOAuthEndpoints().protectedResourceMetadata();
export const OPTIONS = () => getOAuthEndpoints().options();
