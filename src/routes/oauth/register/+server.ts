import { getOAuthEndpoints } from '../../../lib/server/auth';

export const POST = ({ request }: { request: Request }) => getOAuthEndpoints().register(request);
export const OPTIONS = () => getOAuthEndpoints().options();
