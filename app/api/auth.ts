// @ts-nocheck
import express from 'express';
import session from 'express-session';
import passport from 'passport';
import { v5 as uuidV5 } from 'uuid';
import getmac from 'getmac';
import { store } from '../store';
import * as registry from '../registry';
import log from '../log';
import { getVersion, onConfigFileChange } from '../configuration';
import LokiSessionStore from './LokiSessionStore';

const router = express.Router();

// The configured strategy ids.
const STRATEGY_IDS = [];

// Constant WUD namespace for uuid v5 bound sessions.
const WUD_NAMESPACE = 'dee41e92-5fc4-460e-beec-528c9ea7d760';

/**
 * Get all strategies id.
 */
export function getAllIds() {
    return STRATEGY_IDS;
}

export function authenticate() {
    return (req: any, res: any, next: any) => {
        if (req.isAuthenticated?.()) {
            return next();
        }
        return passport.authenticate(STRATEGY_IDS, { session: true })(
            req,
            res,
            next,
        );
    };
}

/**
 * Express middleware to protect routes.
 * @param req
 * @param res
 * @param next
 * @returns {*}
 */
export function requireAuthentication(req, res, next): any {
    return authenticate()(req, res, next);
}

/**
 * Get cookie max age.
 * @param days
 */
function getCookieMaxAge(days) {
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
function useStrategy(authentication, app) {
    try {
        const strategy = authentication.getStrategy(app);
        passport.use(authentication.getId(), strategy);
        STRATEGY_IDS.push(authentication.getId());
    } catch (e) {
        log.warn(
            `Unable to apply authentication ${authentication.getId()} (${e.message})`,
        );
    }
}

function refreshStrategies(app: express.Express) {
    getAllIds().forEach((id) => {
        passport.unuse(id);
    });
    STRATEGY_IDS.length = 0;
    Object.values(registry.getState().authentication).forEach(
        (authentication) => useStrategy(authentication, app),
    );
}

function getUniqueStrategies() {
    const strategies = Object.values(registry.getState().authentication).map(
        (authentication) => authentication.getStrategyDescription(),
    );
    const uniqueStrategies = [];
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
function getStrategies(req, res) {
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
function getUser(req, res) {
    const user = req.user || { username: 'anonymous' };
    res.status(200).json(user);
}

/**
 * Login user (and return it).
 * @param req
 * @param res
 */
function login(req, res) {
    return getUser(req, res);
}

/**
 * Logout current user.
 * @param req
 * @param res
 */
function logout(req, res) {
    req.logout(() => {});
    res.status(200).json({
        logoutUrl: getLogoutRedirectUrl(),
    });
}

let initialized = false;
let isChangingConfig = false;

let lokiStore: LokiSessionStore | undefined;
/**
 * Init auth (passport.js).
 * @returns {*}
 */
export function init(app) {
    lokiStore = new LokiSessionStore(store.getDb());
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
                message:
                    'Service is temporarily unavailable due to configuration changes.',
            });
        } else {
            next();
        }
    });

    // Init passport middleware
    app.use(passport.initialize());
    app.use(passport.session());

    // Register all authentications
    refreshStrategies(app);

    if (!initialized) {
        initialized = true;
        onConfigFileChange(() => {
            isChangingConfig = true;
        });
        registry.onReloadComplete(() => {
            refreshStrategies(app);
            isChangingConfig = false;
        });
    }

    passport.serializeUser((user, done) => {
        done(null, JSON.stringify(user));
    });

    passport.deserializeUser((user, done) => {
        done(null, JSON.parse(user));
    });

    // Return strategies
    router.get('/strategies', getStrategies);

    // Routes to protect after this line
    router.use(requireAuthentication);

    // Add login/logout routes
    router.post('/login', login);

    router.get('/user', getUser);

    router.post('/logout', logout);

    app.use('/auth', router);
}

export function dispose() {
    if (lokiStore) {
        log.info('disposing passport session store');
        lokiStore = undefined;
    }
}
