import { getDb } from '../db/client';
import { getAuthConfig } from './config';
import { oauthEndpoints } from './endpoints';

let endpoints: ReturnType<typeof oauthEndpoints> | null = null;
export const getOAuthEndpoints = () => (endpoints ??= oauthEndpoints(getDb(), getAuthConfig()));
