import { getOAuthEndpoints } from '../../../lib/server/auth';

export const GET = () => getOAuthEndpoints().protectedResourceMetadata();
export const OPTIONS = () => getOAuthEndpoints().options();
