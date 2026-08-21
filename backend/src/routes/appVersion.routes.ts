import { Router } from 'express';
import * as c from '../controllers/appVersion.controller';

// Mounted at /app-version BEFORE the global requireAuth — see the controller
// for why this has to answer to unauthenticated clients.
export const appVersionRouter = Router();

appVersionRouter.get('/', c.getAppVersion);
