import express, { Request, Response, Express } from 'express';
import session from 'express-session';
import connect from 'connect-loki';
import passport from 'passport';
import { v5 as uuidV5 } from 'uuid';
import getmac from 'getmac';
import { store } from '../store';
import * as states from '../registry/states';
import log from '../log';
import { getVersion, onConfigFileChange } from '../configuration';
import { Authentication, StrategyDescription } from '../authentications/providers/Authentication';

const LokiStore = connect(session);
const router = express.Router();

// The configured strategy ids.
const STRATEGY_IDS: string[] = [];

// Constant WUD namespace for uuid v5 bound sessions.
const WUD_NAMESPACE = 'dee41e92-5fc4-460e-beec-528c9ea7d760';

/**
 * Get all strategies id.
 */
export function getAllIds() {
    return STRATEGY_IDS;
}

/**
 * Get cookie max age.
 * @param days
 */
function getCookieMaxAge(days: number) {
    return 3600 * 1000 * 24 * days;
}

/**
 * Get session secret key (bound to wud version).
 */
function getSessionSecretKey() {
    const stringToHash = `wud.${getVersion()}.${getmac()}`;
    return uuidV5(stringToHash, WUD_NAMESPACE);
}

/**
 * Register a strategy to passport.
 * @param authentication
 * @param app
 */
function useStrategy(authentication: Authentication, app: Express) {
    try {
        const strategy = authentication.getStrategy(app);
        passport.use(authentication.getId(), strategy);
        STRATEGY_IDS.push(authentication.getId());
    } catch (e: any) {
        log.warn(
            `Unable to apply authentication ${authentication.getId()} (${e.message})`,
        );
    }
}

function getUniqueStrategies() {
    const strategies = Object.values(states.getState().authentication).map(
        (authentication) => authentication.getStrategyDescription(),
    );
    const uniqueStrategies: StrategyDescription[] = [];
    strategies.forEach((strategy) => {
        if (
            !uniqueStrategies.find(
                (item) =>
                    item.type === strategy.type && item.name === strategy.name,
            )
        ) {
            uniqueStrategies.push(strategy);
        }
    });
    return uniqueStrategies.sort((s1, s2) => s1.name.localeCompare(s2.name));
}

/**
 * Return the registered strategies from the registry.
 * @param req
 * @param res
 */
function getStrategies(req: Request, res: Response) {
    res.json(getUniqueStrategies());
}

function getLogoutRedirectUrl() {
    const strategyWithRedirectUrl = getUniqueStrategies().find(
        (strategy) => strategy.logoutUrl,
    );
    if (strategyWithRedirectUrl) {
        return strategyWithRedirectUrl.logoutUrl;
    }
    return undefined;
}

/**
 * Get current user.
 * @param req
 * @param res
 */
function getUser(req: Request, res: Response) {
    const user = req.user || { username: 'anonymous' };
    res.status(200).json(user);
}

/**
 * Login user (and return it).
 * @param req
 * @param res
 */
function login(req: Request, res: Response) {
    return getUser(req, res);
}

/**
 * Logout current user.
 * @param req
 * @param res
 */
function logout(req: Request, res: Response) {
    req.logout(() => { });
    res.status(200).json({
        logoutUrl: getLogoutRedirectUrl(),
    });
}

let initialized = false;
let isChangingConfig = false;

let lokiStore: connect.LokiStore | undefined;
/**
 * Init auth (passport.js).
 */
export function init(app: Express) {
    lokiStore = new LokiStore({
        path: `${store.getConfiguration().path}/${store.getConfiguration().file}`,
        ttl: 604800, // 7 days
    });
    // Init express session
    app.use(
        session({
            store: lokiStore,
            secret: getSessionSecretKey(),
            resave: false,
            saveUninitialized: false,
            cookie: {
                httpOnly: true,
                maxAge: getCookieMaxAge(7),
            },
        }),
    );

    // Middleware to handle configuration changes, preventing access during changes
    app.use((_req, res, next) => {
        if (isChangingConfig) {
            res.status(503).json({
                message: 'Service is temporarily unavailable due to configuration changes.',
            });
        } else {
            next();
        }
    });

    // Init passport middleware
    app.use(passport.initialize());
    app.use(passport.session());

    // Register all authentications
    Object.values(states.getState().authentication).forEach(
        (authentication) => useStrategy(authentication, app),
    );


    if (!initialized) {
        initialized = true;
        onConfigFileChange(async () => {
            isChangingConfig = true;
            getAllIds().forEach((id) => {
                passport.unuse(id);
            });
            STRATEGY_IDS.length = 0; // Clear the array
            Object.values(states.getState().authentication).forEach(
                (authentication) => useStrategy(authentication, app),
            );
            isChangingConfig = false;
        });
    }

    passport.serializeUser((user, done) => {
        done(null, JSON.stringify(user));
    });

    passport.deserializeUser<string>((user, done) => {
        done(null, JSON.parse(user));
    });

    // Return strategies
    router.get('/strategies', getStrategies);

    // Routes to protect after this line
    router.use(passport.authenticate(STRATEGY_IDS, { session: true }));

    // Add login/logout routes
    router.post('/login', login);

    router.get('/user', getUser);

    router.post('/logout', logout);

    app.use('/auth', router);
}


export function dispose() {
    if (lokiStore) {
        log.info('disposing passport session store');
        const loki = (lokiStore as any).client as Loki;
        if (loki == null) log.info('loki client is null, nothing to close');
        loki?.close();
        lokiStore = undefined;
    }
}