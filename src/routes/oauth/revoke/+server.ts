import { getOAuthEndpoints } from '../../../lib/server/auth';

export const POST = ({ request }: { request: Request }) => getOAuthEndpoints().revoke(request);
export const OPTIONS = () => getOAuthEndpoints().options();
