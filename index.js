//@ts-check
"use strict";
require("dotenv").config();
const express = require("express")
    , session = require("express-session")
    , http = require("http")
    , socketIO = require("socket.io")
    , bodyParser = require("body-parser")
    , mongo = require("mongodb")
    , MongoStore = require("connect-mongo")(session)
    , path = require("path")
    , pug = require("pug")
    , morgan = require("morgan")
    , passport = require("passport")
    , LocalStrategy = require("passport-local").Strategy
    , bcrypt = require("bcrypt-nodejs")
    , flash = require("connect-flash")
    , swapandread = require("./app/swapandread")
    ;

const url = "mongodb://" + process.env.DBUSR + ":" + process.env.DBPW + "@" + process.env.DB_URI;
const dbClient = mongo.MongoClient;

dbClient.connect(url, (err, db) => {
    if (err) {
        throw err;
    }
    let app = express();
    const server = http.Server(app);
    const io = socketIO(server);
    app.use(
        express.static(path.join(__dirname, "static"))
        , morgan("dev")
        , bodyParser.json()
        , bodyParser.urlencoded({extended: true})
        , flash()
    );
    app.set("view engine", "pug");
    app.set("views", path.join(__dirname, "views"));
    app.engine("pug", pug.__express);
    app.set("port", (process.env.PORT || 5000));
    app.use(session({
            secret: "myDirtyLittleSecret"
            , resave: true
            , saveUninitialized: false
            , store: new MongoStore(
                {
                    db: db
                    , collection: "bookSessions"
                }
            )
            , cookie: {maxAge: 24 * 60 * 60 * 1000}
        }));

    passport.use("local-login", new LocalStrategy(
        {passReqToCallback: true},
        function(req, username, password, done) {
            db.collection("bookUsers").findOne({username: username}, function(err, user) {
                if (err) {console.error(err); return done(err);}
                if (!user) {
                    return done(null, false, req.flash("loginMessage", "User " + username + " could not be found!" ))
                }
                if (!bcrypt.compareSync(password, user.password)) {
                    return done(null, false, req.flash("loginMessage", "Invalid username or password.")); 
                }
                return done(null, user);
            })
        }));

    passport.use("local-signup", new LocalStrategy(
        {passReqToCallback: true},
        function(req, username, password, done) {
            db.collection("bookUsers").findOne({username: username}, function(err, user) {
                if (err) {
                    console.error(err);
                    return done(err);
                }
                if (user) {
                    return done(null, false, req.flash("loginMessage", "Username already exists. Please choose another one."));
                }
                const profile = {fullName: "", city: "", countryOrState: ""}
                const newUser = {username: username, password: bcrypt.hashSync(password, bcrypt.genSaltSync(8)), profile: profile};
                db.collection("bookUsers").insertOne(newUser);
                return done(null, {username: newUser.username, password: newUser.password}, req.flash("loginMessage", newUser.username + " is now a member!"))
            })
        }
    ))
        
    passport.serializeUser(function(user, done) {
        done(null, {_id: user._id, username: user.username});
    })

    passport.deserializeUser(function(user, done) {
        db.collection("bookUsers").findOne({username: user.username}, function (err, user) {
            if (err) { return done(err); }
            done(null, user);
        });
    });

    app.use(passport.initialize());
    app.use(passport.session());

    server.listen(app.get("port"), function() {
        console.log(app.name + " running on port " + app.get("port"))
    })

    swapandread(app, db, passport);
})

