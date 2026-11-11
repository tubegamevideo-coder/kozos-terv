import { getOAuthEndpoints } from '../../../lib/server/auth';

export const POST = ({ request }: { request: Request }) => getOAuthEndpoints().token(request);
export const OPTIONS = () => getOAuthEndpoints().options();
