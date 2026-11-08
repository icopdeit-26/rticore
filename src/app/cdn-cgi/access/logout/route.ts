import {NextResponse} from 'next/server';
import {LOCAL_SESSION_COOKIE} from '@/lib/local-auth';
import {ROLE_PREVIEW_COOKIE} from '@/lib/role-preview';

/**
 * In Cloudflare, /cdn-cgi/access/logout is served by Cloudflare Access before
 * the Worker runs, so this handler is only reached when RTICORE runs locally.
 * It clears the local session and returns to the login page.
 */
export function GET(request:Request){
  const response=NextResponse.redirect(new URL('/login',request.url),303);
  response.cookies.delete(LOCAL_SESSION_COOKIE);
  response.cookies.delete(ROLE_PREVIEW_COOKIE);
  response.headers.set('Cache-Control','no-store');
  return response;
}
