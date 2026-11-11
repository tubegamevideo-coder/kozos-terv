import { getOAuthEndpoints } from '../../../lib/server/auth';

export const GET = () => getOAuthEndpoints().authServerMetadata();
export const OPTIONS = () => getOAuthEndpoints().options();
