import { Router } from 'express';
import * as c from '../controllers/linkedin.controller';

// Split in two because the callback leg is a plain browser navigation from
// linkedin.com with NO Authorization header — it must be mounted PUBLIC
// (before the global requireAuth) and authenticate via the signed OAuth
// state cookie instead. `authorize`/`status`/`disconnect` are ordinary
// authenticated XHRs from the frontend and stay behind requireAuth.
export const linkedinPublicRouter = Router();
linkedinPublicRouter.get('/callback', c.callback);

export const linkedinRouter = Router();
linkedinRouter.get('/authorize', c.authorize);
linkedinRouter.get('/status', c.status);
linkedinRouter.post('/disconnect', c.disconnect);
