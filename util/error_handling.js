// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Thingpedia
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const multer = require('multer');
const jwt = require('jsonwebtoken');
const Tp = require('thingpedia');

function html(err, req, res, next) {
    if (err instanceof Tp.OAuthError || err instanceof Tp.ImplementationError) {
        res.status(500).render('error', {
            page_title: req._("Almond - Error"),
            message: req._("There is a problem with the Thingpedia account or device you are trying to configure: %s. Please report this issue to the developer of Thingpedia device.").format(err.message)
        });
    } else if (err instanceof multer.MulterError) {
        res.status(400).render('error', {
            page_title: req._("Almond - Error"),
            message: err
        });
    } else if (err instanceof jwt.JsonWebTokenError) {
        res.status(403).render('error', {
            page_title: req._("Almond - Error"),
            message: err
        });
    } else if (typeof err.status === 'number') {
        // oauth2orize errors, bodyparser errors
        res.status(err.status).render('error', {
            page_title: req._("Almond - Error"),
            message: err.expose === false ? req._("Code: %d").format(err.status) : err
        });
    } else if (err.code === 'EBADCSRFTOKEN') {
        // csurf errors
        res.status(403).render('error', {
            page_title: req._("Almond - Forbidden"),
            message: err,

            // make sure we have a csrf token in the page
            // (this error could be raised before we hit the general code that sets it
            // everywhere)
            csrfToken: req.csrfToken()
        });
    } else if (err.code === 'ENOENT' || err.errno === 'ENOENT') {
        // util/db errors
        // if we get here, we have a 404 response
        res.status(404).render('error', {
            page_title: req._("Almond - Page Not Found"),
            message: req._("The requested page does not exist.")
        });
    } else if (err.sqlState === '23000') {
        console.log(err);
        // duplicate value for UNIQUE or PRIMARY KEY
        res.status(400).render('error', {
            page_title: req._("Almond - Error"),
            message: req._("The identifier you selected is already in use.")
        });
    } else if (err.code === 'EPERM' || err.code === 'EACCESS' ||
               err.sqlState === '42000') {
        // NOTE: there are two cases of permission errors:
        //
        // The first one is generated by util/errors ForbiddenError; they are the ones we expect,
        // they are caused by the user and thrown by our validation/permission checking code.
        // They have code EPERM, but also status 403, hence they go in the
        // `typeof err.status === "number"` branch and we show the error message in full.
        //
        // The second is one is permission errors we did not expect. These are raised by
        // the file system, firewall or MySQL (sqlState 42000) blocking this process, and
        // are handled in this branch.
        // They are bad - it means the user got us to do something we should not be able to do.
        // We log these errors and show a generic error message. We also show a 403 error
        // instead of 500 to throw off any casual security professional or security scanner
        // who fuzzes and looks for 500 errors.
        console.error(err);
        res.status(403).render('error', {
            page_title: req._("Almond - Error"),
            message: req._("You do not have permission to perform the requested operation.")
        });
    } else {
        // bugs
        console.error(err);
        res.status(500).render('error', {
            page_title: req._("Almond - Internal Server Error"),
            message: req._("Code: %s").format(err.code || err.sqlState || err.errno || err.name)
        });
    }
}

function json(err, req, res, next) {
    let message = err.message;

    if (err instanceof multer.MulterError) {
        res.status(400);
    } else if (err instanceof jwt.JsonWebTokenError) {
        res.status(403);
    } else if (typeof err.status === 'number') {
        // oauth2orize errors, bodyparser errors
        res.status(err.status);
    } else if (typeof err.code === 'number') {
        res.status(err.code);
    } else if (err.code === 'ENOENT') {
        res.status(404);
    } else if (err.code === 'EPERM') {
        res.status(403);
    } else if (err.code === 'EINVAL') {
        res.status(400);
    } else {
        res.status(500);
        message = "Internal Server Error";
        console.error(err);
    }

    res.json({ error: message, code: err.code });
}

module.exports = {
    json,
    html
};
