// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const express = require('express');
const crypto = require('crypto');
const passport = require('passport');

const Config = require('../config');

const user = require('../util/user');
const EngineManager = require('../almond/enginemanagerclient');

function makeRandom(bytes) {
    return crypto.randomBytes(bytes).toString('hex');
}

var router = express.Router();

class AlexaDelegate {
    constructor(res) {
        this._buffer = '';
        this._res = res;
        this._done = false;

        this._askSpecial = null;
    }

    flush() {
        if (this._done)
            return;
        this._done = true;
        this._res.json({
           version: '1.0',
           sessionAttributes: {
           },
           response: {
               outputSpeech: { 
                   type: 'PlainText',
                   text: this._buffer
               },
               shouldEndSession: this._askSpecial === null,
               directives: (this._askSpecial === null ? undefined : [
                   {
                       type: 'Dialog.ElicitSlot',
                       slotToElicit: 'command'
                   }
               ])
           }
        });
    }

    send(text, icon) {
        this._buffer += text + '\n';
    }

    sendPicture(url, icon) {
        // FIXME
    }

    sendRDL(rdl, icon) {
        // FIXME
    }

    sendChoice(idx, what, title, text) {
        // FIXME
    }

    sendButton(title, json) {
        // FIXME
    }

    sendLink(title, url) {
        // FIXME
    }

    sendAskSpecial(what) {
        this._askSpecial = what;
    }
}
AlexaDelegate.prototype.$rpcMethods = ['send', 'sendPicture', 'sendChoice', 'sendLink', 'sendButton', 'sendAskSpecial', 'sendRDL'];

router.post('/alexa', (req, res, next) => {
    if (req.body && req.body.session && req.body.session.user && req.body.session.user.accessToken &&
        !req.headers.authorization)
        req.headers.authorization = 'Bearer ' + req.body.session.user.accessToken;
    if (req.headers.authorization) {
        passport.authenticate('bearer', (err, user, info) => {
            // ignore auth failures and ignore sessions
            if (err) {
                next(err);
                return;
            }

            if (!user) {
                res.status(401).json({error: 'invalid access token'});
                return;
            }
            req.login(user, next);
        })(req, res, next);
    }
}, (req, res) => {
    console.log('body', req.body);

    const user = req.user;
    const assistantUser = { name: user.human_name || user.username };
    const text = req.body.request.type === 'LaunchRequest' ? 'hello' : req.body.request.intent.slots.command.value;

    const delegate = new AlexaDelegate(res);
 
    Q.try(() => {
        return EngineManager.get().getEngine(req.user.id);
    }).then((engine) => {
        return engine.assistant.getOrOpenConversation('alexa:' + req.body.session.sessionId,
            assistantUser, delegate, { showWelcome: false, debug: true });
    }).then((conversation) => {
        return conversation.handleCommand(text);
    }).then(() => {
        return delegate.flush();
    });

});

router.ws('/anonymous', (ws, req) => {
    if (req.user)
        ws.close();

    user.getAnonymousUser().then((user) => {
        return doConversation(user, true, ws);
    });
});

const ALLOWED_ORIGINS = ['http://127.0.0.1:8080',
    'https://thingpedia.stanford.edu', 'https://thingengine.stanford.edu',
    'https://almond.stanford.edu', 'null'];

function isOriginOk(req) {
    if (req.headers['authorization'] && req.headers['authorization'].startsWith('Bearer'))
        return true;
    if (typeof req.headers['origin'] !== 'string')
        return true;
    if (req.headers['origin'].startsWith('http://127.0.0.1'))
        return true;
    if (req.headers['origin'].startsWith('http://localhost'))
        return true;
    return ALLOWED_ORIGINS.indexOf(req.headers['origin'].toLowerCase()) >= 0;
}

function checkOrigin(req, res, next) {
    if (isOriginOk(req)) {
        if (req.headers['origin']) {
            res.set('Access-Control-Allow-Origin', req.headers['origin']);
            res.set('Vary', 'Origin');
        }
        res.set('Access-Control-Allow-Credentials', 'true');
        next();
    } else {
        res.status(403).send('Forbidden Cross Origin Request');
    }
}

router.use('/', (req, res, next) => {
    passport.authenticate('bearer', (err, user, info) => {
        // ignore auth failures and ignore sessions
        if (err)
            return next(err);
        if (!user)
            return next();
        req.login(user, next);
    })(req, res, next);
}, user.requireLogIn, checkOrigin);

router.options('/.*', (req, res, next) => {
    res.send('');
});

router.get('/parse', (req, res, next) => {
    let query = req.query.q || null;
    let targetJson = req.query.target_json || null;
    if (!query && !targetJson) {
        res.status(400).json({error:'Missing query'});
        return;
    }

    Q.try(() => {
        return EngineManager.get().getEngine(req.user.id);
    }).then((engine) => {
        return engine.assistant.parse(query, targetJson);
    }).then((result) => {
        res.json(result);
    }).catch((e) => {
        console.error(e.stack);
        res.status(500).json({error:e.message});
    });
});

function describeApp(app) {
    return Promise.all([app.uniqueId, app.description, app.error, app.code, app.state, app.icon])
        .then(([uniqueId, description, error, code, state, icon]) => ({
            uniqueId, description, error: error, code, slots: state,
            icon: icon ? Config.S3_CLOUDFRONT_HOST + '/icons/' + icon + '.png' : null
        }));
}

router.post('/apps/create', (req, res, next) => {
    Q.try(() => {
        return EngineManager.get().getEngine(req.user.id);
    }).then((engine) => {
        return engine.assistant.createApp(req.body);
    }).then((result) => {
        if (result.error)
            res.status(400);
        res.json(result);
    }).catch((e) => {
        console.error(e.stack);
        res.status(500).json({error:e.message});
    });
});

router.get('/apps/list', (req, res, next) => {
    Q.try(() => {
        return EngineManager.get().getEngine(req.user.id);
    }).then((engine) => {
        return engine.apps.getAllApps().then((apps) => {
            return Promise.all(apps.map((a) => describeApp(a)));
        });
    }).then((result) => {
        res.json(result);
    }).catch((e) => {
        console.error(e.stack);
        res.status(500).json({error:e.message});
    });
});

router.get('/apps/get/:appId', (req, res, next) => {
    Q.try(() => {
        return EngineManager.get().getEngine(req.user.id);
    }).then((engine) => {
        return engine.apps.getApp(req.params.appId).then((app) => {
            if (!app) {
                res.status(404);
                return { error: 'No such app' };
            } else {
                return describeApp(app);
            }
        });
    }).then((result) => {
        res.json(result);
    }).catch((e) => {
        console.error(e.stack);
        res.status(500).json({error:e.message});
    });
});

router.post('/apps/delete/:appId', (req, res, next) => {
    Q.try(() => {
        return EngineManager.get().getEngine(req.user.id);
    }).then((engine) => {
        return engine.apps.getApp(req.params.appId).then((app) => {
            if (!app) {
                res.status(404);
                return { error: 'No such app' };
            } else {
                return engine.apps.removeApp(app).then(() => ({status:'ok'}));
            }
        });
    }).then((result) => {
        res.json(result);
    }).catch((e) => {
        console.error(e.stack);
        res.status(500).json({error:e.message});
    });
});

class WebsocketApiDelegate {
    constructor(ws) {
        this._ws = ws;
    }

    send(str) {
        try {
            this._ws.send(str);
        } catch(e) {
            // ignore if the socket is closed
            if (e.message !== 'not opened')
                throw e;
        }
    }
}
WebsocketApiDelegate.prototype.$rpcMethods = ['send'];

router.ws('/results', (ws, req, next) => {
    var user = req.user;

    Q.try(() => {
        return EngineManager.get().getEngine(user.id);
    }).then((engine) => {
        const onclosed = (userId) => {
            if (userId === user.id)
                ws.close();
            EngineManager.get().removeListener('socket-closed', onclosed);
        };
        EngineManager.get().on('socket-closed', onclosed);

        let delegate = new WebsocketApiDelegate(ws);
        ws.on('error', (err) => {
            ws.close();
        });
        ws.on('close', () => {
            engine.assistant.removeOutput(delegate); // ignore errors if engine died
            delegate.$free();
        });
        ws.on('ping', (data) => ws.pong(data));

        return engine.assistant.addOutput(delegate);
    }).catch((error) => {
        console.error('Error in API websocket: ' + error.message);
        ws.close();
    });
});

class WebsocketAssistantDelegate {
    constructor(ws) {
        this._ws = ws;
    }

    send(text, icon) {
        return this._ws.send(JSON.stringify({ type: 'text', text: text, icon: icon }));
    }

    sendPicture(url, icon) {
        return this._ws.send(JSON.stringify({ type: 'picture', url: url, icon: icon }));
    }

    sendRDL(rdl, icon) {
        return this._ws.send(JSON.stringify({ type: 'rdl', rdl: rdl, icon: icon }));
    }

    sendChoice(idx, what, title, text) {
        return this._ws.send(JSON.stringify({ type: 'choice', idx: idx, title: title, text: text }));
    }

    sendButton(title, json) {
        return this._ws.send(JSON.stringify({ type: 'button', title: title, json: json }));
    }

    sendLink(title, url) {
        return this._ws.send(JSON.stringify({ type: 'link', title: title, url: url }));
    }

    sendAskSpecial(what) {
        return this._ws.send(JSON.stringify({ type: 'askSpecial', ask: what }));
    }
}
WebsocketAssistantDelegate.prototype.$rpcMethods = ['send', 'sendPicture', 'sendChoice', 'sendLink', 'sendButton', 'sendAskSpecial', 'sendRDL'];

function doConversation(user, anonymous, ws) {
    return Q.try(() => {
        return EngineManager.get().getEngine(user.id);
    }).then((engine) => {
        const onclosed = (userId) => {
            if (userId === user.id)
                ws.close();
            EngineManager.get().removeListener('socket-closed', onclosed);
        };
        EngineManager.get().on('socket-closed', onclosed);

        var assistantUser = { name: user.human_name || user.username, anonymous };
        var delegate = new WebsocketAssistantDelegate(ws);

        var opened = false;
        const id = 'web-' + makeRandom(16);
        ws.on('error', (err) => {
            ws.close();
        });
        ws.on('close', () => {
            if (opened)
                engine.assistant.closeConversation(id); // ignore errors if engine died
            delegate.$free();
            opened = false;
        });

        return engine.assistant.openConversation(id, assistantUser, delegate, { showWelcome: true })
            .tap((conversation) => {
                opened = true;
                return conversation.start();
            }).then((conversation) => {
                ws.on('message', (data) => {
                    Q.try(() => {
                        var parsed = JSON.parse(data);
                        switch(parsed.type) {
                        case 'command':
                            return conversation.handleCommand(parsed.text);
                        case 'parsed':
                            return conversation.handleParsedCommand(parsed.json);
                        case 'tt':
                            return conversation.handleThingTalk(parsed.code);
                        default:
                            throw new Error('Invalid command type ' + parsed.type);
                        }
                    }).catch((e) => {
                        console.error(e.stack);
                        ws.send(JSON.stringify({ type: 'error', error:e.message }));
                    });
                });
            });
    }).catch((error) => {
        console.error('Error in conversation websocket: ' + error.message);
        ws.close();
    });
}

router.ws('/conversation', (ws, req, next) => {
    doConversation(req.user, false, ws);
});

module.exports = router;
